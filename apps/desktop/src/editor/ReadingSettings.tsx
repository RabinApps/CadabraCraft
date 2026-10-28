import * as M from "@radix-ui/react-dropdown-menu";
import { ALargeSmall, Check, Minus, Plus } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { sizes, useReading, type Width } from "../state/reading";
import { useTheme, type Theme } from "../state/theme";
import { IconButton } from "../ui/Button";
import { menuContentClass, menuItemClass } from "../ui/Menu";

/** Text size and page width for reading mode. Items keep the menu open so changes can be previewed. */
export function ReadingSettings() {
  const { t } = useLingui();
  const { size, width, set } = useReading();
  const { theme, setTheme } = useTheme();
  const keep = (f: () => void) => (e: Event) => {
    e.preventDefault();
    f();
  };
  return (
    <M.Root>
      <M.Trigger asChild>
        <IconButton icon={ALargeSmall} label={t`Reading settings`} />
      </M.Trigger>
      <M.Portal>
        <M.Content align="end" className={menuContentClass("min-w-52")}>
          <M.Label className="px-2.5 py-1.5 text-xs font-semibold text-ink-muted">{t`Text size`}</M.Label>
          <M.Item
            className={menuItemClass()}
            disabled={size === 0}
            onSelect={keep(() => set({ size: size - 1 }))}
          >
            <Minus size={14} aria-hidden />
            {t`Smaller text`}
          </M.Item>
          <M.Item
            className={menuItemClass()}
            disabled={size === sizes.length - 1}
            onSelect={keep(() => set({ size: size + 1 }))}
          >
            <Plus size={14} aria-hidden />
            {t`Larger text`}
          </M.Item>
          <M.Separator className="my-1 h-px bg-border" />
          <M.Label className="px-2.5 py-1.5 text-xs font-semibold text-ink-muted">{t`Page width`}</M.Label>
          {(["narrow", "wide"] as Width[]).map((w) => (
            <M.CheckboxItem
              key={w}
              className={menuItemClass()}
              checked={width === w}
              onSelect={keep(() => set({ width: w }))}
            >
              <span className="flex size-3.5 items-center justify-center">
                <M.ItemIndicator>
                  <Check size={14} aria-hidden />
                </M.ItemIndicator>
              </span>
              {w === "narrow" ? t`Narrow page` : t`Wide page`}
            </M.CheckboxItem>
          ))}
          <M.Separator className="my-1 h-px bg-border" />
          <M.Label className="px-2.5 py-1.5 text-xs font-semibold text-ink-muted">{t`Theme`}</M.Label>
          <M.RadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
            {(
              [
                ["system", t`System`],
                ["light", t`Light`],
                ["dark", t`Dark`],
              ] as const
            ).map(([v, l]) => (
              <M.RadioItem
                key={v}
                value={v}
                className={menuItemClass()}
                onSelect={(e) => e.preventDefault()}
              >
                <span className="flex size-3.5 items-center justify-center">
                  <M.ItemIndicator>
                    <Check size={14} aria-hidden />
                  </M.ItemIndicator>
                </span>
                {l}
              </M.RadioItem>
            ))}
          </M.RadioGroup>
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}
