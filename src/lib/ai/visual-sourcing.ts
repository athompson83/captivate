import "server-only";

import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { STORAGE_BUCKETS } from "@/lib/supabase/config";
import { MAX_UPLOAD_BYTES } from "@/lib/data/upload-limits";
import { currentPlan } from "@/lib/billing/entitlement";
import { allowsImageGeneration } from "@/lib/billing/plans";
import { logFailureSampled } from "@/lib/observability";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Finding and making pictures.
 *
 * Two providers, one shape each. The interfaces are narrow rather than
 * abstract: there is exactly one stock provider and one generation provider,
 * and no UI anywhere lets a presenter choose between alternatives. What the
 * shape buys is that replacing one — a pricing change, a deprecation — is a new
 * implementation of a small contract rather than a rewrite of the picker and
 * the ingestion path that call it.
 *
 * Both degrade the same way the text tools already do when a key is absent: a
 * clear "not configured", not a broken control.
 */

/* -------------------------------------------------------------------------- */
/* Budget                                                                      */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Providers                                                                   */
/* -------------------------------------------------------------------------- */

export interface StockResult {
  thumbnailUrl: string;
  fullUrl: string;
  providerAssetId: string;
  originalPageUrl: string;
  creatorName: string;
  creatorPageUrl: string;
  licenseRef: string;
  altText: string;
  width: number;
  height: number;
}

export type Sourced<T> = { ok: true; data: T } | { ok: false; error: string };

const PEXELS_ENDPOINT = "https://api.pexels.com/v1/search";

/**
 * Hosts the server will fetch an image from.
 *
 * Not a pattern and not a general "fetch what you are told" utility: the only
 * two callers that ever produce a URL to ingest are the two providers below,
 * both server-controlled, so anything else reaching `ingest` is a bug or worse
 * and is refused on the hostname alone.
 */
const INGEST_HOSTS = new Set(["images.pexels.com", "oaidalleapiprodscus.blob.core.windows.net"]);

const PexelsResponse = z.object({
  photos: z
    .array(
      z.object({
        id: z.number(),
        width: z.number(),
        height: z.number(),
        url: z.string(),
        alt: z.string().nullable().optional(),
        photographer: z.string(),
        photographer_url: z.string(),
        src: z.object({ large: z.string(), medium: z.string() }),
      }),
    )
    .default([]),
});

export function isStockSearchConfigured(): boolean {
  return Boolean(process.env.PEXELS_API_KEY);
}

export function isImageGenerationConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function searchStockPhotos(query: string): Promise<Sourced<StockResult[]>> {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return { ok: false, error: "Image search isn't configured on this deployment." };

  const trimmed = query.trim().slice(0, 200);
  if (!trimmed) return { ok: true, data: [] };

  try {
    const url = new URL(PEXELS_ENDPOINT);
    url.searchParams.set("query", trimmed);
    url.searchParams.set("per_page", "24");
    url.searchParams.set("orientation", "landscape");

    const response = await fetch(url, {
      headers: { Authorization: key },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return { ok: false, error: "Image search is unavailable right now." };

    const parsed = PexelsResponse.safeParse(await response.json());
    if (!parsed.success) return { ok: false, error: "Image search returned something unreadable." };

    return {
      ok: true,
      data: parsed.data.photos.map((photo) => ({
        thumbnailUrl: photo.src.medium,
        fullUrl: photo.src.large,
        providerAssetId: String(photo.id),
        originalPageUrl: photo.url,
        creatorName: photo.photographer,
        creatorPageUrl: photo.photographer_url,
        licenseRef: "Pexels License",
        altText: photo.alt?.trim() || trimmed,
        width: photo.width,
        height: photo.height,
      })),
    };
  } catch {
    return { ok: false, error: "Couldn't reach the image search." };
  }
}

export interface GeneratedImage {
  /** A data URL, so nothing is stored until the author accepts it. */
  previewDataUrl: string;
  model: string;
  prompt: string;
  quality: "medium";
  generationMs: number;
  /** The reservation this generation was charged against. */
  reservationId: string;
}

const OpenAiImageResponse = z.object({
  data: z.array(z.object({ b64_json: z.string().min(1) })).min(1),
});

const OPENAI_IMAGE_ENDPOINT = "https://api.openai.com/v1/images/generations";
const IMAGE_MODEL = "gpt-image-2";

/**
 * Generates one image, after reserving the money for it.
 *
 * The reservation is taken before the provider is called, not after: the
 * budget is shared between everyone using the deployment, so two people
 * spending its last dollar at the same moment is the case the gate exists for.
 * A refusal costs nothing and says which ceiling was reached, because "the
 * deployment is out of budget" and "you have used your day's allowance" are
 * different situations for the person reading them.
 */
export async function generateImage(
  prompt: string,
  presentationId: string | null = null,
): Promise<Sourced<GeneratedImage>> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { ok: false, error: "Image generation isn't configured on this deployment." };

  // Checked before the reservation: a refusal must not consume budget, and the
  // reason a free caller cannot do this is not "the deployment is out of
  // money".
  if (!allowsImageGeneration(await currentPlan())) {
    return {
      ok: false,
      error: "AI image generation is part of Captivate Pro. Search and upload still work.",
    };
  }

  const trimmed = prompt.trim().slice(0, 1000);
  if (!trimmed) return { ok: false, error: "Describe the image you want first." };

  warnIfCeilingsStillInTheEnvironment();

  const supabase = await supabaseServer();

  const { data: reserved, error: reserveError } = await supabase.rpc(
    "captivate_reserve_image_generation",
    {
      p_prompt: trimmed,
      // Attributed to the deck it was made for, so the ledger can answer which
      // presentation an image cost money for. The reservation runs as definer
      // and nulls a deck the caller does not own, so naming someone else's here
      // buys nothing.
      p_presentation_id: presentationId,
    },
  );

  const ticket = (reserved as ImageReservation[] | null)?.[0];
  // Fails closed: without a ticket nothing is counting the spend, and an
  // uncounted call is exactly what the ceiling exists to prevent.
  if (reserveError || !ticket) {
    return { ok: false, error: "Couldn't reserve an image generation. Nothing was spent." };
  }
  if (!ticket.id) {
    return { ok: false, error: refusalMessage(ticket.refusal, ticket.daily_max) };
  }

  const startedAt = Date.now();
  try {
    const response = await fetch(OPENAI_IMAGE_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        prompt: trimmed,
        n: 1,
        size: "1536x1024",
        quality: "medium",
      }),
      signal: AbortSignal.timeout(90_000),
    });

    if (!response.ok) {
      await settle(supabase, ticket.id, "failed", `HTTP ${response.status}`, startedAt);
      return { ok: false, error: "The image provider refused that request." };
    }

    const parsed = OpenAiImageResponse.safeParse(await response.json());
    if (!parsed.success) {
      await settle(supabase, ticket.id, "invalid_output", "unreadable response", startedAt);
      return { ok: false, error: "The image provider returned something unreadable." };
    }

    const generationMs = Date.now() - startedAt;
    await settle(supabase, ticket.id, "succeeded", null, startedAt);

    return {
      ok: true,
      data: {
        previewDataUrl: `data:image/png;base64,${parsed.data.data[0].b64_json}`,
        model: IMAGE_MODEL,
        prompt: trimmed,
        quality: "medium",
        generationMs,
        reservationId: ticket.id,
      },
    };
  } catch {
    await settle(supabase, ticket.id, "failed", "network", startedAt);
    return { ok: false, error: "Couldn't reach the image provider. Nothing was changed." };
  }
}

/**
 * Says so when a deployment's old ceiling variables are still set.
 *
 * The budget and the daily cap used to come from the environment and now come
 * from `public.ai_image_limits`, which the migration seeds with the documented
 * defaults. A deployment that had overridden either — a lower budget kept
 * deliberately as a spending safeguard is the case that matters — would
 * otherwise be moved onto those defaults without a word, and a spend ceiling
 * that changes without a word is the thing this whole area exists to prevent.
 *
 * Sampled, because it is true on every call for as long as the variable is set
 * rather than being an event, and one line a minute is enough to be found.
 */
/**
 * What the reservation answers with, taken from the generated schema rather
 * than restated. The RPC gained `daily_max` in `0021`; a second copy of the
 * shape here would have gone on compiling while quietly disagreeing with the
 * database.
 */
type ImageReservation =
  Database["public"]["Functions"]["captivate_reserve_image_generation"]["Returns"][number];

function warnIfCeilingsStillInTheEnvironment(): void {
  // Empty counts as unset, which is the state this asks an operator to reach:
  // a variable cleared rather than removed is not a ceiling anybody could read
  // as being in force, and warning about it would train the reader to ignore
  // the line that matters.
  const set = (value: string | undefined) => (value ?? "").trim() !== "";
  if (!set(process.env.CAPTIVATE_IMAGE_BUDGET_USD) && !set(process.env.CAPTIVATE_IMAGE_DAILY_MAX)) {
    return;
  }

  logFailureSampled(
    "ai.image.ceilings-moved",
    new Error(
      "CAPTIVATE_IMAGE_BUDGET_USD/CAPTIVATE_IMAGE_DAILY_MAX are set but are no longer read. " +
        "The ceilings are rows in public.ai_image_limits now — set that row to match, or " +
        "unset these so nobody reads them as the limit in force.",
    ),
  );
}

function refusalMessage(refusal: string | null, daily: number | null): string {
  switch (refusal) {
    case "budget":
      return "This deployment has reached its image-generation budget for the month. Search and upload still work.";
    case "daily":
      // The number comes back with the refusal rather than from configuration
      // here, so the message cannot disagree with the ceiling that refused.
      return typeof daily === "number"
        ? `You've generated ${daily} images today, which is the daily limit. Search and upload still work.`
        : "You've reached your daily limit for image generation. Search and upload still work.";
    case "signed-out":
      return "You're signed out.";
    default:
      return "Image generation isn't available right now. Search and upload still work.";
  }
}

async function settle(
  supabase: Awaited<ReturnType<typeof supabaseServer>>,
  id: string,
  status: "succeeded" | "failed" | "invalid_output",
  error: string | null,
  startedAt: number,
): Promise<void> {
  try {
    await supabase.rpc("captivate_settle_image_generation", {
      p_id: id,
      // The price is whatever the reservation already put on the row, and
      // settling no longer restates it. A failed call still cost the attempt,
      // so a provider outage must not read as free capacity and burn the
      // month's budget on retries — and the settle runs with the caller's own
      // JWT, so a figure it accepted was a figure a caller could choose.
      p_status: status,
      p_model: IMAGE_MODEL,
      p_generation_ms: Date.now() - startedAt,
      p_error: error,
    });
  } catch {
    // The reservation already counts; losing the reconciliation loses detail.
  }
}

/* -------------------------------------------------------------------------- */
/* Ingestion                                                                   */
/* -------------------------------------------------------------------------- */

/** Magic bytes, because a Content-Type header is a claim rather than a fact. */
const SIGNATURES: { mime: string; ext: string; matches: (b: Uint8Array) => boolean }[] = [
  {
    mime: "image/png",
    ext: "png",
    matches: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    mime: "image/jpeg",
    ext: "jpg",
    matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: "image/webp",
    ext: "webp",
    matches: (b) =>
      b[0] === 0x52 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x46 &&
      b[8] === 0x57 &&
      b[9] === 0x45 &&
      b[10] === 0x42 &&
      b[11] === 0x50,
  },
];

export type IngestFailure =
  "host-not-allowed" | "unreachable" | "too-large" | "not-an-image" | "storage";

export interface IngestedBytes {
  bytes: Uint8Array;
  mimeType: string;
  extension: string;
}

/**
 * Fetches an image the server itself chose, and proves it is one.
 *
 * Four things have to be true before any of it reaches storage, and none of
 * them can be taken on the provider's word:
 *
 *  - the host is one of ours to fetch from, checked before a request is made;
 *  - the response is not larger than an upload would be allowed to be, checked
 *    while reading rather than after, so an endless response is abandoned
 *    rather than buffered;
 *  - the bytes actually begin with an image signature, because `Content-Type`
 *    is a claim;
 *  - the format is one the rest of the app already accepts.
 */
export async function fetchImageBytes(rawUrl: string): Promise<Sourced<IngestedBytes>> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, error: "host-not-allowed" satisfies IngestFailure };
  }
  if (url.protocol !== "https:" || !INGEST_HOSTS.has(url.hostname)) {
    return { ok: false, error: "host-not-allowed" satisfies IngestFailure };
  }

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok || !response.body) {
      return { ok: false, error: "unreachable" satisfies IngestFailure };
    }

    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_UPLOAD_BYTES)
      return { ok: false, error: "too-large" satisfies IngestFailure };

    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      // Abandoned mid-stream rather than after: a response that never ends
      // must not be able to hold memory until it does.
      if (total > MAX_UPLOAD_BYTES) {
        await reader.cancel();
        return { ok: false, error: "too-large" satisfies IngestFailure };
      }
      chunks.push(value);
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const signature = SIGNATURES.find((candidate) => candidate.matches(bytes));
    if (!signature) return { ok: false, error: "not-an-image" satisfies IngestFailure };

    return { ok: true, data: { bytes, mimeType: signature.mime, extension: signature.ext } };
  } catch {
    return { ok: false, error: "unreachable" satisfies IngestFailure };
  }
}

/** Uploads verified bytes into the caller's own prefix. */
export async function storeSourcedImage(
  ingested: IngestedBytes,
): Promise<Sourced<{ storagePath: string }>> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You're signed out." };

  const storagePath = `${user.id}/${crypto.randomUUID()}.${ingested.extension}`;
  const { error } = await supabase.storage
    .from(STORAGE_BUCKETS.assets)
    .upload(storagePath, ingested.bytes, { contentType: ingested.mimeType, upsert: false });

  if (error) return { ok: false, error: "storage" satisfies IngestFailure };
  return { ok: true, data: { storagePath } };
}

export { INGEST_HOSTS };
