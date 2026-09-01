"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, Search, Sparkles } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { Input } from "@/components/ui/input";
import { saveGeneratedImage, saveStockPhoto } from "@/lib/data/sourced-assets";

/**
 * Finding a picture, and making one.
 *
 * Both offer rather than apply: a search result or a generation is a preview
 * until the author picks it, and only then does anything reach storage. That is
 * the same rule the rest of the AI surface follows, and it matters more here
 * because these two are the only ones that cost money or owe a credit.
 */

interface StockResult {
  thumbnailUrl: string;
  fullUrl: string;
  providerAssetId: string;
  originalPageUrl: string;
  creatorName: string;
  creatorPageUrl: string;
  licenseRef: string;
  altText: string;
}

interface Generated {
  previewDataUrl: string;
  model: string;
  prompt: string;
  quality: string;
  generationMs: number;
}

type Applied = { id: string | null; url: string; alt: string };

export function StockSearch({
  initialQuery,
  presentationId,
  onApply,
}: {
  initialQuery: string;
  presentationId: string | null;
  onApply: (asset: Applied) => void;
}) {
  const { toast } = useToast();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<StockResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setNotice(null);
    const response = await fetch("/api/ai/visuals/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    }).catch(() => null);
    setBusy(false);

    const data = (await response?.json().catch(() => null)) as {
      results?: StockResult[];
      error?: string;
    } | null;
    if (!response?.ok) {
      setNotice(data?.error ?? "Couldn't search for images.");
      setResults(null);
      return;
    }
    setResults(data?.results ?? []);
  };

  const choose = async (result: StockResult) => {
    setSaving(result.providerAssetId);
    const saved = await saveStockPhoto({ ...result, presentationId });
    setSaving(null);
    if (!saved.ok) {
      toast({ tone: "error", title: "Couldn't use that image", description: saved.error });
      return;
    }
    onApply({ id: saved.data.id, url: saved.data.url, alt: result.altText });
  };

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
        className="flex gap-1.5"
      >
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="What should the picture show?"
          aria-label="Search for a photograph"
        />
        <button
          type="submit"
          disabled={busy || !query.trim()}
          className="border-line text-ink-2 hover:text-ink flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] border disabled:opacity-40"
          aria-label="Search"
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Search className="size-3.5" aria-hidden />
          )}
        </button>
      </form>

      {notice && (
        <p className="text-ink-3 mt-2 text-[11.5px]" role="status">
          {notice}
        </p>
      )}

      {results?.length === 0 && (
        <p className="text-ink-3 mt-2 text-[11.5px]">
          Nothing matched that. A more concrete description usually finds more.
        </p>
      )}

      {results && results.length > 0 && (
        <ul className="mt-2 grid grid-cols-3 gap-1.5">
          {results.map((result) => (
            <li key={result.providerAssetId}>
              <button
                onClick={() => void choose(result)}
                disabled={saving !== null}
                className="border-line-subtle hover:border-accent group relative block w-full overflow-hidden rounded-[var(--radius-sm)] border disabled:opacity-50"
                title={`${result.altText} — ${result.creatorName}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- a provider thumbnail, not a local asset */}
                <img
                  src={result.thumbnailUrl}
                  alt={result.altText}
                  className="aspect-[3/2] w-full object-cover"
                  loading="lazy"
                />
                {saving === result.providerAssetId && (
                  <span className="absolute inset-0 grid place-items-center bg-black/50">
                    <Loader2 className="size-4 animate-spin text-white" aria-hidden />
                  </span>
                )}
              </button>
              <p className="text-ink-3 mt-0.5 truncate text-[10px]">{result.creatorName}</p>
            </li>
          ))}
        </ul>
      )}

      {results && results.length > 0 && (
        <p className="text-ink-3 mt-2 text-[10.5px]">
          Photographs from Pexels. The photographer is credited in the asset library.
        </p>
      )}
    </div>
  );
}

/**
 * Prompts that describe something a picture can be *wrong* about.
 *
 * Not a block, and not an attempt at certainty: a model asked for an ECG trace
 * or a dosage chart will produce something that looks authoritative and is
 * invented, and the honest mechanism is to say so before the author spends the
 * generation rather than after. False-positive blocking would only push people
 * around it.
 */
const FACTUAL_HINTS =
  /\b(ecg|ekg|x-?ray|mri|ct scan|scan|dosage|dose|mg\b|mcg\b|lab (results?|values?)|chart|graph|blood pressure|vitals|waveform|rhythm strip|label|prescription|formula|equation|statistic|percentage|data)\b/i;

export function ImageGeneration({
  initialPrompt,
  presentationId,
  onApply,
}: {
  initialPrompt: string;
  presentationId: string | null;
  onApply: (asset: Applied) => void;
}) {
  const { toast } = useToast();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [preview, setPreview] = useState<Generated | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const looksFactual = FACTUAL_HINTS.test(prompt);

  const run = async () => {
    setBusy(true);
    setNotice(null);
    const response = await fetch("/api/ai/visuals/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, presentationId }),
    }).catch(() => null);
    setBusy(false);

    const data = (await response?.json().catch(() => null)) as {
      image?: Generated;
      error?: string;
    } | null;
    if (!response?.ok || !data?.image) {
      setNotice(data?.error ?? "Couldn't generate an image.");
      return;
    }
    setPreview(data.image);
  };

  const accept = async () => {
    if (!preview) return;
    setSaving(true);
    const saved = await saveGeneratedImage({
      dataUrl: preview.previewDataUrl,
      prompt: preview.prompt,
      model: preview.model,
      quality: preview.quality,
      generationMs: preview.generationMs,
      altText: preview.prompt.slice(0, 200),
      presentationId,
    });
    setSaving(false);
    if (!saved.ok) {
      toast({ tone: "error", title: "Couldn't use that image", description: saved.error });
      return;
    }
    onApply({ id: saved.data.id, url: saved.data.url, alt: preview.prompt.slice(0, 200) });
  };

  return (
    <div>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={3}
        aria-label="Describe the image to generate"
        placeholder="Describe the picture you want."
        className="border-line text-ink w-full resize-none rounded-[var(--radius-md)] border bg-[var(--surface-inset)] px-2 py-1.5 text-[12px]"
      />

      {/* Persistent, not dismissible: it is true of every generated image. */}
      <p className="text-ink-3 mt-1.5 flex gap-1.5 text-[10.5px] leading-relaxed">
        <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />
        <span>
          Generated images are illustrations, not evidence. Never present one as a real trace,
          chart, label or reading.
        </span>
      </p>

      {looksFactual && !preview && (
        <p
          role="status"
          className="mt-1.5 rounded-[var(--radius-sm)] bg-[var(--warning-soft)] px-2 py-1.5 text-[11px] leading-relaxed text-[var(--warning-text)]"
        >
          This prompt describes something a picture can be wrong about. A model has no access to the
          real trace, figures or label, so it will invent something that looks right. Use a real
          image if the audience might read it as data.
        </p>
      )}

      <button
        onClick={() => void run()}
        disabled={busy || !prompt.trim()}
        className="border-line text-ink-2 hover:border-ai hover:text-ai-text mt-2 flex min-h-8 w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] border text-[11.5px] font-medium disabled:opacity-40"
      >
        {busy ? (
          <Loader2 className="size-3 animate-spin" aria-hidden />
        ) : (
          <Sparkles className="size-3" aria-hidden />
        )}
        {preview ? "Generate another" : "Generate an image"}
      </button>

      {notice && (
        <p className="text-ink-3 mt-2 text-[11.5px]" role="status">
          {notice}
        </p>
      )}

      {preview && (
        <div className="mt-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- a data: URI held in memory until accepted */}
          <img
            src={preview.previewDataUrl}
            alt={`Generated from: ${preview.prompt}`}
            className="border-line-subtle w-full rounded-[var(--radius-sm)] border"
          />
          <button
            onClick={() => void accept()}
            disabled={saving}
            className="bg-accent text-on-accent mt-1.5 flex min-h-8 w-full items-center justify-center rounded-[var(--radius-md)] text-[11.5px] font-medium disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-3 animate-spin" aria-hidden /> : "Use this image"}
          </button>
        </div>
      )}
    </div>
  );
}
