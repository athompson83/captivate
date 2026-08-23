import type { Metadata } from "next";
import { listNotes } from "@/lib/data/notes";
import { listPresentations } from "@/lib/data/presentations";
import { NotesWorkspace } from "@/components/notes/notes-workspace";

export const metadata: Metadata = { title: "Notes" };
export const dynamic = "force-dynamic";

export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<{ presentation?: string; note?: string }>;
}) {
  const { presentation, note } = await searchParams;

  const [notes, presentations] = await Promise.all([
    listNotes(presentation ?? null),
    listPresentations({ sort: "recent", limit: 100 }),
  ]);

  return (
    <NotesWorkspace
      initialNotes={notes}
      presentations={presentations.map((p) => ({ id: p.id, title: p.title }))}
      filterPresentationId={presentation ?? null}
      initialNoteId={note ?? null}
    />
  );
}
