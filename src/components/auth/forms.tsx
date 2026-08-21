"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import type { ActionResult } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";

export function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="lg" loading={pending} className="w-full">
      {children}
    </Button>
  );
}

export function FormMessage({ state }: { state: ActionResult | null }) {
  if (!state) return null;

  if (state.ok && state.message) {
    return (
      <div
        role="status"
        className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-transparent bg-[var(--success-soft)] px-3 py-2.5"
      >
        <CheckCircle2 className="text-success mt-px size-4 shrink-0" aria-hidden />
        <p className="text-success text-[13px] leading-relaxed">{state.message}</p>
      </div>
    );
  }

  if (!state.ok) {
    return (
      <div
        role="alert"
        className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-transparent bg-[var(--danger-soft)] px-3 py-2.5"
      >
        <AlertCircle className="text-danger mt-px size-4 shrink-0" aria-hidden />
        <p className="text-danger text-[13px] leading-relaxed">{state.error}</p>
      </div>
    );
  }

  return null;
}

export function useAuthAction(
  action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>,
) {
  return useActionState<ActionResult | null, FormData>(action, null);
}

/** Field error, matched by name so the message lands on the right input. */
export function fieldError(state: ActionResult | null, name: string) {
  return state && !state.ok && state.field === name ? state.error : undefined;
}
