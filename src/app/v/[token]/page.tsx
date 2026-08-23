import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getSharedDeck } from "@/lib/data/shared";
import { SharedViewer } from "@/components/present/shared-viewer";

export const dynamic = "force-dynamic";

/**
 * The public face of a share link.
 *
 * No sign-in, no session: the token in the URL is the entire authorisation,
 * resolved through one SECURITY DEFINER function that only ever returns
 * audience-safe fields. A dead link — revoked, mistyped, deleted deck — is a
 * plain 404, indistinguishable from a link that never existed.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  if (!isSupabaseConfigured) return { title: "Shared presentation" };
  const { token } = await params;
  const deck = await getSharedDeck(token).catch(() => null);
  return {
    title: deck ? deck.title : "Shared presentation",
    description: deck?.description || undefined,
  };
}

export default async function SharedPresentationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  if (!isSupabaseConfigured) notFound();

  const { token } = await params;
  const deck = await getSharedDeck(token);
  if (!deck) notFound();

  return <SharedViewer deck={deck} />;
}
