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
        <div className="mb-5 flex size-11 items-center justify-center rounded-[var(--radius-lg)] border border-line bg-[var(--surface-inset)]">
          <Database className="size-5 text-ink-3" aria-hidden />
        </div>

        <h1 className="text-xl font-semibold tracking-tight text-ink">
          Captivate isn&apos;t connected to a database yet
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-3">
          The app is deployed, but it needs Supabase credentials before anyone can sign in or
          save work. Set these two environment variables and redeploy.
        </p>

        <dl className="mt-6 space-y-3">
          {[
            ["NEXT_PUBLIC_SUPABASE_URL", "https://<project-ref>.supabase.co"],
            ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "The project's publishable (anon) key"],
          ].map(([name, value]) => (
            <div
              key={name}
              className="rounded-[var(--radius-md)] border border-line-subtle bg-[var(--surface-inset)] px-3.5 py-3"
            >
              <dt className="font-mono text-[12px] font-medium text-ink">{name}</dt>
              <dd className="mt-1 text-[12px] text-ink-3">{value}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-6 text-[13px] text-ink-3">
          Full instructions, including the database migrations, are in{" "}
          <code className="rounded bg-[var(--surface-inset)] px-1 py-0.5 font-mono text-[12px] text-ink-2">
            docs/DEPLOYMENT.md
          </code>
          .
        </p>

        <a
          href="https://supabase.com/dashboard/project/_/settings/api"
          target="_blank"
          rel="noreferrer noopener"
          className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-accent-text hover:underline"
        >
          Find your Supabase keys
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </div>
    </main>
  );
}
