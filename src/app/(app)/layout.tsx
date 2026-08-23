import { redirect } from "next/navigation";
import { getCurrentUser, supabaseServer } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AppShell } from "@/components/app-shell";
import { SetupRequired } from "@/components/setup-required";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured) return <SetupRequired />;

  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const supabase = await supabaseServer();
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <AppShell
      user={{
        email: user.email ?? "",
        displayName: profile?.display_name || user.email?.split("@")[0] || "You",
        avatarUrl: profile?.avatar_url ?? null,
      }}
    >
      {children}
    </AppShell>
  );
}
