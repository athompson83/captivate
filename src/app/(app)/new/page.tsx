import type { Metadata } from "next";
import { CreateFlow } from "@/components/dashboard/create-flow";
import { listFolders } from "@/lib/data/presentations";

export const metadata: Metadata = { title: "New presentation" };
export const dynamic = "force-dynamic";

export default async function NewPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; folder?: string }>;
}) {
  const { mode, folder } = await searchParams;
  const folders = await listFolders().catch(() => []);

  return (
    <CreateFlow
      initialMode={mode === "ai" ? "ai" : "template"}
      folders={folders}
      folderId={folder ?? null}
    />
  );
}
