import * as M from "@radix-ui/react-dropdown-menu";
import { useLingui } from "@lingui/react/macro";
import { Check, ChevronDown } from "lucide-react";
import { cx } from "../../ui/cx";
import { menuContentClass, menuItemClass } from "../../ui/Menu";
import type { FacetValue } from "../../lib/scenes/sceneFilter";

interface Props {
  /** The facet's name on the button ("POV"). */
  title: string;
  values: FacetValue[];
  /** The keys switched on. */
  selected: readonly string[];
  /** How a value is printed (a status by its word, "none" as "No label"). */
  print: (v: FacetValue) => string;
  onToggle: (key: string) => void;
  /** The footer item, "Clear POV". */
  clearLabel: string;
  onClear: () => void;
}

/**
 * One facet of the filter bar: a menu button that opens a list of checkbox items with the number of scenes each value has. The
 * menu stays open while values are ticked; the count of ticked values is part of the button's name.
 */
export function FacetMenu({
  title,
  values,
  selected,
  print,
  onToggle,
  clearLabel,
  onClear,
}: Props) {
  const { t } = useLingui();
  return (
    <M.Root>
      <M.Trigger
        disabled={values.length === 0}
        data-facet={title}
        className={cx(
          "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50 max-md:min-h-11",
          selected.length > 0
            ? "border-accent bg-accent-soft text-accent"
            : "border-border-strong bg-surface text-ink hover:bg-accent-soft",
        )}
      >
        {title}
        {selected.length > 0 && (
          <span className="rounded-full bg-accent px-1.5 text-micro text-accent-ink">
            {selected.length}
            <span className="sr-only"> {t`selected`}</span>
          </span>
        )}
        <ChevronDown size={14} aria-hidden />
      </M.Trigger>
      <M.Portal>
        <M.Content align="start" className={menuContentClass("min-w-60")}>
          {values.map((v) => (
            <M.CheckboxItem
              key={v.key || "none"}
              checked={selected.includes(v.key)}
              // Several values are ticked in one go: choosing one does not close the menu.
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={() => onToggle(v.key)}
              className={menuItemClass("justify-between gap-3")}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span aria-hidden className="flex size-4 shrink-0 items-center justify-center">
                  <M.ItemIndicator>
                    <Check size={14} />
                  </M.ItemIndicator>
                </span>
                <span className="min-w-0 break-words">{print(v)}</span>
              </span>
              <span className="text-micro text-ink-muted">{v.count}</span>
            </M.CheckboxItem>
          ))}
          <M.Separator className="my-1 h-px bg-border" />
          <M.Item className={menuItemClass()} disabled={selected.length === 0} onSelect={onClear}>
            {clearLabel}
          </M.Item>
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}
