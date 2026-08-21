"use client";

import Link from "next/link";
import { signIn } from "@/lib/auth/actions";
import { Input } from "@/components/ui/input";
import { FormMessage, SubmitButton, fieldError, useAuthAction } from "./forms";

export function SignInForm({ next }: { next?: string }) {
  const [state, formAction] = useAuthAction(signIn);

  return (
    <form action={formAction} className="mt-8 space-y-4">
      {next && <input type="hidden" name="next" value={next} />}
      <FormMessage state={state} />

      <Input
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        autoFocus
        placeholder="you@example.com"
        error={fieldError(state, "email")}
      />

      <div>
        <Input
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="••••••••"
          error={fieldError(state, "password")}
        />
        <div className="mt-2 text-right">
          <Link href="/reset-password" className="text-xs text-ink-3 hover:text-ink-2">
            Forgot your password?
          </Link>
        </div>
      </div>

      <SubmitButton>Sign in</SubmitButton>
    </form>
  );
}
