import { useLingui } from "@lingui/react/macro";
import { Plus } from "lucide-react";
import { cx } from "../../ui/cx";
import { sceneWordsLabel, type SceneRow } from "../../lib/scenes/scenes";
import { sceneStatusDot, sceneStatusWord } from "./labels";

interface Props {
  rows: SceneRow[];
  /** The scene the rail is showing, if any. */
  active: string | null;
  onOpen: (id: string) => void;
  /** Absent for a chapter that is not open: a scene can only be added to the chapter being written. */
  onAdd?: () => void;
  /** The chapter the list belongs to, so several open chapters' lists can be told apart. */
  chapter?: string;
  /** Indented under its chapter row; a panel with no chapter row to sit under starts at the margin. */
  indent?: boolean;
}

/** The open chapter's scenes, indented under its row: a status dot, the title and the words written against the target. */
export function SceneList({ rows, active, onOpen, onAdd, chapter, indent = true }: Props) {
  const { t } = useLingui();
  return (
    <ul
      aria-label={chapter ? t`Scenes in ${chapter}` : t`Scenes`}
      className={cx("m-0 flex list-none flex-col gap-0.5 pb-1 pe-1", indent ? "ps-8" : "ps-1")}
    >
      {rows.map((s) => (
        <li key={s.id}>
          <button
            type="button"
            aria-current={active === s.id ? "true" : undefined}
            onClick={() => onOpen(s.id)}
            className={cx(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm text-ink hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent",
              active === s.id && "bg-raised font-medium",
            )}
          >
            <span
              aria-hidden
              className={cx("size-1.5 shrink-0 rounded-full", sceneStatusDot[s.status])}
            />
            <span className="sr-only">{sceneStatusWord(s.status)}</span>
            <span className="min-w-0 flex-1 truncate">{s.title || t`Untitled scene`}</span>
            <span className="shrink-0 text-[11px] tabular-nums text-ink-muted">
              {sceneWordsLabel(s)}
            </span>
          </button>
        </li>
      ))}
      {onAdd && (
        <li>
          <button
            type="button"
            onClick={onAdd}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm text-accent hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Plus size={12} aria-hidden />
            {t`Scene`}
          </button>
        </li>
      )}
    </ul>
  );
}
