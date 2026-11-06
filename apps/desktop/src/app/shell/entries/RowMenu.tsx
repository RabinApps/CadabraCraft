import type { MutableRefObject } from "react";
import * as M from "@radix-ui/react-dropdown-menu";
import { useLingui } from "@lingui/react/macro";
import {
  ArrowDown,
  ArrowUp,
  Ellipsis,
  History,
  Layers,
  Pencil,
  Shapes,
  Trash2,
} from "lucide-react";
import type { LanguageRow } from "@cadabracraft/format";
import { IconButton } from "../../../ui/Button";
import { menuContentClass, menuItemClass } from "../../../ui/Menu";
import { useProject } from "../../../state/project/index";
import { attempt } from "../../../state/attempt";
import type { HistoryPage } from "../../dialogs/HistoryDialog";
import type { IconPage } from "../../dialogs/IconDialog";
import { ChoiceGroup } from "./ChoiceGroup";

interface RowMenuProps {
  row: LanguageRow;
  index: number;
  last: number;
  chapters?: boolean;
  partIndexes: number[];
  /** Rename, History and Trash run once the menu has closed, so the field or dialog they open can take focus. */
  afterClose: MutableRefObject<(() => void) | null>;
  step: (i: number, delta: -1 | 1) => void;
  say: (message: string) => void;
  setEditing: (e: { id: string }) => void;
  setDeleting: (d: { id: string; title: string }) => void;
  setHistory: (p: HistoryPage) => void;
  setIcon: (p: IconPage) => void;
}

/** Runs the action waiting for the menu to close (Rename, History, Trash), and gives focus back to the menu button first. */
function runAfterClose(afterClose: MutableRefObject<(() => void) | null>, e: Event) {
  const next = afterClose.current;
  afterClose.current = null;
  if (next) {
    e.preventDefault();
    // The dialog that `next` opens remembers where focus is, to give it back when it closes.
    const trigger = (e.target as HTMLElement).getAttribute("aria-labelledby");
    document.getElementById(trigger ?? "")?.focus();
  }
  next?.();
}

interface ChoiceProps {
  row: LanguageRow;
  say: (message: string) => void;
}

function DropCapChoice({ row: c, say }: ChoiceProps) {
  const { t } = useLingui();
  const actions = useProject((s) => s.actions);
  const title = c.title;
  return (
    <ChoiceGroup
      label={t`First letter`}
      value={c.dropCap === undefined ? "default" : c.dropCap ? "big" : "normal"}
      choices={[
        ["default", t`Default`],
        ["big", t`Big`],
        ["normal", t`Normal`],
      ]}
      onValueChange={(v) => {
        attempt(actions.setChapterDropCap(c.id, v === "default" ? null : v === "big"));
        say(
          v === "default"
            ? t`${title}: first letter follows the book`
            : v === "big"
              ? t`${title}: big first letter`
              : t`${title}: normal first letter`,
        );
      }}
    />
  );
}

function VerticalChoice({ row: c, say }: ChoiceProps) {
  const { t } = useLingui();
  const actions = useProject((s) => s.actions);
  const title = c.title;
  return (
    <ChoiceGroup
      label={t`Vertical position`}
      value={c.verticalCenter === undefined ? "default" : c.verticalCenter ? "centred" : "top"}
      choices={[
        ["default", t`Default`],
        ["centred", t`Centred`],
        ["top", t`Top`],
      ]}
      onValueChange={(v) => {
        attempt(actions.setVerticalCenter(c.id, v === "default" ? null : v === "centred"));
        say(
          v === "default"
            ? t`${title}: vertical position follows the template`
            : v === "centred"
              ? t`${title}: centred on the page`
              : t`${title}: at the top of the page`,
        );
      }}
    />
  );
}

function PageStartChoice({ row: c, say }: ChoiceProps) {
  const { t } = useLingui();
  const actions = useProject((s) => s.actions);
  return (
    <ChoiceGroup
      label={t`Page start`}
      value={c.startOnNext === undefined ? "book" : c.startOnNext ? "next" : "recto"}
      choices={[
        ["book", t`Follows the book`],
        ["next", t`Start on the next page`],
        ["recto", t`Start on a right-hand page`],
      ]}
      onValueChange={(v) => {
        attempt(actions.setStartOnNext(c.id, v === "book" ? null : v === "next"));
        say(
          v === "book"
            ? t`${c.title}: page start follows the book`
            : v === "next"
              ? t`${c.title}: starts on the next page`
              : t`${c.title}: starts on a right-hand page`,
        );
      }}
    />
  );
}

function MoveItems({
  row: c,
  index: i,
  last,
  partIndexes,
  step,
}: Pick<RowMenuProps, "row" | "index" | "last" | "partIndexes" | "step">) {
  const { t } = useLingui();
  return (
    <>
      <M.Item
        className={menuItemClass()}
        disabled={c.kind === "part" ? partIndexes.indexOf(i) <= 0 : i === 0}
        onSelect={() => step(i, -1)}
      >
        <ArrowUp size={14} aria-hidden />
        {c.kind === "part" ? t`Move part up` : t`Move up`}
      </M.Item>
      <M.Item
        className={menuItemClass()}
        disabled={
          c.kind === "part" ? partIndexes.indexOf(i) === partIndexes.length - 1 : i === last
        }
        onSelect={() => step(i, 1)}
      >
        <ArrowDown size={14} aria-hidden />
        {c.kind === "part" ? t`Move part down` : t`Move down`}
      </M.Item>
    </>
  );
}

/** The "..." menu of one row: rename, icon, part, move, first letter, vertical position, page start, history and trash. */
export function RowMenu({
  row: c,
  index: i,
  last,
  chapters,
  partIndexes,
  afterClose,
  step,
  say,
  setEditing,
  setDeleting,
  setHistory,
  setIcon,
}: RowMenuProps) {
  const { t } = useLingui();
  const actions = useProject((s) => s.actions);
  const moveFocus = (f: () => void) => () => void (afterClose.current = f);
  return (
    <M.Root>
      <M.Trigger asChild>
        <IconButton
          icon={Ellipsis}
          label={t`Actions for ${c.title}`}
          className="shrink-0 md:size-7"
        />
      </M.Trigger>
      <M.Portal>
        <M.Content
          align="end"
          onCloseAutoFocus={(e) => runAfterClose(afterClose, e)}
          className={menuContentClass("min-w-44")}
        >
          {/* A blank page holds no text: there is no title to change, no text to give an icon to, no headings to list, and
            no position or page start to choose (it is already the blank page, and it follows the page before it). */}
          {c.kind !== "blank" && (
            <>
              <M.Item
                className={menuItemClass()}
                onSelect={moveFocus(() => setEditing({ id: c.id }))}
              >
                <Pencil size={14} aria-hidden />
                {t`Rename`}
              </M.Item>
              <M.Item
                className={menuItemClass()}
                onSelect={moveFocus(() => setIcon({ id: c.id, title: c.title, icon: c.icon }))}
              >
                <Shapes size={14} aria-hidden />
                {t`Change icon…`}
              </M.Item>
            </>
          )}
          {chapters && c.kind !== "part" && c.kind !== "blank" && (
            <M.Item
              className={menuItemClass()}
              onSelect={() => attempt(actions.startPart(c.id, t`Part ${partIndexes.length + 1}`))}
            >
              <Layers size={14} aria-hidden />
              {t`Start part here`}
            </M.Item>
          )}
          <MoveItems row={c} index={i} last={last} partIndexes={partIndexes} step={step} />
          {chapters && c.kind !== "part" && (
            <>
              <M.Separator className="my-1 h-px bg-border" />
              <DropCapChoice row={c} say={say} />
              <M.Separator className="my-1 h-px bg-border" />
            </>
          )}
          {!chapters && c.kind !== "contents" && c.kind !== "copyright" && c.kind !== "blank" && (
            <>
              <M.Separator className="my-1 h-px bg-border" />
              <VerticalChoice row={c} say={say} />
            </>
          )}
          {/* Where the page numbering puts a matter page: the book's rules (a dedication, epigraph or title page opens on a
            right-hand page, with a blank left-hand page before it when that is what it takes), the next page whatever the
            rules say (no blank page before it), or a right-hand page (a blank page inserted when the rules leave it on a
            verso). All three are always offered: a page can be taken off a blank it no longer wants, or given one. */}
          {!chapters && c.kind !== "blank" && (
            <>
              <M.Separator className="my-1 h-px bg-border" />
              <PageStartChoice row={c} say={say} />
              <M.Separator className="my-1 h-px bg-border" />
            </>
          )}
          {c.kind !== "blank" && (
            <M.Item
              className={menuItemClass()}
              onSelect={moveFocus(() => setHistory({ id: c.id, title: c.title, file: c.file }))}
            >
              <History size={14} aria-hidden />
              {t`History`}
            </M.Item>
          )}
          <M.Item
            className={menuItemClass("text-danger")}
            onSelect={moveFocus(() => setDeleting({ id: c.id, title: c.title }))}
          >
            <Trash2 size={14} aria-hidden />
            {c.kind === "part" ? t`Remove part` : t`Move to trash`}
          </M.Item>
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}
