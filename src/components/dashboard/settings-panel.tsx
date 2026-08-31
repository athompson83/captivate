"use client";

import { useActionState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { updateProfile, type ActionResult } from "@/lib/auth/actions";
import { useTheme } from "@/components/ui/theme-provider";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/auth/forms";
import { Segmented } from "@/components/ui/misc";
import { formatDate } from "@/lib/utils/format";
import { SHORTCUTS } from "@/lib/editor/shortcuts";
import { BillingSection } from "./billing-section";
import type { SubscriptionSummary } from "@/lib/billing/entitlement";

/**
 * Account settings.
 *
 * Deliberately small. A settings system that grows faster than the product is
 * a sign the product hasn't decided what it is.
 */
export function SettingsPanel({
  email,
  displayName,
  memberSince,
  counts,
  billing,
}: {
  email: string;
  displayName: string;
  memberSince: string | null;
  counts: { presentations: number; notes: number; assets: number; recordings: number };
  billing: {
    configured: boolean;
    testMode: boolean;
    summary: SubscriptionSummary | null;
    usage: { decksUsed: number; deckAllowance: number };
  };
}) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(updateProfile, null);
  const { pref, setPref } = useTheme();

  return (
    <div className="mx-auto max-w-2xl px-5 py-8 sm:px-8 sm:py-10">
      <h1
        className="text-ink text-[22px] font-semibold tracking-tight"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Settings
      </h1>

      <section className="mt-8" aria-labelledby="profile-heading">
        <h2 id="profile-heading" className="text-ink text-[14px] font-semibold">
          Profile
        </h2>
        <form action={formAction} className="mt-3 space-y-4">
          <FormMessage state={state} />
          <Input
            label="Display name"
            name="displayName"
            defaultValue={displayName}
            required
            maxLength={80}
            error={state && !state.ok && state.field === "displayName" ? state.error : undefined}
          />
          <Input
            label="Email"
            value={email}
            disabled
            readOnly
            hint="Contact support to change your email address."
          />
          <Button type="submit" variant="primary" size="sm">
            Save profile
          </Button>
        </form>
      </section>

      <BillingSection
        configured={billing.configured}
        testMode={billing.testMode}
        summary={billing.summary}
        usage={billing.usage}
      />

      <section className="mt-10" aria-labelledby="appearance-heading">
        <h2 id="appearance-heading" className="text-ink text-[14px] font-semibold">
          Appearance
        </h2>
        <p className="text-ink-3 mt-1 text-[13px]">
          Applies to the Captivate interface. Presentation themes are set per deck.
        </p>
        <div className="mt-3">
          <Segmented
            label="Interface theme"
            value={pref}
            onChange={setPref}
            options={[
              { value: "system", label: "System", icon: Monitor },
              { value: "light", label: "Light", icon: Sun },
              { value: "dark", label: "Dark", icon: Moon },
            ]}
          />
        </div>
      </section>

      <section className="mt-10" aria-labelledby="content-heading">
        <h2 id="content-heading" className="text-ink text-[14px] font-semibold">
          Your content
        </h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Presentations", counts.presentations],
            ["Notes", counts.notes],
            ["Assets", counts.assets],
            ["Recordings", counts.recordings],
          ].map(([label, value]) => (
            <div
              key={label as string}
              className="border-line-subtle bg-raised rounded-[var(--radius-md)] border px-3.5 py-3"
            >
              <dt className="text-ink-3 text-[11.5px]">{label as string}</dt>
              <dd className="text-ink mt-0.5 text-[19px] font-semibold tabular-nums">
                {value as number}
              </dd>
            </div>
          ))}
        </dl>
        {memberSince && (
          <p className="text-ink-3 mt-3 text-[12px]">Account created {formatDate(memberSince)}.</p>
        )}
      </section>

      <section className="mt-10" aria-labelledby="shortcuts-heading">
        <h2 id="shortcuts-heading" className="text-ink text-[14px] font-semibold">
          Keyboard shortcuts
        </h2>
        <dl className="border-line-subtle bg-raised mt-3 divide-y divide-[var(--border-subtle)] rounded-[var(--radius-md)] border">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="flex items-center justify-between gap-4 px-3.5 py-2">
              <dt className="text-ink-2 text-[12.5px]">{s.action}</dt>
              <dd>
                <kbd className="border-line-subtle text-ink-3 rounded border bg-[var(--surface-inset)] px-1.5 py-0.5 font-sans text-[11px]">
                  {s.keys}
                </kbd>
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-ink-3 mt-3 text-[12px] leading-relaxed">
          While presenting: arrows or space to advance, <Kbd>L</Kbd> laser, <Kbd>H</Kbd> highlight,{" "}
          <Kbd>D</Kbd> draw, <Kbd>E</Kbd> erase, <Kbd>C</Kbd> clear, <Kbd>B</Kbd> blank the screen,{" "}
          <Kbd>F</Kbd> full screen, and number keys to jump to a scene.
        </p>
      </section>

      <section className="border-line-subtle mt-10 border-t pt-6" aria-labelledby="session-heading">
        <h2 id="session-heading" className="text-ink text-[14px] font-semibold">
          Session
        </h2>
        <form action="/auth/sign-out" method="post" className="mt-3">
          <Button type="submit" variant="secondary" size="sm">
            Sign out
          </Button>
        </form>
      </section>
    </div>
  );
}

const Kbd = ({ children }: { children: React.ReactNode }) => (
  <kbd className="border-line-subtle text-ink-2 rounded border bg-[var(--surface-inset)] px-1 py-0.5 font-sans text-[10.5px]">
    {children}
  </kbd>
);
