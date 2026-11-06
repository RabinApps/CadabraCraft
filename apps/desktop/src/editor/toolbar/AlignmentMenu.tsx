import { useRef } from "react";
import * as M from "@radix-ui/react-dropdown-menu";
import { Check, type LucideIcon } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { IconButton } from "../../ui/Button";
import { mirrorClass } from "../../ui/directional";
import { menuContentClass, menuItemClass } from "../../ui/Menu";
import { isMac } from "../../lib/platform";
import { keysFor } from "../../app/settings/shortcutList";

export interface AlignItem {
  /** The command id without its prefix (`alignLeft`); also the value of the radio. */
  id: string;
  label: string;
  icon: LucideIcon;
  /** The key combo (`Mod+Shift+L`) the command answers to now, or null. */
  combo: string | null;
  run: () => void;
}

interface Props {
  /** Left, centre, right and the template's own, in the order they are listed. */
  items: AlignItem[];
  /** The id of the item that is on. */
  active: string;
  /** What the button shows: the icon of the item that is on. */
  icon: LucideIcon;
  disabled: boolean;
  /** Whether the trigger is the toolbar's one tab stop right now (the toolbar's roving tabindex). */
  tabStop: boolean;
}

/** A combo (`Mod+Shift+L`) in the WAI-ARIA `aria-keyshortcuts` spelling (`Meta+Shift+L`, `Control+Shift+L`). */
const ariaKeys = (combo: string, mac: boolean): string =>
  combo
    .split("+")
    .map((p) => (p === "Mod" ? (mac ? "Meta" : "Control") : p))
    .join("+");

/**
 * The toolbar's text alignment button: one button, whose menu is a radio group (left, centre, right, and "template default", which
 * stores nothing). Like More formatting it joins the toolbar's roving tab stop, and a choice runs after the menu has closed, so the
 * focus goes back to the text.
 */
export function AlignmentMenu({ items, active, icon, disabled, tabStop }: Props) {
  const { t } = useLingui();
  const chosen = useRef<(() => void) | null>(null);
  const mac = isMac();
  return (
    <M.Root>
      <M.Trigger asChild>
        <IconButton
          icon={icon}
          label={t`Text alignment`}
          data-toolbar-id="align"
          disabled={disabled}
          tabIndex={tabStop ? 0 : -1}
          onMouseDown={(e) => e.preventDefault() /* keep the editor selection */}
        />
      </M.Trigger>
      <M.Portal>
        <M.Content
          align="start"
          collisionPadding={8}
          sticky="always"
          onCloseAutoFocus={(e) => {
            const run = chosen.current;
            if (!run) return;
            chosen.current = null;
            e.preventDefault();
            run();
          }}
          className={menuContentClass("min-w-56")}
        >
          <M.RadioGroup value={active} aria-label={t`Text alignment`}>
            {items.map((b) => {
              const keys = b.combo ? keysFor(b.combo, mac) : [];
              return (
                <M.RadioItem
                  key={b.id}
                  value={b.id}
                  className={menuItemClass()}
                  aria-keyshortcuts={b.combo ? ariaKeys(b.combo, mac) : undefined}
                  onSelect={() => {
                    chosen.current = b.run;
                  }}
                >
                  <span className="flex size-3.5 items-center justify-center">
                    <M.ItemIndicator>
                      <Check size={14} aria-hidden />
                    </M.ItemIndicator>
                  </span>
                  <b.icon size={14} aria-hidden className={mirrorClass(b.icon)} />
                  {b.label}
                  {keys.length > 0 && (
                    <span aria-hidden className="ms-auto ps-4 text-xs text-ink-muted">
                      {keys.map((k) => k.label).join(mac ? "" : "+")}
                    </span>
                  )}
                </M.RadioItem>
              );
            })}
          </M.RadioGroup>
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}
