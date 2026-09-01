import Link from "next/link";
import type { Metadata } from "next";
import { SignUpForm } from "@/components/auth/sign-up-form";

export const metadata: Metadata = {
  title: "Create your account",
  alternates: { canonical: "/sign-up" },
};

export default function SignUpPage() {
  return (
    <div>
      <h1 className="text-ink text-[26px] font-semibold tracking-tight" style={{ fontFamily: "var(--font-display)" }}>Create your account</h1>
      <p className="text-ink-3 mt-2 text-sm">
        Build your first presentation in the next five minutes.
      </p>

      <SignUpForm />

      <p className="text-ink-3 mt-6 text-[13px]">
        Already have an account?{" "}
        <Link href="/sign-in" className="text-accent-text font-medium hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
