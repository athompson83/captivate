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
      <h1 className="text-ink text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="text-ink-3 mt-2 text-sm">Sign in to pick up where you left off.</p>

      <SignInForm next={next} />

      <p className="text-ink-3 mt-6 text-[13px]">
        New to Captivate?{" "}
        <Link href="/sign-up" className="text-accent-text font-medium hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
