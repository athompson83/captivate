import type { Metadata } from "next";
import { UpdatePasswordForm } from "@/components/auth/update-password-form";

export const metadata: Metadata = { title: "Choose a new password" };

export default function UpdatePasswordPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Choose a new password</h1>
      <p className="mt-2 text-sm text-ink-3">
        You&apos;ll stay signed in on this device once it&apos;s saved.
      </p>

      <UpdatePasswordForm />
    </div>
  );
}
