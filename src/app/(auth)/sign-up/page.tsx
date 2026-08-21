import Link from "next/link";
import type { Metadata } from "next";
import { SignUpForm } from "@/components/auth/sign-up-form";

export const metadata: Metadata = { title: "Create your account" };

export default function SignUpPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Create your account</h1>
      <p className="mt-2 text-sm text-ink-3">
        Build your first presentation in the next five minutes.
      </p>

      <SignUpForm />

      <p className="mt-6 text-[13px] text-ink-3">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium text-accent-text hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
