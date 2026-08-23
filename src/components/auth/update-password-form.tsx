"use client";

import { updatePassword } from "@/lib/auth/actions";
import { Input } from "@/components/ui/input";
import { FormMessage, SubmitButton, fieldError, useAuthAction } from "./forms";

export function UpdatePasswordForm() {
  const [state, formAction] = useAuthAction(updatePassword);

  return (
    <form action={formAction} className="mt-8 space-y-4">
      <FormMessage state={state} />
      <Input
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        autoFocus
        error={fieldError(state, "password")}
      />
      <Input
        label="Confirm new password"
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
        error={fieldError(state, "confirm")}
      />
      <SubmitButton>Save password</SubmitButton>
    </form>
  );
}
