import * as M from "@radix-ui/react-dropdown-menu";
import { Ellipsis, type LucideIcon } from "lucide-react";
import { IconButton } from "../../../ui/Button";
import { menuContentClass, menuItemClass } from "../../../ui/Menu";

export interface HeaderMenuItem {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
}

/** Overflow menu for the phone header, where the actions do not all fit. Hidden from `sm` up. */
export function HeaderMenu({ label, items }: { label: string; items: HeaderMenuItem[] }) {
  return (
    <div className="sm:hidden">
      <M.Root>
        <M.Trigger asChild>
          <IconButton icon={Ellipsis} label={label} />
        </M.Trigger>
        <M.Portal>
          <M.Content align="end" className={menuContentClass("min-w-44")}>
            {items.map(({ label: l, icon: Icon, onSelect }) => (
              <M.Item key={l} className={menuItemClass()} onSelect={onSelect}>
                <Icon size={14} aria-hidden />
                {l}
              </M.Item>
            ))}
          </M.Content>
        </M.Portal>
      </M.Root>
    </div>
  );
}
