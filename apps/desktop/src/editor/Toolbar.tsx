import { useState } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { useLingui } from "@lingui/react/macro";
import { ALargeSmall, Asterisk, Bold, Heading1, Heading2, Heading3, Image as ImageIcon, Italic, Link, List, ListOrdered, Quote, Redo2, Superscript, Underline, Undo2, type LucideIcon } from "lucide-react";
import { normalizeLinkUrl } from "@cadabracraft/editor-schema";
import { Button, IconButton } from "../ui/Button";
import { Modal } from "../ui/Dialog";
import { Field } from "../ui/Input";
import { useProject } from "../app/store";

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

  const [image, setImage] = useState<{ src: string; alt: string; caption: string } | null>(null);
  const importImage = useProject((p) => p.actions.importImage);
  const addImage = async () => {
    const src = await importImage();
    if (src) setImage({ src, alt: "", caption: "" });
  };
  const applyImage = () => {
    if (!image) return;
    c().insertContent({ type: "image", attrs: { src: image.src, alt: image.alt.trim(), title: image.caption.trim() || null } }).run();
    setImage(null);
  };

  const setLink = () => {
    if (s.link) { c().extendMarkRange("link").unsetLink().run(); return; }
    setHref("");
    setLinkError("");
    setLinkOpen(true);
  };
  const applyLink = () => {
    const url = normalizeLinkUrl(href);
    if (!url) { setLinkError(t`That address can't be used as a link.`); return; }
    if (editor.state.selection.empty) { setLinkError(t`Select the text you want to link first.`); return; }
    setLinkOpen(false);
    c().extendMarkRange("link").setLink({ href: url }).run();
  };

  const groups: Item[][] = [
    [
      { id: "undo", label: t`Undo`, icon: Undo2, disabled: !s.canUndo, run: () => c().undo().run() },
      { id: "redo", label: t`Redo`, icon: Redo2, disabled: !s.canRedo, run: () => c().redo().run() },
    ],
    [
      { id: "bold", label: t`Bold`, icon: Bold, active: s.bold, run: () => c().toggleBold().run() },
      { id: "italic", label: t`Italic`, icon: Italic, active: s.italic, run: () => c().toggleItalic().run() },
      { id: "underline", label: t`Underline`, icon: Underline, active: s.underline, run: () => c().toggleUnderline().run() },
      { id: "smallCaps", label: t`Small caps`, icon: ALargeSmall, active: s.smallCaps, run: () => c().toggleMark("smallCaps").run() },
      { id: "link", label: t`Link`, icon: Link, active: s.link, run: setLink },
    ],
    [
      { id: "h1", label: t`Heading 1`, icon: Heading1, active: s.h1, run: () => c().toggleHeading({ level: 1 }).run() },
      { id: "h2", label: t`Heading 2`, icon: Heading2, active: s.h2, run: () => c().toggleHeading({ level: 2 }).run() },
      { id: "h3", label: t`Heading 3`, icon: Heading3, active: s.h3, run: () => c().toggleHeading({ level: 3 }).run() },
    ],
    [
      { id: "quote", label: t`Block quote`, icon: Quote, active: s.quote, run: () => c().toggleBlockquote().run() },
      { id: "bullets", label: t`Bulleted list`, icon: List, active: s.bullets, run: () => c().toggleBulletList().run() },
      { id: "numbers", label: t`Numbered list`, icon: ListOrdered, active: s.numbers, run: () => c().toggleOrderedList().run() },
    ],
    [
      { id: "sceneBreak", label: t`Scene break`, icon: Asterisk, run: () => c().insertContent([{ type: "sceneBreak" }, { type: "paragraph" }]).run() },
      { id: "image", label: t`Image`, icon: ImageIcon, run: () => void addImage() },
      { id: "footnote", label: t`Footnote`, icon: Superscript, run: () => c().insertContent({ type: "footnote", content: [{ type: "text", text: t`Note` }] }).run() },
    ],
  ];

  return (
    <>
      <div
        role="toolbar"
        aria-label={t`Formatting`}
        className="flex shrink-0 items-center gap-1 overflow-x-auto border-border bg-surface px-2 py-1.5 max-md:border-t md:flex-wrap md:justify-center md:border-b md:px-4"
      >
        {groups.map((g, i) => (
          <div key={i} role="group" className="flex shrink-0 items-center gap-0.5 [&:not(:first-child)]:border-s [&:not(:first-child)]:border-border [&:not(:first-child)]:ps-1.5 [&:not(:last-child)]:pe-0.5">
            {g.map((b) => (
              <IconButton
                key={b.id}
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
      <Modal open={image !== null} onOpenChange={(o) => !o && setImage(null)} title={t`Add image`}>
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); applyImage(); }}>
          <Field label={t`Image file`} value={image?.src ?? ""} readOnly />
          <Field label={t`Description (alt text)`} value={image?.alt ?? ""} onChange={(e) => setImage((i) => i && { ...i, alt: e.target.value })} hint={t`Read aloud by screen readers. Leave empty only for decoration.`} autoFocus />
          <Field label={t`Caption`} value={image?.caption ?? ""} onChange={(e) => setImage((i) => i && { ...i, caption: e.target.value })} hint={t`Optional. Shown below the image.`} />
          <div className="flex justify-end gap-2.5">
            <Button onClick={() => setImage(null)}>{t`Cancel`}</Button>
            <Button type="submit" variant="primary">{t`Insert`}</Button>
          </div>
        </form>
      </Modal>
      <Modal open={linkOpen} onOpenChange={setLinkOpen} title={t`Add link`}>
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); applyLink(); }}>
          <Field label={t`Address`} value={href} onChange={(e) => { setHref(e.target.value); setLinkError(""); }} hint={t`Use http, https or mailto.`} autoFocus />
          {linkError && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{linkError}</p>}
          <div className="flex justify-end gap-2.5">
            <Button onClick={() => setLinkOpen(false)}>{t`Cancel`}</Button>
            <Button type="submit" variant="primary">{t`Apply`}</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
