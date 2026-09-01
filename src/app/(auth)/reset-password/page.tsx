import Link from "next/link";
import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

// A step in a flow, not a page anyone should arrive on from a search.
export const metadata: Metadata = {
  title: "Reset your password",
  robots: { index: false, follow: false },
};

export default function ResetPasswordPage() {
  return (
    <div>
      <h1
        className="text-ink text-[24px] font-semibold tracking-tight"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Reset your password
      </h1>
      <p className="text-ink-3 mt-2 text-sm">
        Enter your email and we&apos;ll send you a link to set a new one.
      </p>

      <ResetPasswordForm />

      <p className="text-ink-3 mt-6 text-[13px]">
        <Link href="/sign-in" className="text-accent-text font-medium hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
