import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getPresentationDocument } from "@/lib/data/presentations";
import { listNotes } from "@/lib/data/notes";
import { SetupRequired } from "@/components/setup-required";
import { PresenterConsole } from "@/components/present/presenter-console";

export const dynamic = "force-dynamic";
// Presenter-facing, and the console is where the private notes live.
export const metadata: Metadata = {
  title: "Presenter console",
  robots: { index: false, follow: false },
};

export default async function ConsolePage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequired />;

  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(`/present/${id}/console`)}`);

  const document = await getPresentationDocument(id);
  if (!document) notFound();

  const lectureNotes = await listNotes(id);

  return (
    <PresenterConsole
      presentation={document.presentation}
      scenes={document.scenes}
      sections={document.sections}
      lectureNotes={lectureNotes}
    />
  );
}
