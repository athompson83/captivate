"use client";

import { createContext, forwardRef, useContext, useId, useState } from "react";
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

/* -------------------------------------------------------------------------- */

/**
 * A text field that offers suggestions without ever taking the field over.
 *
 * This replaces `<input list>` and `<datalist>`, which is the right element on
 * paper and unusable in practice on an iPad: WebKit rebuilds the suggestion
 * popup on every `input` event, and rebuilding it dismisses the on-screen
 * keyboard. The reported symptom was losing the keyboard after every single
 * letter — the field could not be typed into at all on a touch device, which
 * is most of the devices somebody plans a talk on.
 *
 * Three things here exist specifically to keep a soft keyboard up, and each of
 * them is easy to undo by accident:
 *
 *  - the `<input>` is rendered unconditionally and never wrapped in anything
 *    conditional, so React cannot remount it. A remount is a blur, and a blur
 *    on iOS is the keyboard going away;
 *  - choosing a suggestion happens on `pointerdown` with the default
 *    prevented, because the default is moving focus out of the field. Waiting
 *    for `click` means blurring first and the keyboard closing on the way;
 *  - the list closes on `focusout` only when focus actually left the widget,
 *    checked against the element receiving it rather than assuming any
 *    `focusout` is a departure.
 *
 * Suggestions are an offer, never an autofill: nothing is written into the
 * field unless the author picks it, and the list gets out of the way as soon
 * as what they typed is not a prefix of anything.
 */
export function Suggest({
  label,
  options,
  value,
  onValueChange,
  id,
  className,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "list"> & {
  label?: string;
  options: readonly string[];
  value: string;
  onValueChange: (value: string) => void;
}) {
  const auto = useId();
  const fieldId = id ?? auto;
  const listId = `${fieldId}-suggestions`;

  const [open, setOpen] = useState(false);
  // Which option the keyboard is on. -1 is "none", which is the state the list
  // opens in: typing must never be hijacked by a highlighted row, so Enter
  // does nothing until the author has deliberately arrowed onto something.
  const [active, setActive] = useState(-1);

  const query = value.trim().toLowerCase();
  const matches = options.filter((option) => {
    const candidate = option.toLowerCase();
    // An exact match is not a suggestion, it is what the field already says.
    if (candidate === query) return false;
    return query === "" || candidate.includes(query);
  });
  const visible = open && matches.length > 0;
  // The highlight is clamped rather than reset, so a list that shrinks under
  // the arrow keys cannot leave `aria-activedescendant` naming a row that is
  // no longer rendered.
  const activeIndex = active >= matches.length ? -1 : active;

  const choose = (option: string) => {
    onValueChange(option);
    setOpen(false);
    setActive(-1);
  };

  return (
    <div
      className="relative w-full"
      // React's `onBlur` is `focusout`, so it fires here for the field inside.
      // Closing on any of them would close the list while the author is still
      // in the widget — and on a touch device, choosing a suggestion moves
      // focus for an instant. `relatedTarget` says where focus actually went;
      // null means it left the document entirely, which is a departure too.
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          setOpen(false);
          setActive(-1);
        }
      }}
    >
      {label && (
        <label htmlFor={fieldId} className="text-ink-2 mb-1.5 block text-[13px] font-medium">
          {label}
        </label>
      )}
      <input
        id={fieldId}
        role="combobox"
        aria-expanded={visible}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={visible && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        // Off, because the browser's own history dropdown is the same
        // interruption this component exists to remove.
        autoComplete="off"
        value={value}
        onChange={(e) => {
          onValueChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((i) => (matches.length === 0 ? -1 : (i + 1) % matches.length));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            // Reopens, exactly as ArrowDown does. After Escape the list is
            // closed, and a widget where one arrow key brings it back and the
            // other silently moves an invisible highlight is a widget a
            // keyboard user cannot form a model of.
            setOpen(true);
            setActive((i) => (matches.length === 0 ? -1 : (i <= 0 ? matches.length : i) - 1));
          } else if (e.key === "Enter" && visible && activeIndex >= 0) {
            // Only when a row is genuinely highlighted. Swallowing Enter
            // otherwise would stop the author submitting the brief.
            e.preventDefault();
            choose(matches[activeIndex]);
          } else if (e.key === "Escape" && visible) {
            e.preventDefault();
            setOpen(false);
            setActive(-1);
          }
        }}
        className={cn(FIELD, className)}
        {...props}
      />

      {visible && (
        <ul
          id={listId}
          role="listbox"
          // Not focusable and never focused: the field keeps focus throughout,
          // which is the whole point.
          className="border-line bg-raised absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-[var(--radius-md)] border py-1 shadow-[var(--shadow-md)]"
        >
          {matches.map((option, index) => (
            <li
              key={option}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              // `pointerdown`, not `click`: click fires after the field has
              // already blurred, and on iOS the keyboard is gone by then.
              onPointerDown={(e) => {
                e.preventDefault();
                choose(option);
              }}
              onMouseEnter={() => setActive(index)}
              className={cn(
                "cursor-pointer px-3 py-2 text-sm",
                index === activeIndex ? "bg-accent-soft text-ink" : "text-ink-2",
              )}
            >
              {option}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
