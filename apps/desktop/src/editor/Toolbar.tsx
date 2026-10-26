import { useState } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { ALargeSmall, Asterisk, Bold, Heading1, Heading2, Heading3, Italic, Link, List, ListOrdered, Quote, Redo2, Superscript, Underline, Undo2, type LucideIcon } from "lucide-react";
import { normalizeLinkUrl } from "@cadabracraft/editor-schema";
import { Button, IconButton } from "../ui/Button";
import { Modal } from "../ui/Dialog";
import { Field } from "../ui/Input";

interface Item {
  label: string;
  icon: LucideIcon;
  active?: boolean;
  disabled?: boolean;
  run: () => void;
}

export function Toolbar({ editor }: { editor: Editor }) {
  // Re-render only when the toolbar-relevant state changes.
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"), italic: e.isActive("italic"), underline: e.isActive("underline"),
      smallCaps: e.isActive("smallCaps"), link: e.isActive("link"),
      h1: e.isActive("heading", { level: 1 }), h2: e.isActive("heading", { level: 2 }), h3: e.isActive("heading", { level: 3 }),
      quote: e.isActive("blockquote"), bullets: e.isActive("bulletList"), numbers: e.isActive("orderedList"),
      canUndo: e.can().undo(), canRedo: e.can().redo(),
    }),
  });
  const c = () => editor.chain().focus();
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState("");
  const [linkError, setLinkError] = useState("");

  const setLink = () => {
    if (s.link) { c().extendMarkRange("link").unsetLink().run(); return; }
    setHref("");
    setLinkError("");
    setLinkOpen(true);
  };
  const applyLink = () => {
    const url = normalizeLinkUrl(href);
    if (!url) { setLinkError("That address can't be used as a link."); return; }
    setLinkOpen(false);
    c().extendMarkRange("link").setLink({ href: url }).run();
  };

  const groups: Item[][] = [
    [
      { label: "Undo", icon: Undo2, disabled: !s.canUndo, run: () => c().undo().run() },
      { label: "Redo", icon: Redo2, disabled: !s.canRedo, run: () => c().redo().run() },
    ],
    [
      { label: "Bold", icon: Bold, active: s.bold, run: () => c().toggleBold().run() },
      { label: "Italic", icon: Italic, active: s.italic, run: () => c().toggleItalic().run() },
      { label: "Underline", icon: Underline, active: s.underline, run: () => c().toggleUnderline().run() },
      { label: "Small caps", icon: ALargeSmall, active: s.smallCaps, run: () => c().toggleMark("smallCaps").run() },
      { label: "Link", icon: Link, active: s.link, run: setLink },
    ],
    [
      { label: "Heading 1", icon: Heading1, active: s.h1, run: () => c().toggleHeading({ level: 1 }).run() },
      { label: "Heading 2", icon: Heading2, active: s.h2, run: () => c().toggleHeading({ level: 2 }).run() },
      { label: "Heading 3", icon: Heading3, active: s.h3, run: () => c().toggleHeading({ level: 3 }).run() },
    ],
    [
      { label: "Block quote", icon: Quote, active: s.quote, run: () => c().toggleBlockquote().run() },
      { label: "Bulleted list", icon: List, active: s.bullets, run: () => c().toggleBulletList().run() },
      { label: "Numbered list", icon: ListOrdered, active: s.numbers, run: () => c().toggleOrderedList().run() },
    ],
    [
      { label: "Scene break", icon: Asterisk, run: () => c().insertContent([{ type: "sceneBreak" }, { type: "paragraph" }]).run() },
      { label: "Footnote", icon: Superscript, run: () => c().insertContent({ type: "footnote", content: [{ type: "text", text: "Note" }] }).run() },
    ],
  ];

  return (
    <>
      <div
        role="toolbar"
        aria-label="Formatting"
        className="flex shrink-0 items-center gap-1 overflow-x-auto border-border bg-surface px-2 py-1.5 max-md:border-t md:flex-wrap md:justify-center md:border-b md:px-4"
      >
        {groups.map((g, i) => (
          <div key={i} role="group" className="flex shrink-0 items-center gap-0.5 [&:not(:first-child)]:border-l [&:not(:first-child)]:border-border [&:not(:first-child)]:pl-1.5 [&:not(:last-child)]:pr-0.5">
            {g.map((b) => (
              <IconButton
                key={b.label}
                icon={b.icon}
                label={b.label}
                active={b.active ?? undefined}
                disabled={b.disabled}
                onMouseDown={(e) => e.preventDefault() /* keep the editor selection */}
                onClick={b.run}
              />
            ))}
          </div>
        ))}
      </div>
      <Modal open={linkOpen} onOpenChange={setLinkOpen} title="Add link">
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); applyLink(); }}>
          <Field label="Address" value={href} onChange={(e) => { setHref(e.target.value); setLinkError(""); }} hint="Use http, https or mailto." autoFocus />
          {linkError && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{linkError}</p>}
          <div className="flex justify-end gap-2.5">
            <Button onClick={() => setLinkOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary">Apply</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
