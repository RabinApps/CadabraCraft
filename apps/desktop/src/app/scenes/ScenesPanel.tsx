import { useMemo } from "react";
import { useLingui } from "@lingui/react/macro";
import { ChevronLeft, X } from "lucide-react";
import { sceneRow, sceneRows } from "../../lib/scenes";
import { useSceneEditing } from "../../lib/sceneEditing";
import { useProject } from "../../state/project/index";
import { useSceneView } from "../../state/sceneView";
import { IconButton } from "../../ui/Button";
import { cx } from "../../ui/cx";
import { SceneList } from "./SceneList";
import { SceneRail } from "./SceneRail";

/**
 * The scenes without the chapter sidebar (a phone sheet, a tablet's right panel): the open chapter's scenes, and the notes of
 * the one that is selected. A phone has room for one thing at a time, so a scene replaces the list and a back button returns
 * to it; a tablet shows the two together, as the desktop does.
 */
export function ScenesPanel({ onClose }: { onClose?: () => void }) {
  const { t } = useLingui();
  const doc = useProject((s) => s.currentDoc);
  const scenes = useMemo(() => sceneRows(doc), [doc]);
  const active = useSceneView((s) => s.active);
  const show = useSceneView((s) => s.show);
  const selected = active ? sceneRow(doc, active) : null;
  return (
    <section aria-label={t`Scenes`} className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lead font-semibold">{t`Scenes`}</h2>
        {onClose && <IconButton icon={X} label={t`Close scenes`} onClick={onClose} />}
      </div>
      <div className={cx("max-h-64 shrink-0 overflow-y-auto", selected && "max-md:hidden")}>
        <SceneList
          rows={scenes}
          active={active}
          indent={false}
          onOpen={(id) => {
            useSceneEditing.getState().open?.(id);
            show(id);
          }}
          onAdd={() => {
            const id = useSceneEditing.getState().add?.();
            if (id) show(id);
          }}
        />
      </div>
      {selected && (
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-border pt-3 max-md:border-t-0 max-md:pt-0">
          <button
            type="button"
            onClick={() => show(null)}
            className="mb-2 flex items-center gap-1 rounded-md px-1 py-1.5 text-sm font-medium text-accent focus-visible:outline-2 focus-visible:outline-accent md:hidden"
          >
            <ChevronLeft size={14} aria-hidden />
            {t`Back to scenes`}
          </button>
          <SceneRail onClose={() => show(null)} />
        </div>
      )}
    </section>
  );
}
