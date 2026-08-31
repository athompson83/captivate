"use client";

import { useRef, useState } from "react";
import { FileText, Loader2, Paperclip, X } from "lucide-react";
import {
  ACCEPTED_REFERENCE_TYPES,
  describeReference,
  type Reference,
} from "@/lib/ingest/reference";

/**
 * "I already have this — build my talk from it."
 *
 * An author writing a lecture usually has the lecture already: last year's
 * deck, the paper it rests on, a set of notes. Without this the model writes a
 * talk *about* the topic, which is the thing that makes generated
 * presentations feel like a party trick rather than a draft of their work.
 *
 * The file never leaves the browser. It is unzipped and read here, and only
 * the extracted text — bounded, and shown to the author first — is sent. That
 * keeps document parsing off the server entirely and means an author can see
 * exactly what the model was given before pressing anything.
 *
 * The reader loads on first use: a zip library is a lot of bytes for a control
 * most sessions never touch.
 */
export function ReferencePicker({
  reference,
  onChange,
}: {
  reference: Reference | null;
  onChange: (reference: Reference | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const take = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const { readReference } = await import("@/lib/ingest/read-file");
    const result = await readReference(file);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      onChange(null);
      return;
    }
    onChange(result.reference);
  };

  return (
    <div>
      <p className="text-ink-2 mb-1.5 text-[13px] font-medium">Build it from a file you have</p>

      {reference ? (
        <div className="border-line-subtle bg-raised flex items-start gap-2.5 rounded-[var(--radius-md)] border p-3">
          <FileText className="text-accent mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-ink truncate text-[13px] font-medium">{reference.name}</p>
            <p className="text-ink-3 mt-0.5 text-[12px] leading-relaxed">
              {describeReference(reference)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setError(null);
              if (input.current) input.current.value = "";
            }}
            aria-label={`Remove ${reference.name}`}
            className="text-ink-3 hover:text-ink flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] transition-colors hover:bg-[var(--surface-inset)]"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
          className="border-line hover:border-line-strong text-ink-2 hover:text-ink flex w-full items-center gap-2 rounded-[var(--radius-md)] border border-dashed px-3 py-2.5 text-[13px] transition-colors disabled:opacity-60"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Paperclip className="size-4" aria-hidden />
          )}
          {busy ? "Reading…" : "Attach a deck, document or notes"}
        </button>
      )}

      <input
        ref={input}
        type="file"
        accept={ACCEPTED_REFERENCE_TYPES}
        className="sr-only"
        onChange={(event) => void take(event.target.files?.[0])}
      />

      <p className="text-ink-3 mt-1.5 text-[12px] leading-relaxed">
        {error ??
          "PowerPoint, Word, Markdown or plain text. Read in your browser — the file itself is never uploaded."}
      </p>
    </div>
  );
}
