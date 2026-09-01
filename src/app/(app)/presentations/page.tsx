import type { Metadata } from "next";
import {
  fetchFirstScenes,
  listAllTags,
  listFolders,
  listPresentations,
  listTrashed,
} from "@/lib/data/presentations";
import { PresentationsLibrary } from "@/components/dashboard/presentations-library";

export const metadata: Metadata = { title: "Presentations" };
export const dynamic = "force-dynamic";

export default async function PresentationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    folder?: string;
    tag?: string;
    sort?: string;
    view?: string;
  }>;
}) {
  const { q, folder, tag, sort, view } = await searchParams;

  const [presentations, folders, tags, trashed, previews] = await Promise.all([
    listPresentations({
      search: q,
      folderId: folder === "none" ? null : folder,
      favoritesOnly: view === "favorites",
      tag,
      sort: (sort as "recent" | "opened" | "title" | "created") ?? "recent",
    }),
    listFolders(),
    listAllTags(),
    view === "trash" ? listTrashed() : Promise.resolve([]),
    fetchFirstScenes(),
  ]);

  return (
    <PresentationsLibrary
      presentations={presentations}
      trashed={trashed}
      folders={folders}
      tags={tags}
      previews={Object.fromEntries(previews)}
      filters={{
        q: q ?? "",
        folder: folder ?? "",
        tag: tag ?? "",
        sort: sort ?? "recent",
        view: view ?? "all",
      }}
    />
  );
}
