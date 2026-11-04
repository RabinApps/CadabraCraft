import { useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { useLingui } from "@lingui/react/macro";
import {
  ALargeSmall,
  AlignCenter,
  AlignLeft,
  AlignRight,
  Asterisk,
  Bold,
  Code,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Pilcrow,
  SquarePen,
  Italic,
  Languages,
  Link,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Redo2,
  Strikethrough,
  Subscript,
  Superscript,
  Underline,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { normalizeLinkUrl, textAlignAt } from "@cadabracraft/editor-schema";
import { IconButton } from "../ui/Button";
import { focusField } from "../ui/Input";
import { useRegisterCommands } from "../state/commands";
import { attempt } from "../state/attempt";
import { useSettings } from "../state/editorPrefs";
import { effectiveCombo } from "../app/settings/shortcutBindings";
import { MoreFormatting, type MoreItem } from "./MoreFormatting";
import { AlignmentMenu, type AlignItem } from "./AlignmentMenu";
import { moveInToolbar } from "./toolbarKeys";
import { TableCommands } from "./TableCommands";
import { ImageDialog, LangDialog, LinkDialog } from "./ToolbarDialogs";
import { useImageDialog } from "./useImageDialog";
import { insertDefinitionList } from "./insertDefinitionList";
import { useLangDialog } from "./useLangDialog";

const MORE = "more";
const ALIGN = "align";

interface Item {
  id: string;
  label: string;
  icon: LucideIcon;
  active?: boolean;
  disabled?: boolean;
  run: () => void;
}

export function Toolbar({ editor }: { editor: Editor }) {
  const { t } = useLingui();
  // Re-render only when the toolbar-relevant state changes.
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      smallCaps: e.isActive("smallCaps"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      superscript: e.isActive("superscript"),
      subscript: e.isActive("subscript"),
      codeBlock: e.isActive("codeBlock"),
      link: e.isActive("link"),
      lang: e.isActive("lang"),
      h1: e.isActive("heading", { level: 1 }),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      quote: e.isActive("blockquote"),
      bullets: e.isActive("bulletList"),
      numbers: e.isActive("orderedList"),
      taskList: e.isActive("taskList"),
      definitionList: e.isActive("definitionList"),
      image: e.isActive("image"),
      align: textAlignAt(e),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const c = () => editor.chain().focus();
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState("");
  const [linkError, setLinkError] = useState("");

  const { image, setImage, addImage, editImage, applyImage } = useImageDialog(editor, c);
  const lang = useLangDialog(editor, c);

  const setLink = () => {
    if (s.link) {
      c().extendMarkRange("link").unsetLink().run();
      return;
    }
    setHref("");
    setLinkError("");
    setLinkOpen(true);
  };
  const applyLink = () => {
    const url = normalizeLinkUrl(href);
    if (!url) {
      setLinkError(t`That address can't be used as a link.`);
      focusField("link-address");
      return;
    }
    if (editor.state.selection.empty) {
      setLinkError(t`Select the text you want to link first.`);
      return;
    }
    setLinkOpen(false);
    c().extendMarkRange("link").setLink({ href: url }).run();
  };

  const groups: Item[][] = [
    [
      {
        id: "undo",
        label: t`Undo`,
        icon: Undo2,
        disabled: !s.canUndo,
        run: () => c().undo().run(),
      },
      {
        id: "redo",
        label: t`Redo`,
        icon: Redo2,
        disabled: !s.canRedo,
        run: () => c().redo().run(),
      },
    ],
    [
      { id: "bold", label: t`Bold`, icon: Bold, active: s.bold, run: () => c().toggleBold().run() },
      {
        id: "italic",
        label: t`Italic`,
        icon: Italic,
        active: s.italic,
        run: () => c().toggleItalic().run(),
      },
      {
        id: "underline",
        label: t`Underline`,
        icon: Underline,
        active: s.underline,
        run: () => c().toggleUnderline().run(),
      },
      {
        id: "smallCaps",
        label: t`Small caps`,
        icon: ALargeSmall,
        active: s.smallCaps,
        run: () => c().toggleMark("smallCaps").run(),
      },
      { id: "link", label: t`Link`, icon: Link, active: s.link, run: setLink },
    ],
    [
      {
        id: "h1",
        label: t`Heading 1`,
        icon: Heading1,
        active: s.h1,
        run: () => c().toggleHeading({ level: 1 }).run(),
      },
      {
        id: "h2",
        label: t`Heading 2`,
        icon: Heading2,
        active: s.h2,
        run: () => c().toggleHeading({ level: 2 }).run(),
      },
      {
        id: "h3",
        label: t`Heading 3`,
        icon: Heading3,
        active: s.h3,
        run: () => c().toggleHeading({ level: 3 }).run(),
      },
    ],
    [
      {
        id: "quote",
        label: t`Block quote`,
        icon: Quote,
        active: s.quote,
        run: () => c().toggleBlockquote().run(),
      },
      {
        id: "bullets",
        label: t`Bulleted list`,
        icon: List,
        active: s.bullets,
        run: () => c().toggleBulletList().run(),
      },
      {
        id: "numbers",
        label: t`Numbered list`,
        icon: ListOrdered,
        active: s.numbers,
        run: () => c().toggleOrderedList().run(),
      },
    ],
    [
      { id: "image", label: t`Image`, icon: ImageIcon, run: () => attempt(addImage()) },
      {
        id: "footnote",
        label: t`Footnote`,
        icon: Superscript,
        run: () =>
          c()
            .insertContent({ type: "footnote", content: [{ type: "text", text: t`Note` }] })
            .run(),
      },
    ],
  ];

  // Less common marks and blocks sit in the More formatting menu at the end of the bar (and in the Format and Insert menus).
  const menuOnly: Item[] = [
    {
      id: "imageDetails",
      label: t`Image details`,
      icon: SquarePen,
      disabled: !s.image,
      run: editImage,
    },
    {
      // Off the bar like Image details: the alignment button is the eighteenth one it could not hold (see docs/architecture.md,
      // "Toolbar overflow menu"). It stays in the Format menu and on the palette.
      id: "sceneBreak",
      label: t`Scene break`,
      icon: Asterisk,
      run: () =>
        c()
          .insertContent([{ type: "sceneBreak" }, { type: "paragraph" }])
          .run(),
    },
    {
      id: "taskList",
      label: t`Task list`,
      icon: ListTodo,
      active: s.taskList,
      run: () =>
        s.taskList
          ? c().liftListItem("taskItem").run()
          : c().toggleList("taskList", "taskItem").run(),
    },
    {
      id: "definitionList",
      label: t`Definition list`,
      icon: List,
      active: s.definitionList,
      run: () => insertDefinitionList(editor),
    },
    {
      id: "strike",
      label: t`Strikethrough`,
      icon: Strikethrough,
      active: s.strike,
      run: () => c().toggleStrike().run(),
    },
    {
      id: "code",
      label: t`Code`,
      icon: Code,
      active: s.code,
      run: () => c().toggleCode().run(),
    },
    {
      id: "superscript",
      label: t`Superscript`,
      icon: Superscript,
      active: s.superscript,
      run: () => c().toggleMark("superscript").run(),
    },
    {
      id: "subscript",
      label: t`Subscript`,
      icon: Subscript,
      active: s.subscript,
      run: () => c().toggleMark("subscript").run(),
    },
    {
      id: "lang",
      label: t`Language of selection…`,
      icon: Languages,
      active: s.lang,
      run: lang.openLang,
    },
    {
      id: "clearLang",
      label: t`Clear language`,
      icon: Languages,
      disabled: !s.lang,
      run: lang.clearLang,
    },
    {
      id: "codeBlock",
      label: t`Code Block`,
      icon: Code2,
      active: s.codeBlock,
      run: () => c().toggleCodeBlock().run(),
    },
  ];

  // Text alignment: the blocks the author aligned say how (start, centre, end); the rest follow the template.
  const alignNow: AlignItem["id"] =
    s.align === "start"
      ? "alignLeft"
      : s.align === "center"
        ? "alignCenter"
        : s.align === "end"
          ? "alignRight"
          : "alignDefault";
  const alignItems: AlignItem[] = [
    {
      id: "alignLeft",
      label: t`Align to Start`,
      icon: AlignLeft,
      combo: null,
      run: () => c().setTextAlign("start").run(),
    },
    {
      id: "alignCenter",
      label: t`Centre`,
      icon: AlignCenter,
      combo: null,
      run: () => c().setTextAlign("center").run(),
    },
    {
      id: "alignRight",
      label: t`Align to End`,
      icon: AlignRight,
      combo: null,
      run: () => c().setTextAlign("end").run(),
    },
    {
      id: "alignDefault",
      label: t`Template Default`,
      icon: Pilcrow,
      combo: null,
      run: () => c().setTextAlign(null).run(),
    },
  ];

  // The same actions as menu commands (Insert and Format), available while the toolbar is shown. Undo and redo stay the system's.
  useRegisterCommands(
    Object.fromEntries([
      ...[...groups.flat(), ...menuOnly]
        .filter((b) => b.id !== "undo" && b.id !== "redo")
        .map((b) => [
          `editor.${b.id}`,
          {
            run: b.run,
            enabled: !b.disabled,
            ...(b.active === undefined ? {} : { checked: b.active }),
          },
        ]),
      ...alignItems.map((b) => [
        `editor.${b.id}`,
        { run: b.run, enabled: true, checked: b.id === alignNow },
      ]),
    ]),
  );

  // One tab stop for the whole toolbar; arrow keys move between the buttons (the WAI-ARIA toolbar pattern).
  const barRef = useRef<HTMLDivElement>(null);
  const [stop, setStop] = useState<string | null>(null);
  const all = groups.flat();
  // The alignment button and the More formatting button are stops of the bar too, and are never disabled.
  const stops = [...all, { id: ALIGN, disabled: false }, { id: MORE, disabled: false }];
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
    more(["lang", "clearLang"]),
    more(["imageDetails", "sceneBreak", "codeBlock", "taskList", "definitionList"]),
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
