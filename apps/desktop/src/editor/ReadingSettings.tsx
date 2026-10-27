import * as M from "@radix-ui/react-dropdown-menu";
import { ALargeSmall, Check, Minus, Plus } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { sizes, useReading, type Width } from "../state/reading";
import { useTheme, type Theme } from "../state/theme";
import { IconButton } from "../ui/Button";

const item = "flex cursor-default items-center gap-2 rounded px-2.5 py-2 text-sm text-ink outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-accent-soft";

/** Text size and page width for reading mode. Items keep the menu open so changes can be previewed. */
export function ReadingSettings() {
  const { t } = useLingui();
  const { size, width, set } = useReading();
  const { theme, setTheme } = useTheme();
  const keep = (f: () => void) => (e: Event) => { e.preventDefault(); f(); };
  return (
    <M.Root>
      <M.Trigger asChild>
        <IconButton icon={ALargeSmall} label={t`Reading settings`} />
      </M.Trigger>
      <M.Portal>
        <M.Content align="end" className="z-50 min-w-52 rounded-md border border-border bg-raised p-1 text-ink shadow-xl">
          <M.Label className="px-2.5 py-1.5 text-xs font-semibold text-ink-muted">{t`Text size`}</M.Label>
          <M.Item className={item} disabled={size === 0} onSelect={keep(() => set({ size: size - 1 }))}><Minus size={14} aria-hidden />{t`Smaller text`}</M.Item>
          <M.Item className={item} disabled={size === sizes.length - 1} onSelect={keep(() => set({ size: size + 1 }))}><Plus size={14} aria-hidden />{t`Larger text`}</M.Item>
          <M.Separator className="my-1 h-px bg-border" />
          <M.Label className="px-2.5 py-1.5 text-xs font-semibold text-ink-muted">{t`Page width`}</M.Label>
          {(["narrow", "wide"] as Width[]).map((w) => (
            <M.CheckboxItem key={w} className={item} checked={width === w} onSelect={keep(() => set({ width: w }))}>
              <span className="flex size-3.5 items-center justify-center"><M.ItemIndicator><Check size={14} aria-hidden /></M.ItemIndicator></span>
              {w === "narrow" ? t`Narrow page` : t`Wide page`}
            </M.CheckboxItem>
          ))}
          <M.Separator className="my-1 h-px bg-border" />
          <M.Label className="px-2.5 py-1.5 text-xs font-semibold text-ink-muted">{t`Theme`}</M.Label>
          <M.RadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
            {([["system", t`System`], ["light", t`Light`], ["dark", t`Dark`]] as const).map(([v, l]) => (
              <M.RadioItem key={v} value={v} className={item} onSelect={(e) => e.preventDefault()}>
                <span className="flex size-3.5 items-center justify-center"><M.ItemIndicator><Check size={14} aria-hidden /></M.ItemIndicator></span>
                {l}
              </M.RadioItem>
            ))}
          </M.RadioGroup>
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}
