import Link from "next/link";
import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata: Metadata = { title: "Reset your password" };

export default function ResetPasswordPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Reset your password</h1>
      <p className="mt-2 text-sm text-ink-3">
        Enter your email and we&apos;ll send you a link to set a new one.
      </p>

      <ResetPasswordForm />

      <p className="mt-6 text-[13px] text-ink-3">
        <Link href="/sign-in" className="font-medium text-accent-text hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
