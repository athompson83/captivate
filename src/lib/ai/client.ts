"use client";

import type { SceneContent } from "@/lib/schema/presentation";
import type { PresentationOutline, RewriteMode } from "./schemas";

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
}

export function requestOutline(
  input: { prompt: string } & AudienceContext,
  signal?: AbortSignal,
): Promise<
  AiResult<{ outline: PresentationOutline; source: "model" | "fallback"; notice?: string }>
> {
  return post("/api/ai/outline", input, signal);
}

export function requestPresentation(
  input: { prompt: string; outline: PresentationOutline; themeId?: string } & AudienceContext,
  signal?: AbortSignal,
): Promise<
  AiResult<{ id: string; sceneCount: number; source: "model" | "fallback"; notice?: string }>
> {
  return post("/api/ai/generate", input, signal);
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

let statusCache: Promise<boolean> | null = null;

/** Whether a model is configured. Cached — it cannot change mid-session. */
export function aiConfigured(): Promise<boolean> {
  statusCache ??= fetch("/api/ai/status")
    .then((r) => (r.ok ? r.json() : { configured: false }))
    .then((d: { configured: boolean }) => d.configured)
    .catch(() => false);
  return statusCache;
}
