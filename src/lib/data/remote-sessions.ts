"use server";

import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import type { Result } from "./actions";
import type { PresentationSessionRow } from "@/lib/supabase/database.types";

/**
 * Opening and closing a phone remote.
 *
 * A session is minted only when the presenter asks for one, and the Realtime
 * topic is derived from its id. Nothing listens on a network until then: the
 * stage does not hold a connection for every present session on the chance a
 * phone might appear, and a deck nobody has paired has no reachable channel at
 * all.
 *
 * Neither of these takes an owner id from the caller. The insert policy
 * requires the deck to be the caller's, so a session row can never claim to
 * control someone else's presentation, and the channel gate reads the row.
 */

const Uuid = z.string().uuid();

export interface RemoteSession {
  id: string;
  presentationId: string;
  expiresAt: string;
}

const toSession = (row: PresentationSessionRow): RemoteSession => ({
  id: row.id,
  presentationId: row.presentation_id,
  expiresAt: row.expires_at,
});

/**
 * Opens a remote session for a presentation, reusing a live one if there is one.
 *
 * Reuse matters: a presenter who taps "Connect phone" twice, or reloads the
 * stage mid-talk, should get back the link already on their phone rather than
 * a second session that silently orphans the first.
 */
export async function startRemoteSession(presentationId: unknown): Promise<Result<RemoteSession>> {
  if (!Uuid.safeParse(presentationId).success) return { ok: false, error: "Invalid id." };
  const supabase = await supabaseServer();

  const { data: live, error: liveError } = await supabase
    .from("presentation_sessions")
    .select("*")
    .eq("presentation_id", presentationId as string)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (liveError) return { ok: false, error: liveError.message };
  if (live) return { ok: true, data: toSession(live as PresentationSessionRow) };

  const { data, error } = await supabase
    .from("presentation_sessions")
    .insert({ presentation_id: presentationId as string })
    .select("*")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Couldn't open a remote session for this presentation." };

  return { ok: true, data: toSession(data as PresentationSessionRow) };
}

/**
 * Closes a remote session.
 *
 * The channel gate reads `status`, so this is what actually revokes a phone's
 * access — not closing the socket, which a client could simply reopen.
 */
export async function endRemoteSession(sessionId: unknown): Promise<Result<void>> {
  if (!Uuid.safeParse(sessionId).success) return { ok: false, error: "Invalid id." };
  const supabase = await supabaseServer();

  const { error } = await supabase
    .from("presentation_sessions")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("id", sessionId as string);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: undefined };
}

/** The session a phone was sent to, if it is still joinable. Null otherwise. */
export async function getRemoteSession(sessionId: unknown): Promise<RemoteSession | null> {
  if (!Uuid.safeParse(sessionId).success) return null;
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from("presentation_sessions")
    .select("*")
    .eq("id", sessionId as string)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error || !data) return null;
  return toSession(data as PresentationSessionRow);
}
