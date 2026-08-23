"use client";

import { createContext, forwardRef, useContext, useId } from "react";
import { cn } from "@/lib/utils/cn";

const FIELD =
  "w-full bg-[var(--surface-inset)] border border-line rounded-[var(--radius-md)] px-3 py-2.5 " +
  "text-sm text-ink placeholder:text-ink-3 transition-colors duration-[var(--duration-fast)] " +
  "hover:border-line-strong focus:border-accent disabled:opacity-50";

/**
 * The id of a surrounding `Field`'s caption.
 *
 * `Field` draws its label as a paragraph — a caption a sighted person reads
 * and a screen reader never connects to anything, so the inspector announced
 * seven controls as unnamed text boxes, the alt-text field among them. Passing
 * the id down means a control is named because it sits in a `Field`, not
 * because somebody remembered an `aria-label` at the call site.
 */
export const FieldCaptionContext = createContext<string | undefined>(undefined);

/** The caption to fall back on, unless this control is named already. */
function captionFor(
  label: string | undefined,
  props: { "aria-label"?: string; "aria-labelledby"?: string },
  caption: string | undefined,
): string | undefined {
  if (props["aria-labelledby"]) return props["aria-labelledby"];
  if (label || props["aria-label"]) return undefined;
  return caption;
}

export interface FieldProps {
  label?: string;
  hint?: string;
  error?: string;
}

export const Input = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & FieldProps
>(function Input({ label, hint, error, className, id, ...props }, ref) {
  const auto = useId();
  const fieldId = id ?? auto;
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;
  const labelledBy = captionFor(label, props, useContext(FieldCaptionContext));

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={fieldId} className="text-ink-2 mb-1.5 block text-[13px] font-medium">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(FIELD, error && "border-danger", className)}
        {...props}
        aria-labelledby={labelledBy}
      />
      {error ? (
        // role="alert" so the message is announced, not just coloured red.
        <p id={`${fieldId}-error`} role="alert" className="text-danger mt-1.5 text-xs">
          {error}
        </p>
      ) : hint ? (
        <p id={`${fieldId}-hint`} className="text-ink-3 mt-1.5 text-xs">
          {hint}
        </p>
      ) : null}
    </div>
  );
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & FieldProps
>(function Textarea({ label, hint, error, className, id, ...props }, ref) {
  const auto = useId();
  const fieldId = id ?? auto;
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;
  const labelledBy = captionFor(label, props, useContext(FieldCaptionContext));

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={fieldId} className="text-ink-2 mb-1.5 block text-[13px] font-medium">
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(FIELD, "resize-y leading-relaxed", error && "border-danger", className)}
        {...props}
        aria-labelledby={labelledBy}
      />
      {error ? (
        <p id={`${fieldId}-error`} role="alert" className="text-danger mt-1.5 text-xs">
          {error}
        </p>
      ) : hint ? (
        <p id={`${fieldId}-hint`} className="text-ink-3 mt-1.5 text-xs">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
