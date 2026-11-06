import { useId, useState, type KeyboardEvent, type PointerEvent } from "react";
import * as M from "@radix-ui/react-dropdown-menu";
import { useLingui } from "@lingui/react/macro";
import { ArrowDown, ArrowUp, Ellipsis, GripVertical, PenLine } from "lucide-react";
import { MAX_SCENE_POV, MAX_SCENE_SYNOPSIS, SCENE_STATUSES } from "@cadabracraft/editor-schema";
import {
  sceneProgress,
  sceneWordsLabel,
  type SceneRow,
  type SceneStatus,
} from "../../lib/scenes/scenes";
import { IconButton } from "../../ui/Button";
import { cx } from "../../ui/cx";
import { menuContentClass, menuItemClass, menuLabelClass } from "../../ui/Menu";
import { sceneStatusWord } from "../scenes/labels";

/** Where a card can go from here: the arrow keys and the menu offer exactly these. */
export interface CardMoves {
  /** Position in its chapter (0-based) and how many scenes the chapter holds. */
  index: number;
  count: number;
  /** The other chapters it can go to. */
  chapters: { id: string; title: string }[];
  /** Earlier or later in the chapter, or to the neighbouring chapter (-1 / +1 along the board). */
  step: (delta: -1 | 1) => void;
  beside: (delta: -1 | 1) => void;
  toChapter: (chapterId: string) => void;
}

interface Props {
  scene: SceneRow;
  chapterTitle: string;
  moves: CardMoves;
  /** Names to suggest for the point of view (the codex's characters). */
  povNames: string[];
  dragging: boolean;
  /** The grip's pointer-down, from the board's drag. */
  onGrab: (e: PointerEvent<HTMLElement>) => void;
  /** Saves a change to the scene's notes. */
  onPatch: (patch: { synopsis?: string; pov?: string; status?: SceneStatus }) => void;
  onOpen: () => void;
  gripHelpId: string;
}

const statuses: SceneStatus[] = ["", ...SCENE_STATUSES];

/** One scene of the board: grip, title, synopsis (click to edit), POV, status and words against the target. */
export function SceneCard({
  scene,
  chapterTitle,
  moves,
  povNames,
  dragging,
  onGrab,
  onPatch,
  onOpen,
  gripHelpId,
}: Props) {
  const { t } = useLingui();
  const title = scene.title || t`Untitled scene`;
  const [editing, setEditing] = useState(false);
  const povList = useId();
  const progress = sceneProgress(scene);
  const gripKeys = (e: KeyboardEvent) => {
    // The columns run the other way in a right-to-left interface, so the arrows do too.
    const flip = getComputedStyle(e.currentTarget).direction === "rtl" ? -1 : 1;
    const keys: Record<string, () => void> = {
      ArrowUp: () => moves.step(-1),
      ArrowDown: () => moves.step(1),
      ArrowLeft: () => moves.beside(-flip as -1 | 1),
      ArrowRight: () => moves.beside(flip),
    };
    const run = keys[e.key];
    if (!run) return;
    e.preventDefault();
    run();
  };
  return (
    <li
      data-scene-card
      data-scene-id={scene.id}
      className={cx(
        "relative flex flex-col gap-2 rounded-lg border border-border bg-surface p-3",
        dragging && "opacity-40",
      )}
    >
      <div className="flex items-start gap-1">
        <button
          type="button"
          data-grip
          data-grip-for={scene.id}
          aria-label={t`Reorder ${title}`}
          aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
          aria-describedby={gripHelpId}
          onPointerDown={onGrab}
          onKeyDown={gripKeys}
          className="-ms-1 flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-sm text-ink-muted max-md:size-11 focus-visible:outline-2 focus-visible:outline-accent"
        >
          <GripVertical size={16} aria-hidden />
        </button>
        <h3 className="min-w-0 flex-1 pt-0.5 text-sm font-semibold break-words">{title}</h3>
        <M.Root>
          <M.Trigger asChild>
            <IconButton
              icon={Ellipsis}
              label={t`Actions for ${title}`}
              className="shrink-0 md:size-7"
            />
          </M.Trigger>
          <M.Portal>
            <M.Content align="end" className={menuContentClass("min-w-48")}>
              <M.Item
                className={menuItemClass()}
                disabled={moves.index === 0}
                onSelect={() => moves.step(-1)}
              >
                <ArrowUp size={14} aria-hidden />
                {t`Move earlier`}
              </M.Item>
              <M.Item
                className={menuItemClass()}
                disabled={moves.index === moves.count - 1}
                onSelect={() => moves.step(1)}
              >
                <ArrowDown size={14} aria-hidden />
                {t`Move later`}
              </M.Item>
              {moves.chapters.length > 0 && (
                <>
                  <M.Separator className="my-1 h-px bg-border" />
                  <M.Label className={menuLabelClass} aria-hidden>
                    {t`Move to chapter`}
                  </M.Label>
                  {moves.chapters.map((c) => (
                    <M.Item
                      key={c.id}
                      className={menuItemClass()}
                      onSelect={() => moves.toChapter(c.id)}
                    >
                      {c.title}
                    </M.Item>
                  ))}
                </>
              )}
              <M.Separator className="my-1 h-px bg-border" />
              <M.Item className={menuItemClass()} onSelect={onOpen}>
                <PenLine size={14} aria-hidden />
                {t`Open scene`}
              </M.Item>
            </M.Content>
          </M.Portal>
        </M.Root>
      </div>
      {editing ? (
        <textarea
          autoFocus
          aria-label={t`Synopsis of ${title}`}
          defaultValue={scene.synopsis}
          maxLength={MAX_SCENE_SYNOPSIS}
          rows={4}
          onBlur={(e) => {
            setEditing(false);
            // Escape cancels: closing the field can still blur it, which must not save.
            if (e.target.dataset.cancelled) return;
            const value = e.target.value.trim();
            if (value !== scene.synopsis) onPatch({ synopsis: value });
          }}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.currentTarget.dataset.cancelled = "true";
            setEditing(false);
          }}
          className="w-full resize-y rounded-md border border-border-strong bg-bg px-2 py-1.5 font-book text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent"
        />
      ) : (
        <button
          type="button"
          // The name starts with the words on the button (WCAG 2.5.3) and then says whose synopsis it is.
          aria-label={
            scene.synopsis
              ? t`${scene.synopsis}, edit synopsis of ${title}`
              : t`Add a synopsis to ${title}`
          }
          onClick={() => setEditing(true)}
          className={cx(
            "rounded-md px-1 py-1 text-start font-book text-sm break-words hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent max-md:min-h-11",
            scene.synopsis ? "text-ink" : "text-ink-muted",
          )}
        >
          {scene.synopsis || t`Add a synopsis`}
        </button>
      )}
      <div className="flex gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={`${povList}-pov`} className="text-micro font-semibold text-ink-muted">
            {t`Point of view`}
          </label>
          <input
            id={`${povList}-pov`}
            list={povList}
            // The suggestions are only suggestions: a book with no codex, or a POV the codex does not know, takes any text.
            defaultValue={scene.pov}
            key={`pov-${scene.pov}`}
            maxLength={MAX_SCENE_POV}
            aria-label={t`Point of view of ${title}`}
            onBlur={(e) => {
              const value = e.target.value.trim();
              if (value !== scene.pov) onPatch({ pov: value });
            }}
            className="w-full rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent max-md:min-h-11"
          />
          <datalist id={povList}>
            {povNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={`${povList}-status`} className="text-micro font-semibold text-ink-muted">
            {t`Status`}
          </label>
          <select
            id={`${povList}-status`}
            aria-label={t`Status of ${title}`}
            value={scene.status}
            onChange={(e) => onPatch({ status: e.target.value as SceneStatus })}
            className="w-full rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent max-md:min-h-11"
          >
            {statuses.map((s) => (
              <option key={s} value={s}>
                {sceneStatusWord(s)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2 text-caption text-ink-muted">
          <span>{t`${sceneWordsLabel(scene)} words`}</span>
          <button
            type="button"
            onClick={onOpen}
            aria-label={t`Open scene ${title} in ${chapterTitle}`}
            className="rounded-sm text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent max-md:min-h-11"
          >
            {t`Open`}
          </button>
        </div>
        {progress !== null && (
          <div aria-hidden className="h-1 w-full rounded-full bg-border">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        )}
      </div>
    </li>
  );
}
