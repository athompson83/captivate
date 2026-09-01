import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getPresentationMeta } from "@/lib/data/presentations";
import { getRemoteSession } from "@/lib/data/remote-sessions";
import { SetupRequired } from "@/components/setup-required";
import { PhoneRemote } from "@/components/present/phone-remote";

export const dynamic = "force-dynamic";
// The phone remote is handed to a presenter, never found in a search.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "Remote",
  // A phone held in one hand, in a room, with the screen on for a whole talk.
  viewport: { width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false },
};

/**
 * The phone.
 *
 * Structurally parallel to `/console`, and for the same reason the stage route
 * exists separately: this page loads next/prev/blank and a scene number, and
 * nothing else. Speaker notes, lecture notes, the timer and the navigator are
 * not imported here, so a state bug cannot put private material on a device
 * that might be handed to someone.
 *
 * The link a QR code encodes carries no authority of its own — it is this
 * path and a session id, nothing more. Reaching it still requires being signed
 * in as the presentation's owner, and joining the channel still requires the
 * session to be live. A photograph of the code is not a credential.
 */
export default async function RemotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ session?: string }>;
}) {
  if (!isSupabaseConfigured) return <SetupRequired />;

  const { id } = await params;
  const { session: sessionId } = await searchParams;

  const user = await getCurrentUser();
  if (!user) {
    const next = `/present/${id}/remote${sessionId ? `?session=${encodeURIComponent(sessionId)}` : ""}`;
    redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  }

  const presentation = await getPresentationMeta(id);
  if (!presentation) notFound();

  // Resolved here rather than in the browser so an ended or expired session is
  // a page that says so, not a control surface that silently does nothing.
  const session = sessionId ? await getRemoteSession(sessionId) : null;
  const valid = session && session.presentationId === id ? session : null;

  return <PhoneRemote title={presentation.title} presentationId={id} session={valid} />;
}
