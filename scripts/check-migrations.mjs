#!/usr/bin/env node
/**
 * Does the database being deployed to actually have what the app needs?
 *
 * Twice now a migration has existed in this repository and not in production,
 * and both times it read as a code bug. First `captivate_reserve_generation`
 * was missing, so every AI call failed closed — "the AI didn't work". Then
 * `captivate_reserve_image_generation` and every provenance column were
 * missing, so image generation and stock search would have done the same for
 * every user.
 *
 * Nothing in the pipeline catches it. The build is green, the unit suite is
 * green, and the RLS suite is green *because* it applies every migration to a
 * scratch database first — every check ran against a database that was not the
 * one serving users.
 *
 * This asks the target database directly, using `supabase/schema_required.sql`.
 * Deliberately not a comparison against the migration ledger's names: Supabase
 * records `0001` as two rows, `0004` as two more, and `0008_search_path` as
 * `captivate_harden_functions`, so name matching produces false alarms — and a
 * check that cries wolf is worse than no check at all.
 *
 *   SUPABASE_DB_URL=postgres://... npm run migrations:check
 *
 * Exits 1 when something is missing, and 2 when it could not look. A check
 * that could not run must never read as a pass.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error(
    "SUPABASE_DB_URL is not set.\n" +
      "Supabase dashboard → Project Settings → Database → Connection string (URI).\n" +
      "Nothing was checked, so do not read this as a pass.",
  );
  process.exit(2);
}

let stdout;
try {
  ({ stdout } = await run("psql", [url, "-q", "-f", join(root, "supabase", "schema_required.sql")], {
    maxBuffer: 8 * 1024 * 1024,
  }));
} catch (error) {
  console.error("Could not question the database:", error.stderr || error.message);
  process.exit(2);
}

const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
const missing = lines.filter((l) => l.startsWith("MISSING"));
/*
 * Absence is a requirement too, and it is not the negation of the list above.
 * A dropped function can come back — Postgres overloads by signature, so a
 * `create or replace` with fewer arguments leaves the old one callable — and a
 * database carrying both would otherwise pass, because everything the
 * application needs really is there. What is also there is the signature that
 * was removed for a reason.
 */
const forbidden = lines.filter((l) => l.startsWith("FORBIDDEN"));

for (const line of lines) console.log(line);

if (missing.length) {
  console.error(
    `\n${missing.length} thing(s) the application needs are not in that database. ` +
      "Each one fails closed for every user, and nothing else in the pipeline will say so.\n" +
      "Apply the migrations in supabase/migrations/ in order, then run this again.",
  );
  process.exit(1);
}

if (forbidden.length) {
  console.error(
    `\n${forbidden.length} thing(s) that were removed on purpose are still in that database. ` +
      "The application works either way, which is what makes this worth failing on.\n" +
      "Drop each one, then run this again.",
  );
  process.exit(1);
}
console.log(`\nAll ${lines.length} required objects are present.`);
