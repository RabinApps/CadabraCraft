import { Fragment } from "react";
import { useLingui } from "@lingui/react/macro";
import * as M from "@radix-ui/react-dropdown-menu";
import { ArrowUpDown, Check, ChevronDown } from "lucide-react";
import type { SortKey } from "../../../lib/references/referenceKinds";
import { menuContentClass, menuItemClass } from "../../../ui/Menu";

const SORT_KEYS: SortKey[] = ["manual", "title-asc", "title-desc", "newest", "oldest", "kind"];

export function SortMenu({ sort, onChange }: { sort: SortKey; onChange: (sort: SortKey) => void }) {
  const { t } = useLingui();
  const labels: Record<SortKey, string> = {
    manual: t`Manual order`,
    "title-asc": t`Title A-Z`,
    "title-desc": t`Title Z-A`,
    newest: t`Newest first`,
    oldest: t`Oldest first`,
    kind: t`Kind`,
  };
  const sorts = SORT_KEYS.map((k): [SortKey, string] => [k, labels[k]]);
  return (
    <M.Root>
      <M.Trigger asChild>
        <button
          type="button"
          className="flex h-8 items-center gap-1.5 rounded-md border border-border-strong px-2.5 text-xs font-semibold text-ink data-[state=open]:border-accent data-[state=open]:bg-accent-soft data-[state=open]:text-accent focus-visible:outline-2 focus-visible:outline-accent"
        >
          <ArrowUpDown size={14} aria-hidden />
          <span className="sr-only">{t`Sort references`} </span>
          {sorts.find(([k]) => k === sort)![1]}
          <ChevronDown size={14} aria-hidden />
        </button>
      </M.Trigger>
      <M.Portal>
        <M.Content align="start" className={menuContentClass("min-w-52")}>
          <M.RadioGroup value={sort} onValueChange={(v) => onChange(v as SortKey)}>
            {sorts.map(([key, text]) => (
              <Fragment key={key}>
                {key === "title-asc" && <M.Separator className="my-1 h-px bg-border" />}
                <M.RadioItem value={key} className={menuItemClass()}>
                  <span className="flex size-3.5 items-center justify-center text-accent">
                    <M.ItemIndicator>
                      <Check size={14} aria-hidden />
                    </M.ItemIndicator>
                  </span>
                  <span className={key === sort ? "font-semibold" : ""}>{text}</span>
                </M.RadioItem>
              </Fragment>
            ))}
          </M.RadioGroup>
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}
