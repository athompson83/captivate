import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, FileText, Plus, Sparkles, Video } from "lucide-react";
import { listPresentations } from "@/lib/data/presentations";
import { supabaseServer } from "@/lib/supabase/server";
import { parseSceneContent, type SceneContent } from "@/lib/schema/presentation";
import { PresentationCard } from "@/components/dashboard/presentation-card";
import { EmptyState } from "@/components/ui/misc";
import { relativeTime, formatDuration } from "@/lib/utils/format";
import { TEMPLATES } from "@/lib/templates/registry";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [recent, previews, recordings, profile] = await Promise.all([
    listPresentations({ sort: "recent", limit: 8 }),
    fetchFirstScenes(),
    supabase
      .from("recordings")
      .select("id, title, duration_seconds, created_at, status, presentation_id")
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .limit(3),
    supabase.from("profiles").select("display_name").eq("id", user?.id ?? "").maybeSingle(),
  ]);

  const firstName = (profile.data?.display_name ?? "").split(/\s+/)[0] || "there";
  const continueDeck = recent[0];

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
      <header className="mb-8">
        <h1 className="text-[26px] font-semibold tracking-tight text-ink">
          {greeting()}, {firstName}
        </h1>
        <p className="mt-1.5 text-[14px] text-ink-3">
          {recent.length === 0
            ? "Let's build your first presentation."
            : continueDeck
              ? `Last edited “${continueDeck.title}” ${relativeTime(continueDeck.updatedAt)}.`
              : "Pick up where you left off."}
        </p>
      </header>

      {/* Primary actions. Three, not twelve. */}
      <div className="mb-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          href="/new?mode=ai"
          className="group relative overflow-hidden rounded-[var(--radius-lg)] border border-line-subtle bg-raised p-5 transition-[border-color,transform,box-shadow] duration-[var(--duration-base)] hover:-translate-y-0.5 hover:border-line hover:shadow-[var(--shadow-md)]"
        >
          <span
            aria-hidden
            className="absolute -right-8 -top-8 size-24 rounded-full opacity-[0.14] transition-opacity group-hover:opacity-25"
            style={{ background: "var(--ai)" }}
          />
          <Sparkles className="size-4 text-ai" aria-hidden />
          <h2 className="mt-3 text-[14px] font-semibold text-ink">Create with AI</h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">
            Describe your topic. Review the outline before anything is created.
          </p>
          <span className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-ai-text">
            Start <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </span>
        </Link>

        <Link
          href="/new"
          className="group rounded-[var(--radius-lg)] border border-line-subtle bg-raised p-5 transition-[border-color,transform,box-shadow] duration-[var(--duration-base)] hover:-translate-y-0.5 hover:border-line hover:shadow-[var(--shadow-md)]"
        >
          <Plus className="size-4 text-accent" aria-hidden />
          <h2 className="mt-3 text-[14px] font-semibold text-ink">New presentation</h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">
            Start from a clear stage, or from one of {TEMPLATES.length - 1} structures.
          </p>
          <span className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-accent-text">
            Create <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </span>
        </Link>

        {continueDeck ? (
          <Link
            href={`/edit/${continueDeck.id}`}
            className="group rounded-[var(--radius-lg)] border border-line-subtle bg-raised p-5 transition-[border-color,transform,box-shadow] duration-[var(--duration-base)] hover:-translate-y-0.5 hover:border-line hover:shadow-[var(--shadow-md)]"
          >
            <FileText className="size-4 text-ink-2" aria-hidden />
            <h2 className="mt-3 truncate text-[14px] font-semibold text-ink">Continue editing</h2>
            <p className="mt-1 truncate text-[12.5px] text-ink-3">{continueDeck.title}</p>
            <span className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-ink-2">
              Open <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </span>
          </Link>
        ) : (
          <Link
            href="/templates"
            className="group rounded-[var(--radius-lg)] border border-line-subtle bg-raised p-5 transition-[border-color,transform,box-shadow] duration-[var(--duration-base)] hover:-translate-y-0.5 hover:border-line hover:shadow-[var(--shadow-md)]"
          >
            <FileText className="size-4 text-ink-2" aria-hidden />
            <h2 className="mt-3 text-[14px] font-semibold text-ink">Browse templates</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">
              Lecture, pitch, case study, workshop and report structures.
            </p>
            <span className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-ink-2">
              Browse <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </span>
          </Link>
        )}
      </div>

      <section aria-labelledby="recent-heading">
        <div className="mb-3.5 flex items-baseline justify-between">
          <h2 id="recent-heading" className="text-[14px] font-semibold text-ink">
            Recent
          </h2>
          {recent.length > 0 && (
            <Link href="/presentations" className="text-[12.5px] text-ink-3 hover:text-ink-2">
              All presentations
            </Link>
          )}
        </div>

        {recent.length === 0 ? (
          <div className="rounded-[var(--radius-lg)] border border-dashed border-line bg-raised/40">
            <EmptyState
              icon={FileText}
              title="No presentations yet"
              description="Create one from a prompt, start from a template, or open a blank stage. Everything you make lives here."
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Link
                    href="/new?mode=ai"
                    className="rounded-[var(--radius-md)] bg-ai px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
                  >
                    Create with AI
                  </Link>
                  <Link
                    href="/new"
                    className="rounded-[var(--radius-md)] border border-line px-4 py-2 text-[13px] font-medium text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
                  >
                    Start blank
                  </Link>
                </div>
              }
            />
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {recent.map((p) => (
              <li key={p.id}>
                <PresentationCard presentation={p} preview={previews.get(p.id) ?? null} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {(recordings.data?.length ?? 0) > 0 && (
        <section aria-labelledby="recordings-heading" className="mt-10">
          <div className="mb-3.5 flex items-baseline justify-between">
            <h2 id="recordings-heading" className="text-[14px] font-semibold text-ink">
              Recent recordings
            </h2>
            <Link href="/recordings" className="text-[12.5px] text-ink-3 hover:text-ink-2">
              All recordings
            </Link>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(recordings.data ?? []).map((r) => (
              <li key={r.id}>
                <Link
                  href={`/recordings?open=${r.id}`}
                  className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-line-subtle bg-raised p-3.5 transition-colors hover:border-line"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--record-soft)]">
                    <Video className="size-4 text-record" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">{r.title}</span>
                    <span className="block text-[11.5px] text-ink-3">
                      {formatDuration(Number(r.duration_seconds))} · {relativeTime(r.created_at)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Still up";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * One query for every deck's first scene, used to render live card previews.
 * Fetching position-0 scenes in a single round trip keeps the dashboard at two
 * queries regardless of how many decks are shown.
 */
async function fetchFirstScenes(): Promise<Map<string, SceneContent>> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("scenes")
    .select("presentation_id, content, position")
    .eq("position", 0)
    .limit(60);

  const map = new Map<string, SceneContent>();
  for (const row of data ?? []) {
    map.set(row.presentation_id, parseSceneContent(row.content).content);
  }
  return map;
}
