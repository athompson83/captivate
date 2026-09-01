import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getPresentationDocument } from "@/lib/data/presentations";
import { SetupRequired } from "@/components/setup-required";
import { HandoutView } from "@/components/handout/handout-view";

export const dynamic = "force-dynamic";

/**
 * The paper version.
 *
 * A presentation is a camera over one canvas, but what people ask for after a
 * talk is a file — so the handout renders every scene as a page, in order,
 * with the argument's movements labelling the stretch each scene belongs to.
 * Printing it (or "Save as PDF" in the print dialog) is the export; there is
 * no second rendering path to drift out of step with the real one.
 *
 * This route is the owner's, which is why it may also offer speaker notes:
 * unlike the stage, nothing here is ever pointed at an audience.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const doc = await getPresentationDocument(id).catch(() => null);
  // Reachable by link, which is what makes it unlisted rather than public.
  return {
    title: doc ? `${doc.presentation.title} — handout` : "Handout",
    robots: { index: false, follow: false },
  };
}

export default async function HandoutPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequired />;

  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(`/handout/${id}`)}`);

  const document = await getPresentationDocument(id);
  if (!document) notFound();

  return (
    <HandoutView
      presentation={document.presentation}
      scenes={document.scenes}
      sections={document.sections}
    />
  );
}
