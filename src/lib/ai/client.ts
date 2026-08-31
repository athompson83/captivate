"use client";

import type { SceneContent } from "@/lib/schema/presentation";
import type { ProposedMap, RewriteMode } from "./schemas";
import type { AvailableEvidence } from "@/lib/narrative/generate";
import type { Reference } from "@/lib/ingest/reference";

/**
 * Browser-side callers for the AI routes.
 *
 * Every function returns a discriminated result rather than throwing, so an AI
 * failure surfaces as a message next to the button that caused it and never
 * unmounts the editor or touches the document.
 */

export type AiResult<T> = ({ ok: true } & T) | { ok: false; error: string };

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<AiResult<T>> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });

    const data = (await response.json().catch(() => null)) as (T & { error?: string }) | null;

    if (!response.ok) {
      return {
        ok: false,
        error: data?.error ?? `That didn't work (${response.status}). Nothing was changed.`,
      };
    }
    if (!data) return { ok: false, error: "The server returned an empty response." };

    return { ok: true, ...data };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { ok: false, error: "Cancelled." };
    }
    return { ok: false, error: "Couldn't reach the server. Your work is unaffected." };
  }
}

export interface AudienceContext {
  audience?: string;
  tone?: string;
  sceneCount?: number;
  /** A file the author handed over, already read and bounded in the browser. */
  reference?: Reference | null;
}

/**
 * Prompt → a proposed argument.
 *
 * Nothing is created and nothing is written. The map comes back with the
 * evidence the user actually owns, so the review step can show what a claim is
 * grounded in without a second round trip.
 */
export function requestMap(
  input: { prompt: string; totalSeconds?: number; recommendedShape?: string } & AudienceContext,
  signal?: AbortSignal,
): Promise<
  AiResult<{
    proposal: ProposedMap;
    available: AvailableEvidence[];
    source: "model" | "fallback";
    notice?: string;
  }>
> {
  return post("/api/ai/map", input, signal);
}

/** An accepted map → a real presentation. Ids and evidence are the server's. */
export function requestPresentationFromMap(
  input: {
    prompt: string;
    map: ProposedMap;
    totalSeconds: number;
    depth?: "outline" | "full";
    themeId?: string;
    folderId?: string | null;
  } & AudienceContext,
  signal?: AbortSignal,
): Promise<
  AiResult<{
    id: string;
    sceneCount: number;
    source: "model" | "fallback";
    droppedEvidence: number;
    notice?: string;
  }>
> {
  return post("/api/ai/create-from-map", input, signal);
}

export function requestScene(
  input: {
    instruction: string;
    presentationId?: string | null;
    presentationTitle?: string;
    neighbouring?: string[];
  } & AudienceContext,
  signal?: AbortSignal,
): Promise<
  AiResult<{
    scenes: { title: string; content: SceneContent; speakerNotes: string; imagePrompt: string }[];
    source: "model" | "fallback";
    notice?: string;
  }>
> {
  return post("/api/ai/scene", input, signal);
}

export function requestRewrite(
  input: { text: string; mode: RewriteMode; presentationId?: string | null } & AudienceContext,
  signal?: AbortSignal,
): Promise<AiResult<{ options: string[]; source: "model" | "fallback" }>> {
  return post("/api/ai/rewrite", input, signal);
}

export function generateSpeakerNotes(
  input: { presentationId: string; sceneId: string; existingNotes: string } & AudienceContext,
  signal?: AbortSignal,
): Promise<AiResult<{ notes: string }>> {
  return post("/api/ai/notes", input, signal);
}

export function requestVisuals(
  input: { title: string; text: string; presentationId?: string | null } & AudienceContext,
  signal?: AbortSignal,
): Promise<
  AiResult<{ suggestions: { description: string; placement: string; altText: string }[] }>
> {
  return post("/api/ai/visuals", input, signal);
}

export interface AiAvailability {
  configured: boolean;
  stockSearch: boolean;
  imageGeneration: boolean;
}

const UNAVAILABLE: AiAvailability = {
  configured: false,
  stockSearch: false,
  imageGeneration: false,
};

let statusCache: Promise<AiAvailability> | null = null;

/** What this deployment has keys for. Cached — it cannot change mid-session. */
export function aiAvailability(): Promise<AiAvailability> {
  statusCache ??= fetch("/api/ai/status")
    .then((r) => (r.ok ? r.json() : UNAVAILABLE))
    .then((d: Partial<AiAvailability>) => ({ ...UNAVAILABLE, ...d }))
    .catch(() => UNAVAILABLE);
  return statusCache;
}

/** Whether a text model is configured. */
export function aiConfigured(): Promise<boolean> {
  return aiAvailability().then((a) => a.configured);
}
