"use client";

import { requestPasswordReset } from "@/lib/auth/actions";
import { Input } from "@/components/ui/input";
import { FormMessage, SubmitButton, fieldError, useAuthAction } from "./forms";

export function ResetPasswordForm() {
  const [state, formAction] = useAuthAction(requestPasswordReset);

  return (
    <form action={formAction} className="mt-8 space-y-4">
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
      <SubmitButton>Send reset link</SubmitButton>
    </form>
  );
}
