import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getPresentationDocument } from "@/lib/data/presentations";
import { markPresentationOpened } from "@/lib/data/actions";
import { SetupRequired } from "@/components/setup-required";
import { EditorRoot } from "@/components/editor/editor-root";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const doc = await getPresentationDocument(id).catch(() => null);
  // A deck being edited belongs to one author; a crawler only ever gets the
  // sign-in redirect, and should not be asking in the first place.
  return {
    title: doc ? `${doc.presentation.title} — Edit` : "Edit",
    robots: { index: false, follow: false },
  };
}

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequired />;

  const user = await getCurrentUser();
  const { id } = await params;
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(`/edit/${id}`)}`);

  const document = await getPresentationDocument(id);
  // RLS means "not found" and "not yours" are indistinguishable here, which is
  // exactly what we want to expose.
  if (!document) notFound();

  void markPresentationOpened(id);

  return <EditorRoot document={document} />;
}
