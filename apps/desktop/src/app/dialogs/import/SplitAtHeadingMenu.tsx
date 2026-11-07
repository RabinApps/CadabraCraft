import * as M from "@radix-ui/react-dropdown-menu";
import { useLingui } from "@lingui/react/macro";
import { Scissors } from "lucide-react";
import { IconButton } from "../../../ui/Button";
import { menuContentClass, menuItemClass } from "../../../ui/Menu";
import type { ItemSplitPoint } from "../../../lib/import/importPlan";

/**
 * The "Split at a heading" button of a preview row: a menu of the headings inside the chapter. Choosing one cuts the
 * chapter there. Disabled when the chapter has no heading to cut at.
 */
export function SplitAtHeadingMenu({
  n,
  points,
  onSplit,
}: {
  /** The row number shown to the author (1-based). */
  n: number;
  points: ItemSplitPoint[];
  onSplit: (point: ItemSplitPoint) => void;
}) {
  const { t } = useLingui();
  return (
    <M.Root>
      <M.Trigger asChild>
        <IconButton
          icon={Scissors}
          data-act="split-at"
          label={t`Split chapter ${n} at a heading`}
          disabled={points.length === 0}
        />
      </M.Trigger>
      <M.Portal>
        <M.Content
          align="end"
          aria-label={t`Headings in chapter ${n}`}
          className={menuContentClass("max-h-72 min-w-52 max-w-[min(92vw,22rem)]")}
        >
          {points.map((p) => (
            <M.Item
              key={`${p.range}.${p.block}`}
              className={menuItemClass()}
              style={{ paddingInlineStart: `${0.625 + (p.level - 1) * 0.75}rem` }}
              onSelect={() => onSplit(p)}
            >
              <span className="min-w-0 truncate">{p.text}</span>
            </M.Item>
          ))}
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}
