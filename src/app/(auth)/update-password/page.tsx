import type { Metadata } from "next";
import { UpdatePasswordForm } from "@/components/auth/update-password-form";

export const metadata: Metadata = { title: "Choose a new password" };

export default function UpdatePasswordPage() {
  return (
    <div>
      <h1 className="text-ink text-[24px] font-semibold tracking-tight" style={{ fontFamily: "var(--font-display)" }}>Choose a new password</h1>
      <p className="text-ink-3 mt-2 text-sm">
        You&apos;ll stay signed in on this device once it&apos;s saved.
      </p>

      <UpdatePasswordForm />
    </div>
  );
}
