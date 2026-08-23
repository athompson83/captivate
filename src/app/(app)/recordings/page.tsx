import type { Metadata } from "next";
import { listRecordings } from "@/lib/data/recordings";
import { RecordingsLibrary } from "@/components/dashboard/recordings-library";

export const metadata: Metadata = { title: "Recordings" };
export const dynamic = "force-dynamic";

export default async function RecordingsPage({
  searchParams,
}: {
  searchParams: Promise<{ open?: string }>;
}) {
  const [{ open }, recordings] = await Promise.all([searchParams, listRecordings()]);
  return <RecordingsLibrary recordings={recordings} initialOpenId={open ?? null} />;
}
