import * as M from "@radix-ui/react-dropdown-menu";
import { Ellipsis, type LucideIcon } from "lucide-react";
import { IconButton } from "../../ui/Button";
import { cx } from "../../ui/cx";

export interface HeaderMenuItem {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
}

const item =
  "flex cursor-default items-center gap-2 rounded-sm px-2.5 py-2 text-sm text-ink outline-none data-[highlighted]:bg-accent-soft";

/** Overflow menu for the phone header, where the actions do not all fit. Hidden from `sm` up. */
export function HeaderMenu({ label, items }: { label: string; items: HeaderMenuItem[] }) {
  return (
    <div className="sm:hidden">
      <M.Root>
        <M.Trigger asChild>
          <IconButton icon={Ellipsis} label={label} />
        </M.Trigger>
        <M.Portal>
          <M.Content
            align="end"
            className={cx(
              "z-(--z-menu) min-w-44 rounded-md border border-border bg-raised p-1 text-ink shadow-popover",
            )}
          >
            {items.map(({ label: l, icon: Icon, onSelect }) => (
              <M.Item key={l} className={item} onSelect={onSelect}>
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
