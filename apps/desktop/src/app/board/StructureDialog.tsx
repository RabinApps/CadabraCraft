import { useEffect, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import {
  STORY_STRUCTURES,
  beatCount,
  getStructure,
  placeholderScenes,
} from "@cadabracraft/story-structures";
import { Modal } from "../../ui/Dialog";
import { Button } from "../../ui/Button";
import { Select } from "../../ui/forms/Select";
import { cx } from "../../ui/cx";
import { whyText } from "../../lib/projectError";
import { newSceneId } from "../../lib/scenes/scenes";
import { useProject } from "../../state/project/index";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The chapters of the open edition, in book order. */
  chapters: { id: string; title: string }[];
  /** The chapter the board is showing: offered first. */
  defaultChapterId: string;
  /** Called with a sentence for the live region once the scenes are in. */
  onAdded: (message: string) => void;
}

const option =
  "flex cursor-pointer gap-3 rounded-md border px-3 py-2.5 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent";

/**
 * Adds a story structure (Three-act, Hero's Journey, ...) to a chapter as scene placeholders: a scene per beat, with its title and
 * synopsis and an empty body, after everything the chapter already holds. It only adds: no existing text or scene changes, and
 * Undo takes the scenes away again.
 */
export function StructureDialog({
  open,
  onOpenChange,
  chapters,
  defaultChapterId,
  onAdded,
}: Props) {
  const { t } = useLingui();
  const actions = useProject((s) => s.actions);
  const [structureId, setStructureId] = useState(STORY_STRUCTURES[0]!.id);
  const [chapterId, setChapterId] = useState(defaultChapterId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Each opening starts fresh, on the chapter the board shows.
  useEffect(() => {
    if (!open) return;
    setStructureId(STORY_STRUCTURES[0]!.id);
    setChapterId(defaultChapterId);
    setError("");
  }, [open, defaultChapterId]);
  const structure = getStructure(structureId) ?? STORY_STRUCTURES[0]!;
  const count = beatCount(structure);
  const chapter = chapters.find((c) => c.id === chapterId) ?? chapters[0];

  const add = async () => {
    if (!chapter) return;
    setBusy(true);
    setError("");
    try {
      const made = await actions.addScenesIn(chapter.id, placeholderScenes(structure, newSceneId));
      const name = structure.name;
      const title = chapter.title;
      const n = made.length;
      onAdded(
        n
          ? t`Added ${n} scenes from ${name} to ${title}`
          : t`Nothing was added: ${title} could not be read`,
      );
      onOpenChange(false);
    } catch (e) {
      const why = whyText(e);
      setError(t`Could not add the scenes: ${why}. Nothing was changed.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      title={t`Add a story structure`}
      description={t`Each beat becomes a scene with a title and a synopsis, ready to write. Scenes are only added after what the chapter already holds; nothing is changed or removed.`}
      size="md"
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-xs font-semibold text-ink-muted">{t`Structure`}</legend>
          {STORY_STRUCTURES.map((s) => {
            const n = beatCount(s);
            const { name } = s;
            const note = `${t`${n} scenes`}. ${s.summary}`;
            return (
              <label
                key={s.id}
                className={cx(
                  option,
                  s.id === structure.id
                    ? "border-accent bg-accent-soft"
                    : "border-border-strong bg-surface",
                )}
              >
                <input
                  type="radio"
                  name="story-structure"
                  value={s.id}
                  checked={s.id === structure.id}
                  onChange={() => setStructureId(s.id)}
                  className="mt-1 accent-accent"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="font-semibold text-ink">{name}</span>
                  <span className="text-xs text-ink-muted">{note}</span>
                </span>
              </label>
            );
          })}
        </fieldset>
        <Select
          label={t`Add to chapter`}
          value={chapter?.id ?? ""}
          onChange={(e) => setChapterId(e.target.value)}
        >
          {chapters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </Select>
        <section aria-labelledby="structure-preview" className="rounded-md bg-bg p-3">
          <h3 id="structure-preview" className="mb-1.5 text-xs font-semibold text-ink-muted">
            {t`What will be added`}
          </h3>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {structure.stages.map((stage) => (
              <li key={stage.id} className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold">{stage.name}</span>
                <span className="text-xs text-ink-muted">
                  {stage.beats.map((b) => b.title).join(", ")}
                </span>
              </li>
            ))}
          </ul>
        </section>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button disabled={busy} onClick={() => onOpenChange(false)}>{t`Cancel`}</Button>
          <Button type="submit" variant="primary" disabled={busy || !chapter}>
            {t`Add ${count} scenes`}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
