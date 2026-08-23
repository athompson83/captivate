import { Database, ExternalLink } from "lucide-react";

/**
 * Shown instead of the app when Supabase environment variables are missing.
 * A missing key is a configuration problem, not a crash — say so plainly and
 * give the exact fix rather than a stack trace.
 */
export function SetupRequired() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-16">
      <div className="w-full max-w-lg">
        <div className="border-line mb-5 flex size-11 items-center justify-center rounded-[var(--radius-lg)] border bg-[var(--surface-inset)]">
          <Database className="text-ink-3 size-5" aria-hidden />
        </div>

        <h1 className="text-ink text-xl font-semibold tracking-tight">
          Captivate isn&apos;t connected to a database yet
        </h1>
        <p className="text-ink-3 mt-2 text-sm leading-relaxed">
          The app is deployed, but it needs Supabase credentials before anyone can sign in or save
          work. Set these two environment variables and redeploy.
        </p>

        <dl className="mt-6 space-y-3">
          {[
            ["NEXT_PUBLIC_SUPABASE_URL", "https://<project-ref>.supabase.co"],
            ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "The project's publishable (anon) key"],
          ].map(([name, value]) => (
            <div
              key={name}
              className="border-line-subtle rounded-[var(--radius-md)] border bg-[var(--surface-inset)] px-3.5 py-3"
            >
              <dt className="text-ink font-mono text-[12px] font-medium">{name}</dt>
              <dd className="text-ink-3 mt-1 text-[12px]">{value}</dd>
            </div>
          ))}
        </dl>

        <p className="text-ink-3 mt-6 text-[13px]">
          Full instructions, including the database migrations, are in{" "}
          <code className="text-ink-2 rounded bg-[var(--surface-inset)] px-1 py-0.5 font-mono text-[12px]">
            docs/DEPLOYMENT.md
          </code>
          .
        </p>

        <a
          href="https://supabase.com/dashboard/project/_/settings/api"
          target="_blank"
          rel="noreferrer noopener"
          className="text-accent-text mt-5 inline-flex items-center gap-1.5 text-[13px] font-medium hover:underline"
        >
          Find your Supabase keys
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </div>
    </main>
  );
}
