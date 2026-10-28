import * as TG from "@radix-ui/react-toggle-group";
import type { LucideIcon } from "lucide-react";
import { cx } from "./cx";

interface Item<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
  /** Hide the text below the sm breakpoint only. */
  collapse?: boolean;
}

interface Props<T extends string> {
  value: T;
  onChange: (v: T) => void;
  items: Item<T>[];
  label: string;
}

export function Segmented<T extends string>({ value, onChange, items, label }: Props<T>) {
  return (
    <TG.Root
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as T)}
      aria-label={label}
      className="inline-flex max-w-full flex-wrap gap-0.5 rounded-[10px] border border-border bg-bg p-[3px]"
    >
      {items.map(({ value: v, label: l, icon: Icon, collapse }) => (
        <TG.Item
          key={v}
          value={v}
          aria-label={l}
          title={l}
          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-[7px] px-3 py-1.5 text-[13px] font-semibold text-ink-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-accent data-[state=on]:bg-accent-soft data-[state=on]:text-accent"
        >
          {Icon && <Icon size={14} aria-hidden />}
          <span className={cx(collapse && "max-sm:hidden")}>{l}</span>
        </TG.Item>
      ))}
    </TG.Root>
  );
}
