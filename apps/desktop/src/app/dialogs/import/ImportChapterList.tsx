import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import { ArrowDown, ArrowDownToLine, ArrowUp, GripVertical, Merge, Split } from "lucide-react";
import { countWords } from "@cadabracraft/shared";
import type { ImportResult } from "@cadabracraft/import-docx";
import { IconButton } from "../../../ui/Button";
import { cx } from "../../../ui/cx";
import { useGripHint } from "../../../ui/GripHint";
import { dropPosition, insertionIndex } from "../../../lib/references/referenceKinds";
import { sceneCountOf } from "../../../lib/import/importBook";
import {
  canMergeDown,
  canMergeUp,
  canSplit,
  itemDoc,
  mergePlanItemDown,
  mergePlanItemUp,
  movePlanItem,
  planKey,
  planSplitPoints,
  splitPlanItem,
  splitPlanItemAt,
  type ImportPlan,
  type PlanItem,
} from "../../../lib/import/importPlan";
import { SplitAtHeadingMenu } from "./SplitAtHeadingMenu";

interface Props {
  result: ImportResult;
  plan: ImportPlan;
  onChange: (plan: ImportPlan) => void;
  /** The file is an outline: each chapter shows its number of scenes instead of its words. */
  outline?: boolean;
}

const keyOf = planKey;
const wordsOf = (item: PlanItem, result: ImportResult) => {
  const doc = itemDoc(result, item);
  return doc ? countWords(doc) : 0;
};
const scenesOf = (item: PlanItem, result: ImportResult) => {
  const doc = itemDoc(result, item);
  return doc ? sceneCountOf(doc) : 0;
};

/** One chapter of the preview: include box, title, grip, move / merge / split buttons and the size. */
function ChapterRow({
  item,
  index: i,
  plan,
  result,
  outline,
  drag,
  describedBy,
  onPatch,
  onMove,
  onChange,
  onGrab,
  onGripKey,
}: {
  item: PlanItem;
  index: number;
  plan: ImportPlan;
  result: ImportResult;
  outline: boolean;
  drag: { key: string; at: number } | null;
  describedBy: string | undefined;
  onPatch: (p: Partial<PlanItem>) => void;
  onMove: (delta: number, act: string) => void;
  onChange: (plan: ImportPlan) => void;
  onGrab: (e: PointerEvent<HTMLElement>) => void;
  onGripKey: (e: KeyboardEvent) => void;
}) {
  const { t } = useLingui();
  const key = keyOf(item);
  const n = i + 1;
  const merged = item.ranges.length;
  return (
    <li
      data-key={key}
      className={cx("relative flex flex-col gap-1 rounded-md", drag?.key === key && "opacity-40")}
    >
      {drag && drag.at === i && <DropLine />}
      {drag && drag.at === plan.length && i === plan.length - 1 && <DropLine below />}
      <div className="flex items-center gap-2.5">
        <label className="flex size-11 shrink-0 items-center justify-center md:size-6">
          <input
            type="checkbox"
            aria-label={t`Include chapter ${i + 1}`}
            checked={item.include}
            onChange={(e) => onPatch({ include: e.target.checked })}
            className="size-4 accent-accent"
          />
        </label>
        <input
          aria-label={t`Title of chapter ${i + 1}`}
          value={item.title}
          disabled={!item.include}
          onChange={(e) => onPatch({ title: e.target.value })}
          className="min-w-0 flex-1 rounded-md border border-border-strong bg-bg px-2.5 py-1.5 text-sm max-md:min-h-11 disabled:text-ink-muted"
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-1 md:ps-8.5">
        <button
          type="button"
          data-act="grip"
          aria-label={t`Reorder chapter ${n}`}
          aria-keyshortcuts="ArrowUp ArrowDown"
          aria-describedby={describedBy}
          onPointerDown={onGrab}
          onKeyDown={onGripKey}
          className="flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-ink-muted hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent md:size-9"
        >
          <GripVertical size={16} aria-hidden />
        </button>
        <IconButton
          icon={ArrowUp}
          data-act="up"
          label={t`Move chapter ${n} up`}
          disabled={i === 0}
          onClick={() => onMove(-1, "up")}
        />
        <IconButton
          icon={ArrowDown}
          data-act="down"
          label={t`Move chapter ${n} down`}
          disabled={i === plan.length - 1}
          onClick={() => onMove(1, "down")}
        />
        <IconButton
          icon={Merge}
          label={t`Merge chapter ${n} into the previous one`}
          disabled={!canMergeUp(plan, i)}
          onClick={() => onChange(mergePlanItemUp(plan, i))}
        />
        <IconButton
          icon={ArrowDownToLine}
          label={t`Merge chapter ${n} into the next one`}
          disabled={!canMergeDown(plan, i)}
          onClick={() => onChange(mergePlanItemDown(plan, i))}
        />
        <SplitAtHeadingMenu
          n={n}
          points={outline ? [] : planSplitPoints(plan, i, result)}
          onSplit={(point) => onChange(splitPlanItemAt(plan, i, result, point))}
        />
        {canSplit(plan, i) && (
          <IconButton
            icon={Split}
            label={t`Split chapter ${n} back into ${merged} chapters`}
            onClick={() => onChange(splitPlanItem(plan, i, result))}
          />
        )}
        <span className="ms-auto shrink-0 text-xs text-ink-muted">
          {outline
            ? plural(scenesOf(item, result), { one: "# scene", other: "# scenes" })
            : plural(wordsOf(item, result), { one: "# word", other: "# words" })}
        </span>
      </div>
    </li>
  );
}

/**
 * The chapters of the import preview: include, rename, reorder (drag the grip, or focus it and press the arrow keys,
 * or use Move up and Move down), merge into the previous chapter and split a merged chapter again. Pure view over the
 * plan: every change goes through `onChange` with a new plan from `lib/importPlan`.
 */
export function ImportChapterList({ result, plan, onChange, outline = false }: Props) {
  const { t } = useLingui();
  const grip = useGripHint();
  const list = useRef<HTMLUListElement>(null);
  /** The row being dragged and the insertion point (0 = before the first row) under the pointer. */
  const [drag, setDrag] = useState<{ key: string; at: number } | null>(null);
  const at = useRef(0);
  /** After a keyboard move, the control that had focus gets it back at the row's new place. */
  const refocus = useRef<{ key: string; act: string } | null>(null);
  const planRef = useRef(plan);
  planRef.current = plan;
  const dragKey = drag?.key;
  useEffect(() => {
    if (!dragKey) return;
    const move = (e: globalThis.PointerEvent) => {
      const rows = [...list.current!.children].map((li) => li.getBoundingClientRect());
      at.current = insertionIndex(
        rows.map((r) => r.top + r.height / 2),
        e.clientY,
      );
      setDrag({ key: dragKey, at: at.current });
    };
    const drop = () => {
      const from = planRef.current.findIndex((p) => keyOf(p) === dragKey);
      setDrag(null);
      onChange(movePlanItem(planRef.current, from, dropPosition(from, at.current)));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", drop);
    window.addEventListener("pointercancel", drop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", drop);
      window.removeEventListener("pointercancel", drop);
    };
  }, [dragKey, onChange]);
  useEffect(() => {
    const f = refocus.current;
    if (!f) return;
    refocus.current = null;
    const row = [...list.current!.children].find((li) => li.getAttribute("data-key") === f.key);
    const target =
      row?.querySelector<HTMLElement>(`[data-act="${f.act}"]:not(:disabled)`) ??
      row?.querySelector<HTMLElement>(`[data-act="grip"]`);
    target?.focus();
  }, [plan]);

  const patch = (i: number, p: Partial<PlanItem>) =>
    onChange(plan.map((item, j) => (j === i ? { ...item, ...p } : item)));
  const move = (i: number, delta: number, act: string) => {
    refocus.current = { key: keyOf(plan[i]!), act };
    onChange(movePlanItem(plan, i, i + delta));
  };
  const gripKeys = (i: number) => (e: KeyboardEvent) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    move(i, e.key === "ArrowUp" ? -1 : 1, "grip");
  };
  const grab = (key: string, index: number) => (e: PointerEvent<HTMLElement>) => {
    e.preventDefault();
    at.current = index;
    setDrag({ key, at: index });
  };

  return (
    <>
      {grip.hint}
      <ul
        ref={list}
        aria-label={t`Chapters`}
        className="flex max-h-72 flex-col gap-2 overflow-y-auto rounded-md border border-border bg-surface p-3"
      >
        {plan.map((item, i) => (
          <ChapterRow
            key={keyOf(item)}
            item={item}
            index={i}
            plan={plan}
            result={result}
            outline={outline}
            drag={drag}
            describedBy={grip.describedBy}
            onPatch={(p) => patch(i, p)}
            onMove={(delta, act) => move(i, delta, act)}
            onChange={onChange}
            onGrab={grab(keyOf(item), i)}
            onGripKey={gripKeys(i)}
          />
        ))}
      </ul>
    </>
  );
}

/** The line that shows where a dragged chapter will land, drawn in the gap so the list does not move. */
function DropLine({ below }: { below?: boolean }) {
  return (
    <span
      aria-hidden
      data-drop-line
      className={cx(
        "pointer-events-none absolute inset-x-0 h-0.75 rounded-full bg-accent",
        below ? "bottom-[-5.5px]" : "top-[-5.5px]",
      )}
    />
  );
}
