"use client";

import { useEffect, useState } from "react";
import { Loader2, Smartphone, X } from "lucide-react";
import { endRemoteSession, startRemoteSession, type RemoteSession } from "@/lib/data/remote-sessions";

/**
 * Pairing a phone.
 *
 * The code encodes a plain link — this route and a session id, nothing else.
 * It is convenience, not a credential: opening it still requires being signed
 * in as the presentation's owner, and joining the channel still requires the
 * session to be live. A photograph of the code buys nothing, which is the
 * reason there is no token in it to photograph.
 */
export function ConnectPhone({
  presentationId,
  session,
  connected,
  onSession,
}: {
  presentationId: string;
  session: RemoteSession | null;
  connected: boolean;
  onSession: (session: RemoteSession | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    const result = await startRemoteSession(presentationId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSession(result.data);
    setOpen(true);
  };

  const stop = async () => {
    if (!session) return;
    setBusy(true);
    const result = await endRemoteSession(session.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSession(null);
    setOpen(false);
  };

  return (
    <>
      <button
        onClick={() => (session ? setOpen(true) : void start())}
        disabled={busy}
        aria-label={session ? "Phone remote" : "Connect a phone"}
        className="text-ink-2 hover:text-ink relative flex size-9 items-center justify-center rounded-[var(--radius-md)] transition-colors disabled:opacity-50"
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <Smartphone className="size-4" aria-hidden />
        )}
        {session && (
          <span
            aria-hidden
            className={`absolute top-1.5 right-1.5 size-1.5 rounded-full ${
              connected ? "bg-[var(--success)]" : "bg-[var(--warning)]"
            }`}
          />
        )}
      </button>

      {open && session && (
        <PairingSheet
          presentationId={presentationId}
          session={session}
          connected={connected}
          busy={busy}
          error={error}
          onClose={() => setOpen(false)}
          onDisconnect={() => void stop()}
        />
      )}
      {!open && error && (
        <p role="alert" className="sr-only">
          {error}
        </p>
      )}
    </>
  );
}

function PairingSheet({
  presentationId,
  session,
  connected,
  busy,
  error,
  onClose,
  onDisconnect,
}: {
  presentationId: string;
  session: RemoteSession;
  connected: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onDisconnect: () => void;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const url =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}/present/${presentationId}/remote?session=${session.id}`;

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    // Loaded on demand: the encoder is only ever needed by this sheet, and
    // presenting should not pay for it.
    void import("qrcode")
      .then((mod) => mod.toDataURL(url, { margin: 1, width: 320, errorCorrectionLevel: "M" }))
      .then((data) => {
        if (!cancelled) setQr(data);
      })
      .catch(() => {
        // The link below is the fallback, and it is the thing that matters.
        if (!cancelled) setQr(null);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Connect a phone"
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="border-line w-full max-w-sm rounded-[var(--radius-lg)] border bg-[var(--surface-overlay)] p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-ink text-[15px] font-medium">Connect a phone</h2>
            <p className="text-ink-3 mt-0.5 text-[12px]">
              {connected ? "A phone is connected." : "Scan this on a phone signed in to your account."}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-ink-3 hover:text-ink flex size-7 items-center justify-center rounded-[var(--radius-sm)]"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div className="mt-4 grid place-items-center rounded-[var(--radius-md)] bg-white p-3">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element -- a data: URI, generated in the browser
            <img src={qr} alt={`QR code linking to ${url}`} className="size-[220px]" />
          ) : (
            <div className="text-ink-3 grid size-[220px] place-items-center text-center text-[12px]">
              Use the link below
            </div>
          )}
        </div>

        <p className="text-ink-3 mt-3 text-[11.5px] break-all">{url}</p>
        <p className="text-ink-3 mt-2 text-[11.5px]">
          The link is not a key: the phone still has to be signed in as you, and this session stops
          working the moment you disconnect it.
        </p>

        {error && (
          <p role="alert" className="mt-3 text-[12px] text-[var(--danger)]">
            {error}
          </p>
        )}

        <button
          onClick={onDisconnect}
          disabled={busy}
          className="border-line text-ink-2 hover:text-ink mt-4 flex min-h-9 w-full items-center justify-center rounded-[var(--radius-md)] border text-[12.5px] font-medium disabled:opacity-50"
        >
          Disconnect
        </button>
      </div>
    </div>
  );
}
