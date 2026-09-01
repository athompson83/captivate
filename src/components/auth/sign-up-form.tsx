"use client";

import { signUp } from "@/lib/auth/actions";
import { Input } from "@/components/ui/input";
import { FormMessage, SubmitButton, fieldError, useAuthAction } from "./forms";
import { PASSWORD_MIN } from "@/lib/auth/password";

export function SignUpForm() {
  const [state, formAction] = useAuthAction(signUp);

  return (
    <form action={formAction} className="mt-8 space-y-4">
      <FormMessage state={state} />

      <Input
        label="Your name"
        name="displayName"
        autoComplete="name"
        required
        autoFocus
        placeholder="Alex Thompson"
        error={fieldError(state, "displayName")}
      />
      <Input
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        placeholder="you@example.com"
        error={fieldError(state, "email")}
      />
      <Input
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={PASSWORD_MIN}
        placeholder={`At least ${PASSWORD_MIN} characters`}
        hint={`At least ${PASSWORD_MIN} characters. Avoid anything close to your name or email.`}
        error={fieldError(state, "password")}
      />

      <SubmitButton>Create account</SubmitButton>
    </form>
  );
}
