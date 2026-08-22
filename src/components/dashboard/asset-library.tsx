"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileAudio, FileVideo, Images, Loader2, Trash2, Upload } from "lucide-react";
import { uploadFile, validateFile } from "@/lib/data/upload";
import { deleteAsset, updateAssetAlt } from "@/lib/data/assets";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState, Segmented, Badge } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils/cn";
import { formatBytes, relativeTime } from "@/lib/utils/format";

interface Asset {
  id: string;
  kind: "image" | "video" | "audio" | "file";
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  alt: string;
  filename: string;
  createdAt: string;
  presentationTitle: string | null;
  url: string;
}

/**
 * Media library.
 *
 * A focused reuse surface rather than a DAM: upload, see what you have, fix
 * alt text, delete. Alt text is given real prominence because a deck full of
 * unlabelled images is inaccessible the moment it is shared.
 */
export function AssetLibrary({ assets }: { assets: Asset[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [filter, setFilter] = useState<"all" | "image" | "video" | "audio">("all");
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [detail, setDetail] = useState<Asset | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Asset | null>(null);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const shown = filter === "all" ? assets : assets.filter((a) => a.kind === filter);
  const missingAlt = assets.filter((a) => a.kind === "image" && !a.alt.trim()).length;

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files).slice(0, 20);

    const rejected = list.map((f) => validateFile(f)).filter(Boolean) as string[];
    for (const message of rejected) {
      toast({ tone: "error", title: "Not uploaded", description: message });
    }

    const accepted = list.filter((f) => !validateFile(f));
    if (!accepted.length) return;

    setUploading(accepted.length);
    let succeeded = 0;

    for (const file of accepted) {
      const result = await uploadFile(file);
      if (result.ok) succeeded += 1;
      else
        toast({ tone: "error", title: `Couldn't upload ${file.name}`, description: result.error });
      setUploading((n) => n - 1);
    }

    if (succeeded) {
      toast({
        tone: "success",
        title: `${succeeded} file${succeeded === 1 ? "" : "s"} uploaded`,
        description: "Add alt text so they work for everyone in the room.",
      });
      router.refresh();
    }
  };

  return (
    <div
      className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-10"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void handleFiles(e.dataTransfer.files);
      }}
    >
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-ink text-[22px] font-semibold tracking-tight" style={{ fontFamily: "var(--font-display)" }}>Assets</h1>
          <p className="text-ink-3 mt-1 text-[13px]">
            {assets.length} file{assets.length === 1 ? "" : "s"}
            {missingAlt > 0 && (
              <>
                {" · "}
                <span className="text-warning">
                  {missingAlt} image{missingAlt === 1 ? "" : "s"} without alt text
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex-1" />
        <Segmented
          label="Filter by type"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "image", label: "Images" },
            { value: "video", label: "Video" },
            { value: "audio", label: "Audio" },
          ]}
        />
        <Button
          variant="primary"
          size="sm"
          onClick={() => inputRef.current?.click()}
          loading={uploading > 0}
        >
          <Upload className="size-3.5" aria-hidden />
          Upload
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,video/*,audio/*"
          className="sr-only"
          onChange={(e) => void handleFiles(e.target.files)}
        />
      </header>

      {dragging && (
        <div className="border-accent mb-5 rounded-[var(--radius-lg)] border-2 border-dashed bg-[var(--accent-soft)] py-10 text-center">
          <p className="text-accent-text text-[13px] font-medium">Drop to upload</p>
        </div>
      )}

      {uploading > 0 && (
        <p role="status" className="text-ink-3 mb-5 flex items-center gap-2 text-[13px]">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Uploading {uploading} file{uploading === 1 ? "" : "s"}…
        </p>
      )}

      {shown.length === 0 ? (
        <div className="border-line bg-raised/40 rounded-[var(--radius-lg)] border border-dashed">
          <EmptyState
            icon={<Images />}
            title={assets.length === 0 ? "No assets yet" : "Nothing of that type"}
            description="Images, video and audio you upload here can be reused across any presentation. Drop files anywhere on this page."
            action={
              <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()}>
                <Upload className="size-3.5" aria-hidden />
                Choose files
              </Button>
            }
          />
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {shown.map((asset) => (
            <li key={asset.id}>
              <button
                onClick={() => setDetail(asset)}
                className="group border-line-subtle bg-raised hover:border-line w-full overflow-hidden rounded-[var(--radius-md)] border text-left transition-[border-color,transform] duration-[var(--duration-fast)] hover:-translate-y-0.5"
              >
                <span className="bg-sunken relative flex aspect-square items-center justify-center overflow-hidden">
                  {asset.kind === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={asset.url}
                      alt={asset.alt || asset.filename}
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  ) : asset.kind === "video" ? (
                    <FileVideo className="text-ink-3 size-6" aria-hidden />
                  ) : (
                    <FileAudio className="text-ink-3 size-6" aria-hidden />
                  )}
                  {asset.kind === "image" && !asset.alt.trim() && (
                    <span className="absolute top-1.5 left-1.5">
                      <Badge tone="warning">No alt</Badge>
                    </span>
                  )}
                </span>
                <span className="block px-2.5 py-2">
                  <span className="text-ink block truncate text-[12px]">
                    {asset.filename || "Untitled"}
                  </span>
                  <span className="text-ink-3 block text-[10.5px]">
                    {formatBytes(asset.byteSize)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <AssetDetail
        asset={detail}
        onClose={() => setDetail(null)}
        onDelete={(a) => {
          setDetail(null);
          setDeleteTarget(a);
        }}
        onSaved={() => router.refresh()}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        loading={pending}
        title={`Delete “${deleteTarget?.filename || "this file"}”?`}
        description="Any scene still using it will show a placeholder. This cannot be undone."
        confirmLabel="Delete file"
        onConfirm={() =>
          start(async () => {
            if (!deleteTarget) return;
            const result = await deleteAsset(deleteTarget.id);
            setDeleteTarget(null);
            if (result.ok) {
              toast({ tone: "success", title: "File deleted" });
              router.refresh();
            } else {
              toast({ tone: "error", title: "Couldn't delete", description: result.error });
            }
          })
        }
      />
    </div>
  );
}

function AssetDetail({
  asset,
  onClose,
  onDelete,
  onSaved,
}: {
  asset: Asset | null;
  onClose: () => void;
  onDelete: (a: Asset) => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [alt, setAlt] = useState("");
  const [pending, start] = useTransition();
  const [lastId, setLastId] = useState<string | null>(null);

  // Sync the draft when a different asset is opened, without an effect.
  if (asset && asset.id !== lastId) {
    setLastId(asset.id);
    setAlt(asset.alt);
  }

  const save = () =>
    start(async () => {
      if (!asset) return;
      const result = await updateAssetAlt(asset.id, alt);
      if (result.ok) {
        toast({ tone: "success", title: "Alt text saved" });
        onSaved();
        onClose();
      } else {
        toast({ tone: "error", title: "Couldn't save", description: result.error });
      }
    });

  return (
    <Dialog
      open={Boolean(asset)}
      onClose={onClose}
      title={asset?.filename || "File"}
      description={
        asset
          ? `${asset.mimeType} · ${formatBytes(asset.byteSize)}${asset.width ? ` · ${asset.width}×${asset.height}` : ""} · added ${relativeTime(asset.createdAt)}`
          : undefined
      }
      size="md"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => asset && onDelete(asset)}>
            <Trash2 className="size-3.5" aria-hidden />
            Delete
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" size="sm" onClick={save} loading={pending}>
            Save alt text
          </Button>
        </>
      }
    >
      {asset && (
        <div className="space-y-4">
          <div
            className={cn(
              "border-line-subtle bg-sunken overflow-hidden rounded-[var(--radius-md)] border",
            )}
          >
            {asset.kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={asset.url}
                alt={asset.alt || asset.filename}
                className="max-h-64 w-full object-contain"
              />
            ) : asset.kind === "video" ? (
              <video src={asset.url} controls className="max-h-64 w-full" />
            ) : (
              <div className="p-4">
                <audio src={asset.url} controls className="w-full" />
              </div>
            )}
          </div>

          <Textarea
            label="Alt text"
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            rows={3}
            placeholder="Describe what the image shows and why it's there."
            hint="Read aloud by screen readers. Describe the meaning, not the file."
          />

          {asset.presentationTitle && (
            <p className="text-ink-3 text-[12px]">First used in “{asset.presentationTitle}”.</p>
          )}
        </div>
      )}
    </Dialog>
  );
}
