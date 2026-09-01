import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getPresentationDocument } from "@/lib/data/presentations";
import { forAudience } from "@/lib/present/audience";
import { SetupRequired } from "@/components/setup-required";
import { PresentRoot } from "@/components/present/present-root";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const doc = await getPresentationDocument(id).catch(() => null);
  // The stage is driven by a presenter, not browsed.
  return {
    title: doc ? doc.presentation.title : "Present",
    robots: { index: false, follow: false },
  };
}

export default async function PresentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ audience?: string }>;
}) {
  if (!isSupabaseConfigured) return <SetupRequired />;

  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(`/present/${id}`)}`);

  const document = await getPresentationDocument(id);
  if (!document) notFound();

  const { audience } = await searchParams;

  return (
    <PresentRoot
      presentation={document.presentation}
      // Stripped, not merely unrendered. Every prop a client component takes
      // is serialised into the payload this window downloads, so passing the
      // scenes through unchanged put the whole deck's speaker notes into the
      // source of the page on the projector.
      scenes={forAudience(document.scenes)}
      sections={document.sections}
      // In audience mode the window is a pure display: no controls are rendered
      // at all, so there is nothing to accidentally reveal on a projector.
      audienceOnly={audience === "1"}
    />
  );
}
