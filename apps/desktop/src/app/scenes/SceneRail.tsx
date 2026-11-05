import { useLingui } from "@lingui/react/macro";
import { X } from "lucide-react";
import {
  MAX_SCENE_LABEL,
  MAX_SCENE_POV,
  MAX_SCENE_SYNOPSIS,
  MAX_SCENE_TARGET,
  MAX_SCENE_TITLE,
  SCENE_STATUSES,
} from "@cadabracraft/editor-schema";
import { sceneProgress, sceneRow, sceneWordsLabel, type SceneStatus } from "../../lib/scenes";
import { useSceneEditing } from "../../lib/sceneEditing";
import { useProject } from "../../state/project/index";
import { useSceneView } from "../../state/sceneView";
import { Button, IconButton } from "../../ui/Button";
import { Chip } from "../../ui/Chip";
import { cx } from "../../ui/cx";
import { Field } from "../../ui/Input";
import { sceneStatusWord, sceneStatusTone } from "./labels";

const pillTone = {
  warn: "bg-warn-soft text-warn",
  success: "bg-success-soft text-success",
  none: "bg-raised text-ink-muted",
};

/**
 * The scene rail: the notes of the scene the sidebar is pointing at — its state, who it follows, how far the target is, the
 * synopsis and the label. Every change is a change to the chapter, so the rail writes through the editor.
 */
export function SceneRail({ onClose }: { onClose?: () => void }) {
  const { t } = useLingui();
  const doc = useProject((s) => s.currentDoc);
  const active = useSceneView((s) => s.active);
  const show = useSceneView((s) => s.show);
  const update = useSceneEditing((s) => s.update);
  const open = useSceneEditing((s) => s.open);
  const scene = sceneRow(doc, active);
  if (!scene) return null;
  const save = (attrs: Record<string, unknown>) => update?.(scene.id, attrs);
  const progress = sceneProgress(scene);
  const statuses: SceneStatus[] = ["", ...SCENE_STATUSES];
  return (
    <section aria-label={t`Scene`} className="flex h-full min-h-0 flex-col gap-4 p-4">
      <div className="flex items-start justify-between gap-2">
        <h2 className="min-w-0 text-lead font-semibold break-words">
          {scene.title || t`Untitled scene`}
        </h2>
        <div className="flex shrink-0 items-center gap-1">
          <span
            className={cx(
              "rounded-full px-2 py-0.5 text-caption font-semibold",
              pillTone[sceneStatusTone(scene.status)],
            )}
          >
            {sceneStatusWord(scene.status)}
          </span>
          <IconButton icon={X} label={t`Close scene`} onClick={onClose ?? (() => show(null))} />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-caption text-ink-muted">
          {scene.pov
            ? t`POV ${scene.pov} · ${sceneWordsLabel(scene)} words`
            : t`${sceneWordsLabel(scene)} words`}
        </p>
        <div aria-hidden className="h-1.5 w-full rounded-full bg-border">
          <div
            className="h-full rounded-full bg-accent"
            style={{ width: `${Math.round((progress ?? 0) * 100)}%` }}
          />
        </div>
      </div>
      <Field
        key={`title-${scene.id}`}
        label={t`Scene title`}
        defaultValue={scene.title}
        maxLength={MAX_SCENE_TITLE}
        onBlur={(e) => save({ title: e.target.value.trim() })}
      />
      <div role="group" aria-label={t`Scene status`} className="flex flex-wrap gap-1.5">
        {statuses.map((s) => (
          <Chip key={s} pressed={scene.status === s} onClick={() => save({ status: s })}>
            {sceneStatusWord(s)}
          </Chip>
        ))}
      </div>
      <div className="flex gap-2">
        <Field
          key={`pov-${scene.id}`}
          label={t`Point of view`}
          defaultValue={scene.pov}
          maxLength={MAX_SCENE_POV}
          onBlur={(e) => save({ pov: e.target.value.trim() })}
        />
        <Field
          key={`label-${scene.id}`}
          label={t`Label`}
          defaultValue={scene.label}
          maxLength={MAX_SCENE_LABEL}
          onBlur={(e) => save({ label: e.target.value.trim() })}
        />
      </div>
      <Field
        key={`target-${scene.id}`}
        label={t`Target words`}
        type="number"
        min={0}
        max={MAX_SCENE_TARGET}
        defaultValue={scene.target ?? ""}
        onBlur={(e) => {
          const n = Number(e.target.value);
          save({
            target: e.target.value.trim() === "" || !Number.isFinite(n) ? null : Math.round(n),
          });
        }}
      />
      <div className="flex min-h-0 flex-col gap-1.5">
        <label htmlFor="scene-synopsis" className="text-xs font-semibold text-ink-muted">
          {t`Synopsis`}
        </label>
        <textarea
          id="scene-synopsis"
          key={`synopsis-${scene.id}`}
          defaultValue={scene.synopsis}
          maxLength={MAX_SCENE_SYNOPSIS}
          rows={4}
          onBlur={(e) => save({ synopsis: e.target.value.trim() })}
          className="min-h-20 w-full resize-y rounded-md border border-border-strong bg-surface px-3 py-2 font-book text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent"
        />
      </div>
      <Button
        variant="primary"
        className="mt-auto w-full justify-center"
        onClick={() => open?.(scene.id)}
      >
        {t`Open scene`}
      </Button>
    </section>
  );
}
