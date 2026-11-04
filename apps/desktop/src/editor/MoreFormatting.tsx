import { Fragment, useRef } from "react";
import * as M from "@radix-ui/react-dropdown-menu";
import { Check, Ellipsis, type LucideIcon } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { IconButton } from "../ui/Button";
import { menuContentClass, menuItemClass } from "../ui/Menu";
import { isMac } from "../lib/platform";
import { keysFor } from "../app/settings/shortcutList";

export interface MoreItem {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Set for a toggle (a mark or a block that is on or off): the item is a checkbox menu item with this state. */
  active?: boolean;
  disabled?: boolean;
  /** The key combo (`Mod+Shift+S`) the command answers to now, or null. */
  combo?: string | null;
  run: () => void;
}

/** A combo (`Mod+Shift+S`) in the WAI-ARIA `aria-keyshortcuts` spelling (`Meta+Shift+S`, `Control+Shift+S`). */
const ariaKeys = (combo: string, mac: boolean): string =>
  combo
    .split("+")
    .map((p) => (p === "Mod" ? (mac ? "Meta" : "Control") : p))
    .join("+");

interface Props {
  /** The items in sections; a separator goes between sections. */
  sections: MoreItem[][];
  /** Whether the trigger is the toolbar's one tab stop right now (the toolbar's roving tabindex). */
  tabStop: boolean;
}

/** The toolbar's overflow menu: the rarely used marks and blocks and the language command, so the bar stays on one row. */
export function MoreFormatting({ sections, tabStop }: Props) {
  const { t } = useLingui();
  /** The chosen item's action. It runs once the menu has closed; it puts the focus back in the text itself (its chain focuses the editor, a dialog it opens does so when it closes). */
  const chosen = useRef<(() => void) | null>(null);
  const mac = isMac();
  const row = (b: MoreItem) => {
    const keys = b.combo ? keysFor(b.combo, mac) : [];
    const common = {
      className: menuItemClass(),
      disabled: b.disabled,
      "aria-keyshortcuts": b.combo ? ariaKeys(b.combo, mac) : undefined,
      onSelect: () => {
        chosen.current = b.run;
      },
    };
    const label = (
      <>
        {b.label}
        {keys.length > 0 && (
          <span aria-hidden className="ms-auto ps-4 text-xs text-ink-muted">
            {keys.map((k) => k.label).join(mac ? "" : "+")}
          </span>
        )}
      </>
    );
    return b.active === undefined ? (
      <M.Item key={b.id} {...common}>
        <b.icon size={14} aria-hidden />
        {label}
      </M.Item>
    ) : (
      <M.CheckboxItem key={b.id} {...common} checked={b.active}>
        <span className="flex size-3.5 items-center justify-center">
          <M.ItemIndicator>
            <Check size={14} aria-hidden />
          </M.ItemIndicator>
        </span>
        {label}
      </M.CheckboxItem>
    );
  };
  return (
    <M.Root>
      <M.Trigger asChild>
        <IconButton
          icon={Ellipsis}
          label={t`More formatting`}
          data-toolbar-id="more"
          tabIndex={tabStop ? 0 : -1}
        />
      </M.Trigger>
      <M.Portal>
        <M.Content
          align="end"
          collisionPadding={8}
          sticky="always"
          onCloseAutoFocus={(e) => {
            const run = chosen.current;
            if (!run) return;
            chosen.current = null;
            e.preventDefault();
            run();
          }}
          className={menuContentClass(
            "max-h-(--radix-dropdown-menu-content-available-height) min-w-60 overflow-y-auto",
          )}
        >
          {sections.map((items, i) => (
            <Fragment key={i}>
              {i > 0 && <M.Separator className="my-1 h-px bg-border" />}
              <M.Group>{items.map(row)}</M.Group>
            </Fragment>
          ))}
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}
