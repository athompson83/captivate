"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { Check, Copy, ExternalLink, Globe, Link2Off, Printer } from "lucide-react";
import { setSharing } from "@/lib/data/actions";
import { useEditor } from "@/lib/editor/store";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { DeckExport } from "./deck-export";

/**
 * Sharing, stated plainly.
 *
 * One switch and one link. The link is a capability — whoever holds it can
 * view the deck, nobody can edit through it, and revoking kills every copy at
 * once. The dialog says exactly that, because a share control people don't
 * quite trust is a share control they don't use.
 */

/** The origin is a client-only constant; read it as one, not during SSR. */
const subscribeNever = () => () => {};
const readOrigin = () => window.location.origin;
const serverOrigin = () => "";

export function ShareDialog({
  presentationId,
  open,
  onClose,
}: {
  presentationId: string;
  open: boolean;
  onClose: () => void;
}) {
  const initialToken = useEditor((s) => s.document.presentation.shareToken);
  const origin = useSyncExternalStore(subscribeNever, readOrigin, serverOrigin);
  const { toast } = useToast();

  // Dialog-local: the store's copy of the token is only re-read on reload,
  // and this dialog stays mounted, so its state is the live one.
  const [token, setToken] = useState<string | null>(initialToken);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const url = token ? `${origin}/v/${token}` : null;

  const apply = async (enabled: boolean) => {
    setBusy(true);
    try {
      const result = await setSharing({ id: presentationId, enabled });
      if (!result.ok) {
        toast({ tone: "error", title: "Sharing change failed", description: result.error });
        return;
      }
      setToken(result.data.shareToken);
      setCopied(false);
      if (!enabled) {
        toast({
          tone: "info",
          title: "Link revoked",
          description: "Old copies of the link no longer work.",
        });
      }
    } catch {
      // A server action can reject outright (network, deploy in progress).
      toast({
        tone: "error",
        title: "Sharing change failed",
        description: "Try again in a moment.",
      });
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        tone: "error",
        title: "Couldn't copy",
        description: "Select the link and copy it manually.",
      });
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Share a view-only link" size="sm">
      <div className="space-y-4">
        <p className="text-ink-3 text-[12.5px] leading-relaxed">
          Anyone with the link can walk through the presentation at their own pace — scenes and the
          journey only. Speaker notes never leave your account, and nobody can edit.
        </p>

        {token ? (
          <>
            <div className="border-line bg-raised flex items-center gap-2 rounded-[var(--radius-md)] border p-2 pl-3">
              <Globe className="text-success size-3.5 shrink-0" aria-hidden />
              <input
                readOnly
                value={url ?? ""}
                onFocus={(e) => e.currentTarget.select()}
                aria-label="Share link"
                className="text-ink-2 min-w-0 flex-1 bg-transparent text-[12px] outline-none"
              />
              <Button variant="ghost" size="sm" onClick={() => void copy()} aria-label="Copy link">
                {copied ? (
                  <Check className="text-success size-3.5" aria-hidden />
                ) : (
                  <Copy className="size-3.5" aria-hidden />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <div className="flex items-center justify-between gap-3">
              <a
                href={url ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="text-ink-3 hover:text-ink inline-flex items-center gap-1.5 text-[12px] font-medium transition-colors"
              >
                <ExternalLink className="size-3.5" aria-hidden />
                Preview what they&apos;ll see
              </a>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void apply(false)}>
                <Link2Off className="size-3.5" aria-hidden />
                Revoke link
              </Button>
            </div>
          </>
        ) : (
          <Button variant="primary" size="sm" disabled={busy} onClick={() => void apply(true)}>
            <Globe className="size-3.5" aria-hidden />
            Create share link
          </Button>
        )}

        <div className="border-line-subtle space-y-3 border-t pt-3">
          <Link
            href={`/handout/${presentationId}`}
            onClick={onClose}
            className="text-ink-3 hover:text-ink inline-flex items-center gap-1.5 text-[12px] font-medium transition-colors"
          >
            <Printer className="size-3.5" aria-hidden />
            Prefer a file? Open the handout — print it or save as PDF
          </Link>
          <DeckExport onDone={onClose} />
        </div>
      </div>
    </Dialog>
  );
}
