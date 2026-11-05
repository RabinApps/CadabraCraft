import { useMemo } from "react";
import { useLingui } from "@lingui/react/macro";
import { X } from "lucide-react";
import { sceneRow, sceneRows } from "../../lib/scenes";
import { useSceneEditing } from "../../lib/sceneEditing";
import { useProject } from "../../state/project/index";
import { useSceneView } from "../../state/sceneView";
import { IconButton } from "../../ui/Button";
import { SceneList } from "./SceneList";
import { SceneRail } from "./SceneRail";

/**
 * The scenes without the chapter sidebar (a phone sheet, a tablet's right panel): the open chapter's scenes, and the notes of
 * the one that is selected. It is the same list and rail the desktop shows in the sidebar and the side panel.
 */
export function ScenesPanel({ onClose }: { onClose?: () => void }) {
  const { t } = useLingui();
  const doc = useProject((s) => s.currentDoc);
  const scenes = useMemo(() => sceneRows(doc), [doc]);
  const active = useSceneView((s) => s.active);
  const show = useSceneView((s) => s.show);
  const open = (id: string) => {
    useSceneEditing.getState().open?.(id);
    show(id);
  };
  return (
    <section aria-label={t`Scenes`} className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lead font-semibold">{t`Scenes`}</h2>
        {onClose && <IconButton icon={X} label={t`Close scenes`} onClick={onClose} />}
      </div>
      <div className="max-h-64 shrink-0 overflow-y-auto">
        <SceneList
          rows={scenes}
          active={active}
          indent={false}
          onOpen={open}
          onAdd={() => {
            const id = useSceneEditing.getState().add?.();
            if (id) show(id);
          }}
        />
      </div>
      {active && sceneRow(doc, active) && (
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-border pt-3">
          <SceneRail onClose={() => show(null)} />
        </div>
      )}
    </section>
  );
}
