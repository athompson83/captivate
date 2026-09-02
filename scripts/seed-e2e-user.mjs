/**
 * Creates the synthetic account the authenticated Playwright project signs in as.
 *
 * This exists because those journeys need a real user and there was nowhere to
 * get one. Production has email confirmation on, so a synthetic hosted sign-up
 * would need a mailbox nobody owns; the suite was therefore skipped everywhere
 * and twenty-eight real journeys — authoring, presenting, the camera, the
 * narrative map — were never exercised by CI.
 *
 * Against a local stack there is no such problem. The admin API creates the
 * account already confirmed, so this does not depend on the `enable_confirmations`
 * setting in config.toml being what we think it is.
 *
 * It only ever talks to whatever SUPABASE_URL points at, which in CI is a
 * container that is destroyed with the job. Pointing it at a hosted project
 * would create a real user there, so it refuses anything that is not local.
 */

const url = process.env.SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.CAPTIVATE_E2E_EMAIL;
const password = process.env.CAPTIVATE_E2E_PASSWORD;

for (const [name, value] of Object.entries({
  SUPABASE_URL: url,
  SUPABASE_SERVICE_ROLE_KEY: serviceRole,
  CAPTIVATE_E2E_EMAIL: email,
  CAPTIVATE_E2E_PASSWORD: password,
})) {
  if (!value) {
    console.error(`seed-e2e-user: ${name} is not set.`);
    process.exit(1);
  }
}

// A service-role key is enough to create users, so a mistyped URL here would
// silently seed a synthetic account into a real project. Refuse rather than
// trust the caller.
const host = new URL(url).hostname;
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  console.error(
    `seed-e2e-user: refusing to seed ${host}. This script is for a local stack only; ` +
      "it creates a confirmed user with a known password.",
  );
  process.exit(1);
}

let response;
try {
  response = await fetch(new URL("/auth/v1/admin/users", url), {
    method: "POST",
    headers: {
      apikey: serviceRole,
      authorization: `Bearer ${serviceRole}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
} catch (error) {
  // Almost always the stack not being up yet. A stack trace here reads as a
  // bug in this script; the actual next step is to look at `supabase start`.
  console.error(
    `seed-e2e-user: could not reach ${url} — is the local stack running? ` +
      (error instanceof Error ? error.message : String(error)),
  );
  process.exit(1);
}

const body = await response.json().catch(() => null);

/**
 * Signs in as the seeded account, retrying briefly.
 *
 * Two jobs. It proves the credential actually works, so a bad password fails
 * here with one line rather than as twenty-eight confusing UI timeouts. And it
 * absorbs the clock skew between the freshly started containers and the host:
 * GoTrue mints a token with an `iat` from the container's clock, and if that
 * runs ahead the app rejects it as "JWT issued at future" — which is what the
 * first real run of this job hit, on the dashboard, seconds after sign-in.
 * Waiting for one token to be accepted is a real readiness check; sleeping a
 * fixed number of seconds only looks like one.
 */
async function waitForUsableSignIn() {
  const deadline = Date.now() + 60_000;
  let lastProblem = "never attempted";

  while (Date.now() < deadline) {
    try {
      const attempt = await fetch(new URL("/auth/v1/token?grant_type=password", url), {
        method: "POST",
        headers: { apikey: serviceRole, "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const token = await attempt.json().catch(() => null);

      if (attempt.ok && typeof token?.access_token === "string") {
        // `iat` in the future is the failure being guarded against, so check it
        // rather than trusting that a 200 means the app will accept the token.
        const [, payload] = token.access_token.split(".");
        const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
        const skew = claims.iat * 1000 - Date.now();
        if (skew <= 0) {
          console.log(`seed-e2e-user: ${email} can sign in`);
          return;
        }
        lastProblem = `token issued ${Math.ceil(skew / 1000)}s in the future`;
      } else {
        lastProblem =
          typeof token?.error_description === "string"
            ? token.error_description
            : `HTTP ${attempt.status}`;
      }
    } catch (error) {
      lastProblem = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  console.error(`seed-e2e-user: ${email} could not sign in within 60s — ${lastProblem}`);
  process.exit(1);
}

if (response.ok) {
  console.log(`seed-e2e-user: created ${email}`);
  await waitForUsableSignIn();
  process.exit(0);
}

// Re-running against a stack that already has the account is success, not
// failure: the job may retry, and the account is what matters, not who made it.
const message = typeof body?.msg === "string" ? body.msg : JSON.stringify(body);
if (response.status === 422 && /already been registered|already exists/i.test(message)) {
  console.log(`seed-e2e-user: ${email} already exists`);
  await waitForUsableSignIn();
  process.exit(0);
}

console.error(`seed-e2e-user: ${response.status} ${message}`);
process.exit(1);
