"use client";

import { useId, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronDown,
  GripVertical,
  Link2,
  Lock,
  MoreHorizontal,
  Paperclip,
  Sparkles,
  Trash2,
  Unlock,
} from "lucide-react";
import {
  ROLE_META,
  VISUAL_INTENT_META,
  type EvidenceRef,
  type Moment,
  type NarrativeRole,
  type VisualIntent,
} from "@/lib/schema/narrative";
import { formatDuration } from "@/lib/analysis/pacing";
import { Popover } from "@/components/ui/misc";
import { cn } from "@/lib/utils/cn";

/**
 * One beat of the argument.
 *
 * Everything a decision needs is on the face of the card: the role it plays,
 * why it exists, what the audience should carry away, how long it takes and
 * whether anything grounds it. "Why this moment exists" is the single most
 * important field on the map and it is never behind a modal.
 *
 * Everything a decision does *not* need — the visual intent, per-moment
 * instructions for the generator — is one disclosure away. That is the split:
 * what the argument is, always visible; how it should be rendered, on request.
 */
export interface MomentCardProps {
  moment: Moment;
  index: number;
  /** Position among all moments, used for the running order. */
  ordinal: number;
  movementCount: number;
  evidenceOptions: EvidenceRef[];
  onChange: (patch: Partial<Moment>, options?: { coalesceKey?: string }) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onRegenerate: () => void;
  onMove: (direction: -1 | 1) => void;
  onMoveToMovement: (movementId: string | null) => void;
  movements: { id: string | null; label: string }[];
  regenerating: boolean;
}

export function MomentCard({
  moment,
  ordinal,
  evidenceOptions,
  onChange,
  onDelete,
  onDuplicate,
  onRegenerate,
  onMove,
  onMoveToMovement,
  movements,
  regenerating,
}: MomentCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: moment.id,
  });
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const detailId = useId();

  const role = ROLE_META[moment.role];
  const grounded = moment.evidence.length > 0;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "border-line bg-base group/moment relative rounded-[var(--radius-lg)] border transition-shadow",
        isDragging && "z-10 shadow-lg",
        moment.locked && "border-l-accent border-l-2",
      )}
    >
      <div className="flex items-start gap-2.5 p-3">
        <button
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${moment.title || "moment"}`}
          className="text-ink-3 hover:text-ink mt-0.5 cursor-grab touch-none rounded p-0.5 opacity-0 transition-opacity group-hover/moment:opacity-100 focus-visible:opacity-100"
        >
          <GripVertical className="size-3.5" aria-hidden />
        </button>

        <span className="text-ink-3 mt-1 w-5 shrink-0 text-[10.5px] tabular-nums">
          {String(ordinal).padStart(2, "0")}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <RoleChip role={moment.role} onChange={(next) => onChange({ role: next })} />
            {moment.locked && (
              <span className="text-accent flex items-center gap-1 text-[10px] font-medium tracking-wide uppercase">
                <Lock className="size-2.5" aria-hidden />
                Locked
              </span>
            )}
          </div>

          <input
            value={moment.title}
            onChange={(e) =>
              onChange({ title: e.target.value }, { coalesceKey: `title-${moment.id}` })
            }
            aria-label="Moment title"
            placeholder="Untitled moment"
            className="text-ink hover:border-line-subtle focus:border-line mt-1.5 w-full rounded-[var(--radius-sm)] border border-transparent bg-transparent px-1 py-0.5 text-[14px] font-semibold tracking-tight outline-none focus:bg-[var(--surface-inset)]"
          />

          <Field
            label="Why this moment exists"
            value={moment.purpose}
            placeholder="What this beat is for, in this argument."
            onChange={(value) =>
              onChange({ purpose: value }, { coalesceKey: `purpose-${moment.id}` })
            }
          />

          <Field
            label="What the audience takes away"
            value={moment.takeaway}
            placeholder="In their words, afterwards."
            onChange={(value) =>
              onChange({ takeaway: value }, { coalesceKey: `takeaway-${moment.id}` })
            }
            tone="muted"
          />

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <DurationField
              seconds={moment.estimatedSeconds}
              onChange={(seconds) =>
                onChange({ estimatedSeconds: seconds }, { coalesceKey: `duration-${moment.id}` })
              }
            />

            <EvidenceControl
              evidence={moment.evidence}
              options={evidenceOptions}
              onChange={(evidence) => onChange({ evidence })}
            />

            <button
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls={detailId}
              className="text-ink-3 hover:text-ink flex items-center gap-1 text-[11px] transition-colors"
            >
              {VISUAL_INTENT_META[moment.visualIntent].label}
              <ChevronDown
                className={cn("size-3 transition-transform", open && "rotate-180")}
                aria-hidden
              />
            </button>
          </div>

          {open && (
            <div id={detailId} className="border-line-subtle mt-2.5 space-y-2.5 border-t pt-2.5">
              <label className="block">
                <span className="text-ink-3 mb-1 block text-[10px] font-medium tracking-wider uppercase">
                  How it should look
                </span>
                <select
                  value={moment.visualIntent}
                  onChange={(e) => onChange({ visualIntent: e.target.value as VisualIntent })}
                  className="border-line text-ink-2 focus:border-accent w-full rounded-[var(--radius-md)] border bg-[var(--surface-inset)] px-2 py-1.5 text-[12px] outline-none"
                >
                  {Object.entries(VISUAL_INTENT_META).map(([value, meta]) => (
                    <option key={value} value={value}>
                      {meta.label} — {meta.plain}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-ink-3 mb-1 block text-[10px] font-medium tracking-wider uppercase">
                  Instructions for this moment
                </span>
                <textarea
                  value={moment.instructions}
                  onChange={(e) =>
                    onChange(
                      { instructions: e.target.value },
                      { coalesceKey: `instructions-${moment.id}` },
                    )
                  }
                  rows={2}
                  placeholder="Anything the generator should honour here specifically."
                  className="border-line text-ink placeholder:text-ink-3 focus:border-accent w-full resize-y rounded-[var(--radius-md)] border bg-[var(--surface-inset)] px-2 py-1.5 text-[12px] outline-none"
                />
              </label>

              <p className="text-ink-3 text-[11px] leading-snug">
                {role.plain} {grounded ? "" : "Nothing is attached to ground this yet."}
              </p>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            onClick={() => onChange({ locked: !moment.locked })}
            aria-label={moment.locked ? "Unlock this moment" : "Lock this moment"}
            aria-pressed={moment.locked}
            className={cn(
              "rounded p-1 transition-colors",
              moment.locked
                ? "text-accent"
                : "text-ink-3 hover:text-ink opacity-0 group-hover/moment:opacity-100 focus-visible:opacity-100",
            )}
          >
            {moment.locked ? (
              <Lock className="size-3.5" aria-hidden />
            ) : (
              <Unlock className="size-3.5" aria-hidden />
            )}
          </button>

          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={`Actions for the moment ${moment.title || "with no title yet"}`}
              className="text-ink-3 hover:text-ink rounded p-1 opacity-0 transition-opacity group-hover/moment:opacity-100 focus-visible:opacity-100"
            >
              <MoreHorizontal className="size-3.5" aria-hidden />
            </button>
            <Popover open={menuOpen} onClose={() => setMenuOpen(false)} anchor="bottom-end">
              <div className="w-56 p-1">
                <MenuItem onClick={() => onMove(-1)}>Move up</MenuItem>
                <MenuItem onClick={() => onMove(1)}>Move down</MenuItem>
                <MenuItem onClick={onDuplicate}>Duplicate</MenuItem>
                <MenuItem onClick={onRegenerate} disabled={moment.locked || regenerating}>
                  <Sparkles className="size-3" aria-hidden />
                  {regenerating ? "Rewriting…" : "Rewrite this moment"}
                </MenuItem>

                <div className="border-line-subtle mt-1 border-t pt-1">
                  <p className="text-ink-3 px-2 py-1 text-[10px] font-medium tracking-wider uppercase">
                    Move to movement
                  </p>
                  {movements.map((movement) => (
                    <MenuItem
                      key={movement.id ?? "unplaced"}
                      onClick={() => onMoveToMovement(movement.id)}
                      disabled={movement.id === moment.movementId}
                    >
                      {movement.label}
                    </MenuItem>
                  ))}
                </div>

                <div className="border-line-subtle mt-1 border-t pt-1">
                  <MenuItem onClick={onDelete} tone="danger">
                    <Trash2 className="size-3" aria-hidden />
                    Delete moment
                  </MenuItem>
                </div>
              </div>
            </Popover>
          </div>
        </div>
      </div>
    </li>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A field that reads as prose and edits in place.
 *
 * The purpose and takeaway are the substance of the map, so they are laid out
 * as text rather than as form controls with boxes around them — a page of
 * labelled inputs would read as data entry, and this is meant to read as an
 * argument.
 */
function Field({
  label,
  value,
  placeholder,
  onChange,
  tone = "default",
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  tone?: "default" | "muted";
}) {
  return (
    <label className="mt-1.5 block">
      <span className="sr-only">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={1}
        placeholder={placeholder}
        aria-label={label}
        className={cn(
          "hover:border-line-subtle focus:border-line field-sizing-content w-full resize-none rounded-[var(--radius-sm)] border border-transparent bg-transparent px-1 py-0.5 text-[12.5px] leading-snug outline-none focus:bg-[var(--surface-inset)]",
          tone === "muted" ? "text-ink-3 italic" : "text-ink-2",
        )}
      />
    </label>
  );
}

function RoleChip({
  role,
  onChange,
}: {
  role: NarrativeRole;
  onChange: (role: NarrativeRole) => void;
}) {
  return (
    <label className="relative">
      <span className="sr-only">Narrative role</span>
      <select
        value={role}
        onChange={(e) => onChange(e.target.value as NarrativeRole)}
        className="border-accent/40 text-accent focus:border-accent cursor-pointer appearance-none rounded-full border bg-[var(--accent-soft)] py-0.5 pr-5 pl-2 text-[10px] font-medium tracking-wider uppercase outline-none"
      >
        {Object.entries(ROLE_META).map(([value, meta]) => (
          <option key={value} value={value}>
            {meta.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="text-accent pointer-events-none absolute top-1/2 right-1.5 size-2.5 -translate-y-1/2"
        aria-hidden
      />
    </label>
  );
}

/** Minutes and seconds, entered the way a presenter thinks about them. */
function DurationField({
  seconds,
  onChange,
}: {
  seconds: number;
  onChange: (seconds: number) => void;
}) {
  return (
    <label className="text-ink-3 flex items-center gap-1 text-[11px]">
      <span className="sr-only">Estimated duration in seconds</span>
      <input
        type="number"
        min={0}
        max={3600}
        step={15}
        value={seconds}
        onChange={(e) => onChange(Math.max(0, Math.min(3600, Number(e.target.value) || 0)))}
        className="border-line text-ink-2 focus:border-accent w-14 rounded-[var(--radius-sm)] border bg-[var(--surface-inset)] px-1.5 py-0.5 text-[11px] tabular-nums outline-none"
      />
      {/* The unit, then the same value in the words a presenter thinks in.
          Without "sec" the raw number reads as anything — a percentage, a
          word count — and 100 beside "1 min 40 sec" looks like a mismatch. */}
      <span>sec</span>
      {seconds >= 60 && <span className="ml-1">· {formatDuration(seconds)}</span>}
    </label>
  );
}

/**
 * Whether anything grounds this claim.
 *
 * Attaches by reference to material the workspace already holds. There is no
 * free-text citation field on purpose: a citation somebody typed is a citation
 * nothing checks, and the whole value of the grounded state is that it is true.
 */
function EvidenceControl({
  evidence,
  options,
  onChange,
}: {
  evidence: EvidenceRef[];
  options: EvidenceRef[];
  onChange: (evidence: EvidenceRef[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const grounded = evidence.length > 0;

  const toggle = (option: EvidenceRef) => {
    const has = evidence.some((item) => item.id === option.id);
    onChange(has ? evidence.filter((item) => item.id !== option.id) : [...evidence, option]);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "flex items-center gap-1 text-[11px] transition-colors",
          grounded ? "text-[var(--success)]" : "text-ink-3 hover:text-ink",
        )}
      >
        {grounded ? (
          <Paperclip className="size-3" aria-hidden />
        ) : (
          <Link2 className="size-3" aria-hidden />
        )}
        {grounded ? `${evidence.length} attached` : "Not grounded"}
      </button>

      <Popover open={open} onClose={() => setOpen(false)} anchor="bottom-start">
        <div className="max-h-64 w-64 overflow-y-auto p-1">
          {options.length === 0 ? (
            <p className="text-ink-3 px-2 py-3 text-[11.5px] leading-snug">
              Nothing to attach yet. Upload an asset or write a lecture note, and it becomes
              available here.
            </p>
          ) : (
            options.map((option) => {
              const checked = evidence.some((item) => item.id === option.id);
              return (
                <button
                  key={option.id}
                  onClick={() => toggle(option)}
                  className="flex w-full items-start gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left hover:bg-[var(--surface-inset)]"
                >
                  <span
                    className={cn(
                      "border-line mt-0.5 size-3 shrink-0 rounded-[3px] border",
                      checked && "border-accent bg-accent",
                    )}
                    aria-hidden
                  />
                  <span className="min-w-0">
                    <span className="text-ink block truncate text-[12px]">{option.label}</span>
                    <span className="text-ink-3 text-[10.5px] tracking-wide uppercase">
                      {option.kind}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </Popover>
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  disabled,
  tone = "default",
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "danger";
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-[12px] transition-colors disabled:opacity-40",
        tone === "danger"
          ? "text-danger hover:bg-[var(--danger-soft)]"
          : "text-ink-2 hover:text-ink hover:bg-[var(--surface-inset)]",
      )}
    >
      {children}
    </button>
  );
}
