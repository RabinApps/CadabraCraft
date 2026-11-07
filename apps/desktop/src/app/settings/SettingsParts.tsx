import { useState, type ReactNode } from "react";
import { Field } from "../../ui/forms/Input";
import {
  SNAPSHOT_KEEP_MAX,
  SNAPSHOT_KEEP_MIN,
  cleanSnapshotKeep,
} from "../../state/view/editorPrefs";

export function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="flex scroll-mt-4 flex-col gap-3">
      <h2 id={`${id}-heading`} className="font-book text-title font-semibold">
        {title}
      </h2>
      <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
        {children}
      </div>
    </section>
  );
}

export function Row({ title, hint, control }: { title: string; hint: string; control: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-xs text-ink-muted">{hint}</span>
      </div>
      <div className="shrink-0 max-sm:w-full">{control}</div>
    </div>
  );
}

/** A whole-number field with a range (snapshots to keep, size limit): edits stay local while typing and are applied on blur, so "2" on the way to "20" is not clamped to the minimum. */
export function KeepField({
  label,
  value,
  onCommit,
  min = SNAPSHOT_KEEP_MIN,
  max = SNAPSHOT_KEEP_MAX,
  step = 5,
  clean = cleanSnapshotKeep,
}: {
  label: string;
  value: number;
  onCommit: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Turns what was typed into an allowed value. */
  clean?: (v: unknown) => number;
}) {
  const [text, setText] = useState(String(value));
  return (
    <Field
      label={label}
      hideLabel
      className="py-2"
      type="number"
      min={min}
      max={max}
      step={step}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const n = clean(Number(text));
        onCommit(n);
        setText(String(n));
      }}
    />
  );
}
