import { Fragment, useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import * as D from "@radix-ui/react-dialog";
import { useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import { Check, X } from "lucide-react";
import { highlightSegments } from "../../lib/fuzzy";
import { IconButton } from "../../ui/Button";
import { overlayClass, panelClass, useFocusReturn } from "../../ui/Dialog";
import { cx } from "../../ui/cx";
import { KeyCombo } from "../settings/KeyCombo";
import type { Key } from "../settings/shortcutList";

/** One row of a picker. The parent decides what the rows are; the picker draws them and handles the keyboard. */
export interface PickerItem {
  /** Unique within the list. */
  id: string;
  label: string;
  /** Indexes (by code point) of the label to highlight. */
  positions: number[];
  /** Muted text after the label (the menu a command is in). */
  hint?: string;
  /** Rows with the same group sit under one heading; rows must already be sorted by group. */
  group?: string;
  /** Outline depth, 1 to 3: indents the row. */
  level?: number;
  /** Shown but not chosen (a command that cannot run right now). */
  enabled: boolean;
  /** A tick for toggles that are on. */
  checked?: boolean;
  /** Marks the open chapter. */
  current?: string;
  keys?: Key[][];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  placeholder: string;
  /** The rows for what has been typed. Must be stable between renders unless the data changes (use `useMemo`). */
  filter: (query: string) => PickerItem[];
  /** Said when nothing matches; receives the query. */
  empty: (query: string) => string;
  onChoose: (item: PickerItem) => void;
}

const sheet =
  "inset-x-0 top-0 flex max-h-[85dvh] flex-col overflow-hidden rounded-b-lg " +
  "md:top-[12vh] md:mx-auto md:max-h-[70dvh] md:w-[min(92vw,600px)] md:rounded-lg";

/**
 * A search box over a list, in a dialog: the ARIA "combobox with list autocomplete" pattern. Focus stays in the box; the arrow keys
 * move the highlighted row (announced through `aria-activedescendant`), Enter chooses it, Escape closes. On phones it is a sheet from
 * the top edge with 44px rows; from the md breakpoint it is a centered panel. Centering uses auto margins and `inset-x-0`, so it is
 * the same in left-to-right and right-to-left layouts.
 */
export function QuickPicker({ open, onOpenChange, title, ...rest }: Props) {
  const onCloseAutoFocus = useFocusReturn(open);
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className={overlayClass} />
        <D.Content
          aria-describedby={undefined}
          onCloseAutoFocus={onCloseAutoFocus}
          className={cx(panelClass, sheet)}
        >
          <D.Title className="sr-only">{title}</D.Title>
          <PickerBody title={title} {...rest} />
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** Only mounted while the dialog is open, so the query and the highlighted row start fresh every time. */
function PickerBody({
  title,
  placeholder,
  filter,
  empty,
  onChoose,
}: Omit<Props, "open" | "onOpenChange">) {
  const { t } = useLingui();
  const id = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const items = useMemo(() => filter(query), [filter, query]);
  const at = Math.min(active, items.length - 1);
  const optionId = (i: number) => `${id}-option-${i}`;

  useEffect(() => {
    document.getElementById(optionId(at))?.scrollIntoView({ block: "nearest" });
  }, [at, items]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // An input method (Arabic, Hebrew, Japanese...) uses Enter and the arrows to pick its own candidates.
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((at + step + items.length) % items.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[at];
      if (item?.enabled) onChoose(item);
    }
  };

  // Rows under the same heading share a role=group.
  const sections: { group: string | undefined; rows: { item: PickerItem; i: number }[] }[] = [];
  items.forEach((item, i) => {
    const last = sections.at(-1);
    if (last && last.group === item.group) last.rows.push({ item, i });
    else sections.push({ group: item.group, rows: [{ item, i }] });
  });

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border p-3">
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-autocomplete="list"
          aria-controls={`${id}-list`}
          aria-activedescendant={items.length > 0 ? optionId(at) : undefined}
          aria-label={title}
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-md border border-border-strong bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-accent max-md:min-h-11"
        />
        <D.Close asChild>
          <IconButton icon={X} label={t`Close`} className="md:hidden" />
        </D.Close>
      </div>
      <div
        role="status"
        className={items.length === 0 ? "px-4 py-6 text-sm text-ink-muted" : "sr-only"}
      >
        {items.length === 0
          ? empty(query.trim())
          : plural(items.length, { one: "# result", other: "# results" })}
      </div>
      <div
        role="listbox"
        id={`${id}-list`}
        aria-label={title}
        className={cx("min-h-0 flex-1 overflow-y-auto p-1.5", items.length === 0 && "hidden")}
      >
        {sections.map((s, n) => {
          const heading = `${id}-group-${n}`;
          const rows = s.rows.map(({ item, i }) => (
            <Option
              key={item.id}
              id={optionId(i)}
              item={item}
              active={i === at}
              onHover={() => setActive(i)}
              onChoose={() => item.enabled && onChoose(item)}
            />
          ));
          return s.group ? (
            <div key={heading} role="group" aria-labelledby={heading}>
              <div
                id={heading}
                className="px-2.5 pb-1 pt-2 text-micro font-bold uppercase tracking-[0.12em] text-ink-muted"
              >
                {s.group}
              </div>
              {rows}
            </div>
          ) : (
            <Fragment key={heading}>{rows}</Fragment>
          );
        })}
      </div>
    </>
  );
}

const INDENT = ["", "", "ps-4", "ps-8"] as const;

function Option({
  id,
  item,
  active,
  onHover,
  onChoose,
}: {
  id: string;
  item: PickerItem;
  active: boolean;
  onHover: () => void;
  onChoose: () => void;
}) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      aria-disabled={item.enabled ? undefined : true}
      {...(item.checked === undefined ? {} : { "aria-checked": item.checked })}
      {...(item.level === undefined ? {} : { "aria-level": item.level })}
      {...(item.current ? { "aria-current": "true" as const } : {})}
      // The input keeps focus; a press on a row must not take it away.
      onMouseDown={(e) => e.preventDefault()}
      onMouseMove={onHover}
      onClick={onChoose}
      className={cx(
        "flex cursor-default items-center gap-3 rounded-md px-2.5 py-2 text-sm text-ink max-md:min-h-11",
        item.level !== undefined && INDENT[item.level],
        active && "bg-accent-soft outline-2 -outline-offset-2 outline-accent",
        !item.enabled && "opacity-50",
      )}
    >
      <span className="min-w-0 flex-1 break-words">
        {highlightSegments(item.label, item.positions).map((s, i) =>
          s.hit ? (
            <mark key={i} className="bg-transparent font-bold text-accent underline">
              {s.text}
            </mark>
          ) : (
            <Fragment key={i}>{s.text}</Fragment>
          ),
        )}
        {item.hint ? (
          <>
            {" "}
            <span className="ms-2 text-xs text-ink-muted">{item.hint}</span>
          </>
        ) : null}
      </span>
      {item.checked ? <Check size={16} aria-hidden className="shrink-0 text-accent" /> : null}
      {item.current ? (
        <span className="shrink-0 text-xs font-semibold text-ink-muted">{item.current}</span>
      ) : null}
      {item.keys?.length ? (
        <span className="hidden shrink-0 items-center gap-2 md:inline-flex">
          {item.keys.map((keys, i) => (
            <KeyCombo key={i} keys={keys} />
          ))}
        </span>
      ) : null}
    </div>
  );
}
