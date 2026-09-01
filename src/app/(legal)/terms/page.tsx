import type { Metadata } from "next";
import { supportEmail } from "@/lib/site";

/**
 * The working agreement, in plain words.
 *
 * Describes how the product actually behaves — what the plans are, who owns
 * what, what happens when a limit is reached — rather than reciting boilerplate
 * that would not survive being checked against the code. Anything that is a
 * business or legal decision rather than an observable behaviour is left for
 * the owner to settle; nothing here invents one.
 */
export const metadata: Metadata = {
  title: "Terms",
  description: "The terms Captivate is offered under, and what each side is responsible for.",
  alternates: { canonical: "/terms" },
};

const UPDATED = "1 September 2026";

export default function TermsPage() {
  const email = supportEmail();

  return (
    <>
      <h1>Terms</h1>
      <p className="lead">
        The short version of how Captivate is offered and what each side is responsible for. Last
        updated {UPDATED}.
      </p>

      <h2>Your account</h2>
      <p>
        One account, one person. Keep your password to yourself — anyone holding it can read and
        change everything in your account, and Captivate cannot tell the difference between them and
        you.
      </p>

      <h2>Your work is yours</h2>
      <p>
        Everything you write, upload or generate in Captivate belongs to you. Using the product does
        not give anyone a claim over your decks, and they are not used to train anything. What is
        stored and what is sent to which processor is set out on the{" "}
        <a href="/privacy">privacy page</a>.
      </p>
      <p>
        You are responsible for having the right to use what you put in — an image you upload, a
        document you attach as reference, a recording of a room full of people.
      </p>

      <h2>Plans and limits</h2>
      <p>
        Captivate is free to use, with a monthly allowance of AI generations. Pro raises those
        limits and adds generated imagery; what each plan includes is on the{" "}
        <a href="/pricing">pricing page</a>, and the numbers there are read from the same
        configuration the limits are enforced with, so the two cannot disagree.
      </p>
      <p>
        Reaching a limit stops further AI requests until the window rolls over. It never touches
        what you have already made.
      </p>
      <p>
        Paid plans are billed through Stripe and can be cancelled from your settings at any time,
        which stops the next renewal.
      </p>

      <h2>AI-generated content</h2>
      <p>
        Captivate can draft an argument, rewrite a line and generate an image. A model can be
        confidently wrong, so treat what it produces as a first draft: check anything you intend to
        present as fact, particularly where a talk carries clinical, legal or safety weight.
      </p>

      <h2>What is not promised</h2>
      <p>
        Captivate is provided as it is. It is under active development, it can be unavailable, and
        it can have defects. Keep your own copy of anything you cannot afford to lose — the deck
        export exists partly for that.
      </p>

      <h2>Ending it</h2>
      <p>
        You can stop using Captivate whenever you like. An account that is used to break these
        terms, to attack the service, or to process content that is unlawful may be suspended.
      </p>

      <h2>Getting in touch</h2>
      {email ? (
        <p>
          Questions about these terms can go to <a href={`mailto:${email}`}>{email}</a>.
        </p>
      ) : (
        <p>Questions about these terms should go to whoever runs this deployment of Captivate.</p>
      )}
    </>
  );
}
