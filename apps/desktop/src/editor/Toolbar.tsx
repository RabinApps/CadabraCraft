import { useRef, useState, type KeyboardEvent } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { useLingui } from "@lingui/react/macro";
import {
  ALargeSmall,
  Asterisk,
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  SquarePen,
  Italic,
  Link,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Superscript,
  Underline,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { normalizeLinkUrl } from "@cadabracraft/editor-schema";
import { IconButton } from "../ui/Button";
import { useRegisterCommands } from "../state/commands";
import { attempt } from "../state/attempt";
import { TableCommands } from "./TableCommands";
import { ImageDialog, LinkDialog } from "./ToolbarDialogs";
import { useImageDialog } from "./useImageDialog";

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
      h1: e.isActive("heading", { level: 1 }),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      quote: e.isActive("blockquote"),
      bullets: e.isActive("bulletList"),
      numbers: e.isActive("orderedList"),
      taskList: e.isActive("taskList"),
      definitionList: e.isActive("definitionList"),
      image: e.isActive("image"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const c = () => editor.chain().focus();
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState("");
  const [linkError, setLinkError] = useState("");

  const { image, setImage, addImage, editImage, applyImage } = useImageDialog(editor, c);

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
      {
        id: "sceneBreak",
        label: t`Scene break`,
        icon: Asterisk,
        run: () =>
          c()
            .insertContent([{ type: "sceneBreak" }, { type: "paragraph" }])
            .run(),
      },
      { id: "image", label: t`Image`, icon: ImageIcon, run: () => attempt(addImage()) },
      {
        id: "imageDetails",
        label: t`Image details`,
        icon: SquarePen,
        disabled: !s.image,
        run: editImage,
      },
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

  // Less common marks live in the Format menu (and Code Block in Insert) only, to keep the toolbar short.
  const menuOnly: Item[] = [
    {
      id: "taskList",
      label: t`Task list`,
      icon: List,
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
      run: () => {
        const ran = c()
          .insertContent({
            type: "definitionList",
            content: [
              { type: "definitionTerm" },
              { type: "definitionDescription", content: [{ type: "paragraph" }] },
            ],
          })
          .run();
        // The caret lands after the inserted node; put it in the empty term nearest to it so typing fills the term first.
        const { doc, selection } = editor.state;
        let term = -1;
        doc.descendants((n, pos) => {
          if (n.type.name === "definitionTerm" && n.content.size === 0)
            if (term < 0 || Math.abs(pos - selection.head) < Math.abs(term - selection.head))
              term = pos + 1;
        });
        if (term >= 0) c().setTextSelection(term).run();
        return ran;
      },
    },
    {
      id: "strike",
      label: t`Strikethrough`,
      icon: Underline,
      active: s.strike,
      run: () => c().toggleStrike().run(),
    },
    {
      id: "code",
      label: t`Code`,
      icon: Underline,
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
      icon: Superscript,
      active: s.subscript,
      run: () => c().toggleMark("subscript").run(),
    },
    {
      id: "codeBlock",
      label: t`Code Block`,
      icon: Code,
      active: s.codeBlock,
      run: () => c().toggleCodeBlock().run(),
    },
  ];

  // The same actions as menu commands (Insert and Format), available while the toolbar is shown. Undo and redo stay the system's.
  useRegisterCommands(
    Object.fromEntries(
      [...groups.flat(), ...menuOnly]
        .filter((b) => b.id !== "undo" && b.id !== "redo")
        .map((b) => [
          `editor.${b.id}`,
          {
            run: b.run,
            enabled: !b.disabled,
            ...(b.active === undefined ? {} : { checked: b.active }),
          },
        ]),
    ),
  );

  // One tab stop for the whole toolbar; arrow keys move between the buttons (the WAI-ARIA toolbar pattern).
  const barRef = useRef<HTMLDivElement>(null);
  const [stop, setStop] = useState<string | null>(null);
  const all = groups.flat();
  const stopId = (all.find((b) => b.id === stop && !b.disabled) ?? all.find((b) => !b.disabled))
    ?.id;
  const onBarKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const bar = barRef.current;
    if (!bar) return;
    const buttons = Array.from(bar.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const rtl = getComputedStyle(bar).direction === "rtl";
    const to =
      e.key === "ArrowRight"
        ? at + (rtl ? -1 : 1)
        : e.key === "ArrowLeft"
          ? at + (rtl ? 1 : -1)
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? buttons.length - 1
              : null;
    if (to === null) return;
    e.preventDefault();
    buttons[(to + buttons.length) % buttons.length]?.focus();
  };

  return (
    <>
      <div
        ref={barRef}
        role="toolbar"
        aria-label={t`Formatting`}
        onKeyDown={onBarKeyDown}
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
          </div>
        ))}
      </div>
      <ImageDialog
        image={image}
        setImage={(next) => {
          setImage(next);
          if (next === null) editor.commands.focus();
        }}
        onInsert={applyImage}
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
