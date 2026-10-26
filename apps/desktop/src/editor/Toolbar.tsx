import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { normalizeLinkUrl } from "@cadabracraft/editor-schema";

interface Item {
  label: string;
  text: string;
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

  const setLink = () => {
    if (s.link) { c().extendMarkRange("link").unsetLink().run(); return; }
    const raw = prompt("Link address (http, https or mailto)");
    if (raw === null) return;
    const href = normalizeLinkUrl(raw);
    if (!href) { alert("That address can't be used as a link."); return; }
    c().extendMarkRange("link").setLink({ href }).run();
  };

  const groups: Item[][] = [
    [
      { label: "Undo", text: "↶", disabled: !s.canUndo, run: () => c().undo().run() },
      { label: "Redo", text: "↷", disabled: !s.canRedo, run: () => c().redo().run() },
    ],
    [
      { label: "Bold", text: "B", active: s.bold, run: () => c().toggleBold().run() },
      { label: "Italic", text: "I", active: s.italic, run: () => c().toggleItalic().run() },
      { label: "Underline", text: "U", active: s.underline, run: () => c().toggleUnderline().run() },
      { label: "Small caps", text: "Sc", active: s.smallCaps, run: () => c().toggleMark("smallCaps").run() },
      { label: "Link", text: "🔗", active: s.link, run: setLink },
    ],
    [
      { label: "Heading 1", text: "H1", active: s.h1, run: () => c().toggleHeading({ level: 1 }).run() },
      { label: "Heading 2", text: "H2", active: s.h2, run: () => c().toggleHeading({ level: 2 }).run() },
      { label: "Heading 3", text: "H3", active: s.h3, run: () => c().toggleHeading({ level: 3 }).run() },
    ],
    [
      { label: "Block quote", text: "❝", active: s.quote, run: () => c().toggleBlockquote().run() },
      { label: "Bulleted list", text: "• List", active: s.bullets, run: () => c().toggleBulletList().run() },
      { label: "Numbered list", text: "1. List", active: s.numbers, run: () => c().toggleOrderedList().run() },
    ],
    [
      { label: "Scene break", text: "***", run: () => c().insertContent([{ type: "sceneBreak" }, { type: "paragraph" }]).run() /* trailing paragraph keeps the cursor out of the break */ },
      { label: "Footnote", text: "Fn", run: () => c().insertContent({ type: "footnote", content: [{ type: "text", text: "Note" }] }).run() },
    ],
  ];

  return (
    <div role="toolbar" aria-label="Formatting" style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12, fontFamily: "sans-serif" }}>
      {groups.map((g, i) => (
        <div key={i} role="group" style={{ display: "flex", gap: 2 }}>
          {g.map((b) => (
            <button key={b.label} type="button" aria-label={b.label} title={b.label} aria-pressed={b.active ?? undefined} disabled={b.disabled}
              onMouseDown={(e) => e.preventDefault() /* keep the editor selection */} onClick={b.run}
              style={{ fontWeight: b.active ? 700 : 400, background: b.active ? "#e4e0f7" : undefined }}>
              {b.text}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
