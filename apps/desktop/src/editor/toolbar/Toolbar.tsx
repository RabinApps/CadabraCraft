import { useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useLingui } from "@lingui/react/macro";
import { IconButton } from "../../ui/Button";
import { useSettings } from "../../state/view/editorPrefs";
import { effectiveCombo } from "../../app/settings/shortcutBindings";
import { MoreFormatting, type MoreItem } from "./MoreFormatting";
import { AlignmentMenu } from "./AlignmentMenu";
import { moveInToolbar } from "./toolbarKeys";
import { TableCommands } from "./TableCommands";
import { ImageDialog, LangDialog, LinkDialog } from "./ToolbarDialogs";
import { useImageDialog } from "../useImageDialog";
import { useLangDialog } from "../useLangDialog";
import { useConvertQuotes } from "./useConvertQuotes";
import { useIndexItems, type MarkOpeners } from "../indexing/useIndexItems";
import { LiveNote } from "./LiveNote";
import { useToolbarState } from "./useToolbarState";
import { useMenuOnlyItems } from "./useMenuOnlyItems";
import { useAlignItems } from "./useAlignItems";
import { useLinkDialog, useRegisterToolbarCommands, useToolbarGroups } from "./useToolbarItems";

const MORE = "more";
const ALIGN = "align";

export function Toolbar({ editor, marks }: { editor: Editor; marks: MarkOpeners }) {
  const { t } = useLingui();
  const s = useToolbarState(editor);
  const c = () => editor.chain().focus();
  const { image, setImage, addImage, editImage, applyImage } = useImageDialog(editor, c);
  const lang = useLangDialog(editor, c);
  const { note, actions } = useConvertQuotes(editor, lang);

  const { linkOpen, setLinkOpen, href, setHref, linkError, setLinkError, setLink, applyLink } =
    useLinkDialog(editor, c, s.link);
  const groups = useToolbarGroups(s, c, { setLink, addImage });

  const menuOnly = [
    ...useMenuOnlyItems(editor, s, c, actions, editImage),
    ...useIndexItems(s.hasSelection, marks),
  ];
  const { alignNow, alignItems } = useAlignItems(s, c);

  useRegisterToolbarCommands(groups.flat(), menuOnly, alignItems, alignNow);

  // One tab stop for the whole toolbar; arrow keys move between the buttons (the WAI-ARIA toolbar pattern).
  const barRef = useRef<HTMLDivElement>(null);
  const [stop, setStop] = useState<string | null>(null);
  // The alignment button and the More formatting button are stops of the bar too, and are never disabled.
  const stops = [...groups.flat(), { id: ALIGN, disabled: false }, { id: MORE, disabled: false }];
  const stopId = (stops.find((b) => b.id === stop && !b.disabled) ?? stops.find((b) => !b.disabled))
    ?.id;
  const overrides = useSettings((p) => p.shortcutOverrides);
  // The keys the menu shows next to each alignment (the editor's own keys, changed in Settings > Shortcuts).
  const alignWithKeys = alignItems.map((b) => ({
    ...b,
    combo: b.id === "alignDefault" ? null : effectiveCombo(`editor.${b.id}`, overrides),
  }));
  const alignIcon = alignWithKeys.find((b) => b.id === alignNow)!.icon;
  const more = (ids: string[]): MoreItem[] =>
    ids.map((id) => {
      const b = menuOnly.find((m) => m.id === id)!;
      // The language command opens a dialog, so it is a plain item; its tick would not mean on or off.
      const active = id === "lang" ? undefined : b.active;
      return { ...b, active, combo: effectiveCombo(`editor.${id}`, overrides) };
    });
  const moreSections = [
    more(["strike", "code", "superscript", "subscript"]),
    more(["lang", "clearLang", "indexEntry", "glossaryTerm"]),

    more(["imageDetails", "sceneBreak", "pageBreak", "codeBlock", "taskList", "definitionList"]),
  ];

  return (
    <>
      <div
        ref={barRef}
        role="toolbar"
        aria-label={t`Formatting`}
        onKeyDown={(e) => moveInToolbar(e, barRef.current)}
        onFocus={(e) => {
          const id = (e.target as HTMLElement).closest("button")?.dataset.toolbarId;
          if (id) setStop(id);
        }}
        className="flex shrink-0 items-center gap-1 overflow-x-auto border-border bg-surface px-2 py-1.5 max-md:border-t md:flex-wrap md:justify-center md:border-b md:px-4"
      >
        {groups.map((g, i) => (
          <div
            key={i}
            role="group"
            className="flex shrink-0 items-center gap-0.5 not-first:border-s not-first:border-border not-first:ps-1.5 not-last:pe-0.5"
          >
            {g.map((b) => (
              <IconButton
                key={b.id}
                icon={b.icon}
                label={b.label}
                active={b.active ?? undefined}
                disabled={b.disabled}
                data-toolbar-id={b.id}
                tabIndex={b.id === stopId ? 0 : -1}
                onMouseDown={(e) => e.preventDefault() /* keep the editor selection */}
                onClick={b.run}
              />
            ))}
            {/* Alignment shares the block types' group, after the lists: a group of its own wraps the bar at 1280 px. */}
            {i === 3 && (
              <AlignmentMenu
                items={alignWithKeys}
                active={alignNow}
                icon={alignIcon}
                disabled={false}
                tabStop={stopId === ALIGN}
              />
            )}
          </div>
        ))}
        <div role="group" className="flex shrink-0 items-center border-s border-border ps-1.5">
          <MoreFormatting sections={moreSections} tabStop={stopId === MORE} />
        </div>
      </div>
      <LiveNote text={note} />
      <ImageDialog
        image={image}
        setImage={(next) => {
          setImage(next);
          if (next === null) editor.commands.focus();
        }}
        onInsert={applyImage}
      />
      <LangDialog
        draft={lang.draft}
        setDraft={(next) => {
          lang.setDraft(next);
          if (next === null) editor.commands.focus();
        }}
        onApply={lang.applyLang}
        onClear={lang.clearLang}
      />
      <TableCommands editor={editor} />
      <LinkDialog
        open={linkOpen}
        onOpenChange={(open) => {
          setLinkOpen(open);
          // Closing without applying (Cancel, Escape) hands the focus back to the text, not to the page.
          if (!open) editor.commands.focus();
        }}
        href={href}
        setHref={setHref}
        error={linkError}
        clearError={() => setLinkError("")}
        onApply={applyLink}
      />
    </>
  );
}
