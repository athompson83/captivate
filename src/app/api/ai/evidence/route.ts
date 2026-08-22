import { NextResponse } from "next/server";
import { listEvidence } from "@/lib/data/evidence";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * What this user can ground a claim in.
 *
 * Read through the request-scoped client so RLS decides what is visible; the
 * route never takes an owner from the caller.
 */
export async function GET() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ evidence: [] }, { status: 401 });

  const evidence = await listEvidence();
  return NextResponse.json({ evidence });
}
