import * as M from "@radix-ui/react-dropdown-menu";
import { useLingui } from "@lingui/react/macro";
import { ChevronDown } from "lucide-react";
import { useId } from "react";
import type { SceneBreakOrnamentId } from "@cadabracraft/shared";
import { DEFAULT_TEMPLATE_ID, hasTemplate } from "@cadabracraft/templates";
import { useProject } from "../../state/project/index";
import { SceneBreakMenu } from "./SceneBreakMenu";
import { triggerText } from "./sceneBreakChoices";

/**
 * Scene-break ornament of the book: a button that shows the current choice (its glyph and name, or the template's mark)
 * and opens the ornament card. "Template default" keeps the template's own mark.
 */
export function SceneBreakField({
  value,
  onChange,
}: {
  value: SceneBreakOrnamentId | null;
  onChange: (value: SceneBreakOrnamentId | null) => void;
}) {
  const { t } = useLingui();
  const manifest = useProject((s) => s.manifest);
  const templateId =
    manifest && hasTemplate(manifest.template) ? manifest.template : DEFAULT_TEMPLATE_ID;
  const labelId = useId();
  const hintId = useId();
  const shown = triggerText(value, templateId);
  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelId} className="text-xs font-semibold text-ink-muted">
        {t`Scene break`}
      </span>
      <M.Root>
        <M.Trigger
          id={`${labelId}-button`}
          aria-labelledby={`${labelId} ${labelId}-button`}
          aria-describedby={hintId}
          className="flex w-full items-center gap-2 rounded-md border border-border-strong bg-surface px-3 py-2.5 text-start text-sm text-ink max-md:min-h-11 focus-visible:outline-2 focus-visible:outline-accent"
        >
          <span aria-hidden className="w-16 shrink-0 text-center">
            {shown.glyph}
          </span>
          <span className="min-w-0 flex-1 truncate">{shown.name}</span>
          <ChevronDown size={16} aria-hidden className="shrink-0 text-ink-muted" />
        </M.Trigger>
        <SceneBreakMenu value={value} onChoose={onChange} />
      </M.Root>
      <p id={hintId} className="text-xs text-ink-muted">
        {t`The mark between scenes in the print PDF, EPUB and Word files.`}
      </p>
    </div>
  );
}
