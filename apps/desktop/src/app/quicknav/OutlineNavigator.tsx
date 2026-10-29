import { useCallback, useMemo } from "react";
import { useLingui } from "@lingui/react/macro";
import { entryRowsIn, readingOrder } from "@cadabracraft/format";
import { jumpToHeading } from "../../editor/headingJump";
import { extractOutline } from "../../lib/outline";
import { attempt } from "../../state/attempt";
import { useProject } from "../../state/project/index";
import { outlineEntries, outlineResults } from "./quickNavModel";
import { QuickPicker, type PickerItem } from "./QuickPicker";

/**
 * Cmd/Ctrl+Shift+O. The headings of the open chapter, then every page of the book. Choosing a heading moves the caret there;
 * choosing a page opens it (the open chapter is saved first, like a click in the chapter list).
 */
export function OutlineNavigator({ onClose }: { onClose: () => void }) {
  const { t } = useLingui();
  const manifest = useProject((s) => s.manifest);
  const language = useProject((s) => s.activeLanguage ?? s.manifest?.editions[0]?.language ?? "");
  const currentId = useProject((s) => s.currentId);
  const doc = useProject((s) => s.draft ?? s.currentDoc);
  const actions = useProject((s) => s.actions);
  const headings = t`In this chapter`;
  const chapters = t`Chapters`;
  const current = t`Current`;
  const entries = useMemo(
    () =>
      outlineEntries(
        extractOutline(doc),
        manifest ? entryRowsIn(readingOrder(manifest), manifest.editions, language) : [],
        currentId,
      ),
    [doc, manifest, language, currentId],
  );
  const filter = useCallback(
    (query: string): PickerItem[] =>
      outlineResults(entries, query).map(({ entry, positions }) => ({
        id: entry.key,
        label: entry.label,
        positions,
        group: entry.group === "headings" ? headings : chapters,
        enabled: true,
        ...(entry.level === undefined ? {} : { level: entry.level }),
        ...(entry.current ? { current } : {}),
      })),
    [entries, headings, chapters, current],
  );
  const choose = (item: PickerItem) => {
    const entry = entries.find((e) => e.key === item.id);
    onClose();
    if (!entry) return;
    // Let the dialog unmount first, so focus goes back to the page before the caret moves.
    setTimeout(() => {
      if (entry.headingIndex !== undefined) jumpToHeading(entry.headingIndex);
      else if (entry.pageId !== undefined) attempt(actions.selectChapter(entry.pageId));
    }, 0);
  };
  return (
    <QuickPicker
      open
      onOpenChange={(open) => !open && onClose()}
      title={t`Outline`}
      placeholder={t`Search headings and chapters`}
      filter={filter}
      empty={(q) => t`No heading or chapter matches “${q}”.`}
      onChoose={choose}
    />
  );
}
