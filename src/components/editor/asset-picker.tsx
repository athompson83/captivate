"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Image as ImageIcon, Link2, Loader2, Upload, Video } from "lucide-react";
import { uploadFile, type UploadedAsset } from "@/lib/data/upload";
import { useToast } from "@/components/ui/toast";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/misc";
import { cn } from "@/lib/utils/cn";
import { formatBytes } from "@/lib/utils/format";

interface LibraryAsset {
  id: string;
  kind: string;
  mimeType: string;
  byteSize: number;
  alt: string;
  filename: string;
  url: string;
}

/**
 * Media chooser: upload a new file, reuse one already in the project, or point
 * at an external URL. Drag-and-drop works anywhere on the panel.
 */
export function AssetPicker({
  kind,
  currentUrl,
  onSelect,
}: {
  kind: "image" | "video" | "audio";
  currentUrl: string;
  onSelect: (asset: { id: string | null; url: string; alt: string }) => void;
}) {
  const { toast } = useToast();
  const [tab, setTab] = useState<"upload" | "library" | "url">("upload");
  const [library, setLibrary] = useState<LibraryAsset[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [urlDraft, setUrlDraft] = useState(currentUrl.startsWith("/api/") ? "" : currentUrl);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (tab !== "library" || library) return;
    let cancelled = false;
    void fetch(`/api/assets?kind=${kind}`)
      .then((r) => (r.ok ? r.json() : { assets: [] }))
      .then((data: { assets: LibraryAsset[] }) => {
        if (!cancelled) setLibrary(data.assets);
      })
      .catch(() => {
        if (!cancelled) setLibrary([]);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, library, kind]);

  const applyAsset = useCallback(
    (asset: UploadedAsset | LibraryAsset) => {
      onSelect({ id: asset.id, url: asset.url, alt: asset.alt });
    },
    [onSelect],
  );

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;

      setBusy(true);
      const result = await uploadFile(file);
      setBusy(false);

      if (!result.ok) {
        toast({ tone: "error", title: "Upload failed", description: result.error });
        return;
      }
      applyAsset(result.asset);
      setLibrary(null); // Refresh the library next time it is opened.
      toast({ tone: "success", title: "Uploaded", description: file.name });
    },
    [toast, applyAsset],
  );

  return (
    <div>
      <Segmented
        label="Media source"
        size="sm"
        value={tab}
        onChange={setTab}
        options={[
          { value: "upload", label: "Upload" },
          { value: "library", label: "Library" },
          { value: "url", label: "URL" },
        ]}
      />

      <div className="mt-2">
        {tab === "upload" && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void handleFiles(e.dataTransfer.files);
            }}
            className={cn(
              "flex flex-col items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-dashed px-3 py-5 text-center transition-colors",
              dragging ? "border-accent bg-[var(--accent-soft)]" : "border-line",
            )}
          >
            {busy ? (
              <>
                <Loader2 className="text-ink-3 size-4 animate-spin" aria-hidden />
                <p className="text-ink-3 text-[11.5px]">Uploading…</p>
              </>
            ) : (
              <>
                <Upload className="text-ink-3 size-4" aria-hidden />
                <button
                  onClick={() => inputRef.current?.click()}
                  className="text-accent-text text-[12px] font-medium hover:underline"
                >
                  Choose a file
                </button>
                <p className="text-ink-3 text-[10.5px]">or drop it here · up to 50 MB</p>
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              accept={`${kind}/*`}
              className="sr-only"
              onChange={(e) => void handleFiles(e.target.files)}
            />
          </div>
        )}

        {tab === "library" && (
          <div className="max-h-[190px] overflow-y-auto">
            {library === null ? (
              <div className="grid grid-cols-3 gap-1.5">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="skeleton aspect-square rounded-[var(--radius-sm)]" />
                ))}
              </div>
            ) : library.length === 0 ? (
              <p className="text-ink-3 py-6 text-center text-[11.5px]">
                Nothing uploaded yet. Files you add appear here for reuse.
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-1.5">
                {library.map((asset) => (
                  <button
                    key={asset.id}
                    onClick={() => applyAsset(asset)}
                    title={`${asset.filename} · ${formatBytes(asset.byteSize)}`}
                    className={cn(
                      "group relative aspect-square overflow-hidden rounded-[var(--radius-sm)] border transition-colors",
                      currentUrl === asset.url
                        ? "border-accent"
                        : "border-line-subtle hover:border-line-strong",
                    )}
                  >
                    {asset.kind === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element -- private signed redirect
                      <img
                        src={asset.url}
                        alt={asset.alt || asset.filename}
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    ) : (
                      <span className="flex size-full items-center justify-center bg-[var(--surface-inset)]">
                        {asset.kind === "video" ? (
                          <Video className="text-ink-3 size-4" aria-hidden />
                        ) : (
                          <ImageIcon className="text-ink-3 size-4" aria-hidden />
                        )}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "url" && (
          <div className="space-y-2">
            <Input
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              placeholder="https://…"
              aria-label="Media URL"
              hint="Linked files aren't stored by Captivate and may disappear."
            />
            <button
              onClick={() => {
                const trimmed = urlDraft.trim();
                if (!/^https:\/\//i.test(trimmed)) {
                  toast({
                    tone: "error",
                    title: "Use an https:// URL",
                    description: "Insecure URLs are blocked on the stage.",
                  });
                  return;
                }
                onSelect({ id: null, url: trimmed, alt: "" });
              }}
              className="border-line text-ink-2 hover:border-line-strong hover:text-ink flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] border py-1.5 text-[12px] font-medium transition-colors"
            >
              <Link2 className="size-3.5" aria-hidden />
              Use this URL
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
