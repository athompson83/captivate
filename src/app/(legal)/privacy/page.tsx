import type { Metadata } from "next";
import { supportEmail } from "@/lib/site";

/**
 * What the software actually does with a user's data.
 *
 * Written from the code rather than from a template: every processor named
 * here is one this application really sends data to, and every category of
 * stored data corresponds to a table in `supabase/migrations/`. `AGENTS.md`
 * says documentation must not describe something the code does not do, and a
 * privacy page is the worst possible place to break that rule — it is the one
 * page a reader is entitled to treat as a promise.
 *
 * Kept to what can be verified. Where the product has no answer yet — account
 * deletion is the notable one — this says so rather than implying otherwise.
 */
export const metadata: Metadata = {
  title: "Privacy",
  description: "What Captivate stores, who processes it, and what leaves the application.",
  alternates: { canonical: "/privacy" },
};

const UPDATED = "1 September 2026";

export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy</h1>
      <p className="lead">
        Captivate is a tool for writing and presenting talks. This page describes what it stores,
        what leaves it, and who else processes it. Last updated {UPDATED}.
      </p>

      <h2>What is stored</h2>
      <ul>
        <li>
          <strong>Your account.</strong> The email address you sign up with and the name you choose
          to be called. Your password is checked against the policy on the way past and handed
          straight to Supabase, which is what stores it; Captivate keeps no copy of it and cannot
          recover it.
        </li>
        <li>
          <strong>What you write.</strong> Presentations, movements, scenes, the narrative map,
          speaker notes and lecture notes.
        </li>
        <li>
          <strong>What you upload or generate.</strong> Images and video you add to a deck, and
          recordings you make, including any transcript produced from them.
        </li>
        <li>
          <strong>What AI you used.</strong> For each AI request: the prompt, which model answered,
          how many tokens it cost and whether it succeeded. This is what enforces plan limits, so it
          is kept for as long as the account exists.
        </li>
        <li>
          <strong>Billing state,</strong> if you subscribe: the identifiers Stripe uses for your
          customer and subscription records. Card details are handled by Stripe and never reach
          Captivate.
        </li>
      </ul>

      <h2>What leaves Captivate</h2>
      <p>
        Only what a feature needs, only when you use that feature. Nothing here is sent for
        advertising, and none of these processors is asked to identify you.
      </p>
      <ul>
        <li>
          <strong>Anthropic</strong> — the text you ask AI to work from, when you generate or
          rewrite anything.
        </li>
        <li>
          <strong>OpenAI</strong> — the description you type, when you generate an image.
        </li>
        <li>
          <strong>Pexels</strong> — your search terms, when you search stock photography.
        </li>
        <li>
          <strong>Stripe</strong> — your email and billing details, if you subscribe.
        </li>
        <li>
          <strong>Supabase</strong> and <strong>Vercel</strong> — the database, file storage and
          hosting the application runs on.
        </li>
      </ul>
      <p>
        A reference file you attach so AI can work from your own material is read in your browser
        and is not uploaded; only the text extracted from it is sent, and only as part of the
        prompt.
      </p>

      <h2>Who can see your work</h2>
      <p>
        Your decks are private to your account. The database enforces that per row rather than in
        application code, so a bug in a page cannot expose another account&rsquo;s work.
      </p>
      <p>
        One thing you can choose to make reachable: a <strong>share link</strong>, which lets anyone
        holding the URL open that one deck until you revoke it. It is not listed in search —
        Captivate asks crawlers not to index it, because who sees a share link is your decision and
        not a search engine&rsquo;s. Speaker notes and lecture notes are never included in it.
      </p>
      <p>
        A <strong>handout</strong> is not a share link. It is a printable version of your own deck
        and it needs your account: anyone else opening that URL is sent to sign in. Sharing one
        means sharing the file you print from it, which is then outside Captivate.
      </p>

      <h2>Deleting things</h2>
      <p>
        You can delete a presentation, a recording or an uploaded file at any time from the
        application.
      </p>
      <p>
        Deleting a whole account is not yet self-service. If you want your account and everything in
        it removed, get in touch and it will be done by hand.
      </p>

      <h2>Getting in touch</h2>
      <Contact />
    </>
  );
}

/**
 * Prints an address only when one is configured.
 *
 * A privacy page naming a mailbox nobody reads is worse than one that admits it
 * has none, so where `NEXT_PUBLIC_SUPPORT_EMAIL` is unset this says where to
 * ask instead of inventing something plausible.
 */
function Contact() {
  const email = supportEmail();
  if (!email) {
    return (
      <p>
        Questions about any of this, or a request to delete your account, should go to whoever runs
        this deployment of Captivate.
      </p>
    );
  }
  return (
    <p>
      Questions about any of this, or a request to delete your account, can go to{" "}
      <a href={`mailto:${email}`}>{email}</a>.
    </p>
  );
}
