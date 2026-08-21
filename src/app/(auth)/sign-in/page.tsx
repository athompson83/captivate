import Link from "next/link";
import type { Metadata } from "next";
import { SignInForm } from "@/components/auth/sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Welcome back</h1>
      <p className="mt-2 text-sm text-ink-3">Sign in to pick up where you left off.</p>

      <SignInForm next={next} />

      <p className="mt-6 text-[13px] text-ink-3">
        New to Captivate?{" "}
        <Link href="/sign-up" className="font-medium text-accent-text hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
