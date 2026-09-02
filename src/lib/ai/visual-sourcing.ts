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

/**
 * Which gateway generates images, resolved the same way the text provider is.
 *
 * Same reasoning as `AI_PROVIDER`: an operator adds a key, not a matched pair
 * of variables, and OpenAI wins a tie so that adding an OpenRouter key beside
 * a working OpenAI one does not silently move an existing deployment. The two
 * resolve independently — running text through OpenRouter and images through
 * OpenAI, or the reverse, is a reasonable thing to want and costs nothing to
 * allow.
 */
export type ImageProviderName = "openai" | "openrouter";

function resolveImageProvider(): ImageProviderName {
  const named = process.env.CAPTIVATE_IMAGE_PROVIDER?.trim().toLowerCase();
  if (named === "openai" || named === "openrouter") return named;
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  return "openai";
}

export const IMAGE_PROVIDER = resolveImageProvider();

/**
 * The key for whichever gateway `IMAGE_PROVIDER` resolved to.
 *
 * Read through here rather than at each call site so the two can never drift —
 * a deployment that resolved to OpenRouter and then checked `OPENAI_API_KEY`
 * would report image generation unavailable while a working key sat in the
 * environment.
 */
function imageKey(): string | undefined {
  return IMAGE_PROVIDER === "openrouter"
    ? process.env.OPENROUTER_API_KEY
    : process.env.OPENAI_API_KEY;
}

export function isImageGenerationConfigured(): boolean {
  return Boolean(imageKey());
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

/**
 * Both providers answer in this shape: an array of base64 payloads.
 *
 * OpenRouter's image endpoint is deliberately OpenAI-compatible here, which is
 * why this whole change is a request-body difference and not a second code
 * path. `media_type` is OpenRouter's addition and is optional — the data URL
 * below honours it when it is there rather than asserting PNG, because a model
 * that returns WebP with a `data:image/png` prefix is an image that renders
 * nowhere.
 */
const GeneratedImageResponse = z.object({
  data: z
    .array(
      z.object({
        b64_json: z.string().min(1),
        media_type: z.string().nullish(),
      }),
    )
    .min(1),
});

const IMAGE_ENDPOINT: Record<ImageProviderName, string> = {
  openai: "https://api.openai.com/v1/images/generations",
  openrouter: "https://openrouter.ai/api/v1/images",
};

/**
 * The same model through either gateway, for the same reason the text default
 * is unchanged: the prompts in `service.ts` and the way a generated backdrop
 * sits under text were tuned against `gpt-image-2`, so moving gateway and
 * model together would leave nothing to attribute a difference to.
 * `CAPTIVATE_IMAGE_MODEL` switches it — `google/gemini-3.1-flash-image` and
 * `bytedance-seed/seedream-5-0-lite` are both markedly cheaper.
 */
const DEFAULT_IMAGE_MODEL: Record<ImageProviderName, string> = {
  openai: "gpt-image-2",
  openrouter: "openai/gpt-image-2",
};

const IMAGE_MODEL =
  process.env.CAPTIVATE_IMAGE_MODEL?.trim() || DEFAULT_IMAGE_MODEL[IMAGE_PROVIDER];

/**
 * What to ask for, in each gateway's vocabulary.
 *
 * OpenAI takes a literal pixel `size`; OpenRouter takes an `aspect_ratio`,
 * because it fronts models whose native resolutions differ. `3:2` is
 * 1536x1024 expressed the other way, so both return the picture this app has
 * always placed — the deck is 16:9 and a wider backdrop would be the better
 * choice, but changing the shape in the same step as the gateway is how a
 * difference becomes unattributable.
 */
function imageRequestBody(prompt: string): Record<string, unknown> {
  const common = { model: IMAGE_MODEL, prompt, n: 1, quality: "medium" };
  return IMAGE_PROVIDER === "openrouter"
    ? { ...common, aspect_ratio: "3:2" }
    : { ...common, size: "1536x1024" };
}

/** Image types this deployment will store, and what to call the file. */
const STORABLE: Record<string, { mimeType: string; extension: string }> = {
  "image/png": { mimeType: "image/png", extension: "png" },
  "image/jpeg": { mimeType: "image/jpeg", extension: "jpg" },
  "image/webp": { mimeType: "image/webp", extension: "webp" },
};

/**
 * What the bytes actually are, as opposed to what anything says they are.
 *
 * The accept path used to test for a PNG signature and store `image/png`,
 * which was right while exactly one model could produce a generated image and
 * silently wrong the moment another could: a WebP stored under a PNG content
 * type renders nowhere, and the check that was supposed to catch a lie instead
 * rejected a perfectly good picture. Sniffing answers both questions at once —
 * is this an image at all, and which one — so the claim in the data URL never
 * has to be trusted.
 */
export function sniffImage(bytes: Uint8Array): { mimeType: string; extension: string } | null {
  const at = (i: number) => bytes[i] ?? -1;
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47)
    return STORABLE["image/png"];
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return STORABLE["image/jpeg"];
  if (
    at(0) === 0x52 &&
    at(1) === 0x49 &&
    at(2) === 0x46 &&
    at(3) === 0x46 &&
    at(8) === 0x57 &&
    at(9) === 0x45 &&
    at(10) === 0x42 &&
    at(11) === 0x50
  ) {
    return STORABLE["image/webp"];
  }
  return null;
}

/**
 * The bytes behind a base64 payload, or null if it is not decodable.
 *
 * Separate from `sniffImage` so a decode failure and an unsupported format are
 * distinguishable: one is a broken response, the other is a picture in a shape
 * this deployment cannot keep.
 */
function decodeBase64(payload: string): Uint8Array | null {
  try {
    return Uint8Array.from(Buffer.from(payload, "base64"));
  } catch {
    return null;
  }
}

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
  const key = imageKey();
  if (!key) return { ok: false, error: "Image generation isn't configured on this deployment." };

  // Checked before the reservation: a refusal must not consume budget, and the
  // reason a free caller cannot do this is not "the deployment is out of
  // money".
  if (!allowsImageGeneration(await currentPlan())) {
    return {
      ok: false,
      error:
        "AI image generation comes with Captivate Basic and Pro. Search and upload still work.",
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
    const response = await fetch(IMAGE_ENDPOINT[IMAGE_PROVIDER], {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        // Attribution only, and only on the gateway that asks for it. The
        // product's name and its own public origin — never the author's.
        ...(IMAGE_PROVIDER === "openrouter"
          ? {
              "X-Title": "Captivate",
              ...(process.env.NEXT_PUBLIC_SITE_URL
                ? { "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL }
                : {}),
            }
          : {}),
      },
      body: JSON.stringify(imageRequestBody(trimmed)),
      signal: AbortSignal.timeout(90_000),
    });

    if (!response.ok) {
      await settle(supabase, ticket.id, "failed", `HTTP ${response.status}`, startedAt);
      // Out of credit is worth its own sentence rather than "refused that
      // request", which sends whoever reads it to look at the prompt.
      return {
        ok: false,
        error:
          response.status === 402
            ? "The image provider's account is out of credit. Search and upload still work."
            : "The image provider refused that request.",
      };
    }

    const parsed = GeneratedImageResponse.safeParse(await response.json());
    if (!parsed.success) {
      await settle(supabase, ticket.id, "invalid_output", "unreadable response", startedAt);
      return { ok: false, error: "The image provider returned something unreadable." };
    }

    // Sniffed here, before this is called a success, and not left to the accept
    // path.
    //
    // The first version put the provider's declared `media_type` in the data
    // URL and mapped anything unrecognised to PNG, on the reasoning that the
    // bytes get read properly when the author accepts. That is true and it is
    // the wrong place: by then the generation is *paid for*. OpenRouter fronts
    // vector models that answer with `image/svg+xml`, so an operator who set
    // `CAPTIVATE_IMAGE_MODEL` to one would get a preview of SVG markup labelled
    // as a PNG — a broken picture — and then "that file isn't an image" when
    // they tried to keep it, with the money already gone and nothing saying
    // why.
    //
    // So an unusable answer is settled as what it is. The spend stands, because
    // the provider did the work and billed for it, but the author is told
    // plainly rather than shown a broken image.
    const bytes = decodeBase64(parsed.data.data[0].b64_json);
    const kind = bytes && sniffImage(bytes);
    if (!kind) {
      await settle(supabase, ticket.id, "invalid_output", "unsupported image format", startedAt);
      return {
        ok: false,
        error:
          "The image provider returned a format Captivate can't store. Try a different image model, or search and upload instead.",
      };
    }

    const generationMs = Date.now() - startedAt;
    await settle(supabase, ticket.id, "succeeded", null, startedAt);

    return {
      ok: true,
      data: {
        // The sniffed type, not the declared one. There is no claim left to be
        // wrong about.
        previewDataUrl: `data:${kind.mimeType};base64,${parsed.data.data[0].b64_json}`,
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
      // Named alongside the model because the model cannot name it: an
      // overridden `CAPTIVATE_IMAGE_MODEL` records the same string through
      // either gateway, which is how the first production row came to say
      // `gpt-image-2` and nothing about who was paid.
      p_provider: IMAGE_PROVIDER,
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
