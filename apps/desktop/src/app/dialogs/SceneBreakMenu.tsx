import * as M from "@radix-ui/react-dropdown-menu";
import { useLingui } from "@lingui/react/macro";
import { Check, X } from "lucide-react";
import type { SceneBreakOrnamentId } from "@cadabracraft/shared";
import { menuContentClass, menuItemClass, menuLabelClass } from "../../ui/Menu";
import {
  choiceFromValue,
  choiceValue,
  ornamentRows,
  templateMarkRows,
  TEMPLATE_DEFAULT_CHOICE,
} from "./sceneBreakChoices";

/**
 * The scene-ornament card: "Template default" and the six ornaments as radio items (arrow keys, Home and End, Enter or
 * Space choose, Escape closes), then the templates' own marks as read-only rows.
 */
export function SceneBreakMenu({
  value,
  onChoose,
}: {
  value: SceneBreakOrnamentId | null;
  onChoose: (value: SceneBreakOrnamentId | null) => void;
}) {
  const { t } = useLingui();
  const templates = templateMarkRows();
  return (
    <M.Portal>
      <M.Content
        align="start"
        sideOffset={6}
        className={menuContentClass("w-[300px] max-w-[92vw]")}
      >
        <div className="flex items-center justify-between gap-2 ps-2.5 pe-1">
          <M.Label className={menuLabelClass}>{t`Scene ornament`}</M.Label>
          <M.Item aria-label={t`Close`} className={menuItemClass("px-2")}>
            <X size={16} aria-hidden />
          </M.Item>
        </div>
        <M.RadioGroup
          value={choiceValue(value)}
          onValueChange={(v) => onChoose(choiceFromValue(v))}
        >
          <OrnamentItem value={TEMPLATE_DEFAULT_CHOICE} glyph="" name={t`Template default`} />
          {ornamentRows().map((row) => (
            <OrnamentItem key={row.id} value={row.id} glyph={row.glyph} name={row.name} />
          ))}
        </M.RadioGroup>
        <M.Separator className="my-1 h-px bg-border" />
        <M.Label className={menuLabelClass}>{t`Ornament by template`}</M.Label>
        {templates.map((row) => (
          <div key={row.id} className="flex items-center gap-2 px-2.5 py-2 text-sm text-ink">
            <span className="min-w-0 flex-1 truncate">{row.name}</span>
            <span aria-hidden className="shrink-0 text-ink-muted">
              {row.glyph}
            </span>
          </div>
        ))}
      </M.Content>
    </M.Portal>
  );
}

/** One radio item: the ornament's glyph, its name, and a check when it is the chosen one. */
function OrnamentItem({ value, glyph, name }: { value: string; glyph: string; name: string }) {
  return (
    <M.RadioItem value={value} className={menuItemClass()}>
      <span className="w-4 shrink-0">
        <M.ItemIndicator>
          <Check size={16} aria-hidden />
        </M.ItemIndicator>
      </span>
      <span aria-hidden className="w-20 shrink-0 text-center">
        {glyph}
      </span>
      <span className="min-w-0 flex-1 truncate">{name}</span>
    </M.RadioItem>
  );
}
