import type { Metadata } from "next";
import { supabaseServer } from "@/lib/supabase/server";
import { SettingsPanel } from "@/components/dashboard/settings-panel";
import { deckUsage, grantSummary, subscriptionSummary } from "@/lib/billing/entitlement";
import { isBillingConfigured, isTestMode } from "@/lib/billing/stripe";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [profile, counts, summary, grant, usage] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, created_at")
      .eq("id", user?.id ?? "")
      .maybeSingle(),
    Promise.all([
      supabase
        .from("presentations")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null),
      supabase.from("lecture_notes").select("id", { count: "exact", head: true }),
      supabase.from("assets").select("id", { count: "exact", head: true }),
      supabase.from("recordings").select("id", { count: "exact", head: true }),
    ]),
    subscriptionSummary(),
    grantSummary(),
    deckUsage(),
  ]);

  return (
    <SettingsPanel
      email={user?.email ?? ""}
      displayName={profile.data?.display_name ?? ""}
      memberSince={profile.data?.created_at ?? user?.created_at ?? null}
      counts={{
        presentations: counts[0].count ?? 0,
        notes: counts[1].count ?? 0,
        assets: counts[2].count ?? 0,
        recordings: counts[3].count ?? 0,
      }}
      billing={{
        configured: isBillingConfigured(),
        testMode: isTestMode(),
        summary,
        grant,
        usage,
      }}
    />
  );
}
