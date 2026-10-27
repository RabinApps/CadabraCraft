import { useEffect, useRef, type CSSProperties } from "react";
import { EditorContent, useEditor, type Editor as TipTapEditor } from "@tiptap/react";
import { extensions } from "@cadabracraft/editor-schema";
import type { ChapterDoc } from "@cadabracraft/shared";
import { sizes, widths, type Width } from "../app/reading";
import { manuscriptFonts, useSettings, writingWidths } from "../app/editorPrefs";
import { dirFor } from "../i18n/locales";
import { Toolbar } from "./Toolbar";
import { Search } from "./search/plugin";
import { FindBar } from "./FindBar";
import { prefillQuery } from "./findHelpers";
import { useFind } from "./findStore";
import { modalOpen, useRegisterCommands } from "../app/commands";

/** Typewriter scrolling: keeps the caret line near the middle of the scrolling column. */
function centerCaret(editor: TipTapEditor) {
  const scroller = editor.view.dom.closest<HTMLElement>(".overflow-y-auto");
  if (!scroller) return;
  const caret = editor.view.coordsAtPos(editor.state.selection.from);
  const box = scroller.getBoundingClientRect();
  scroller.scrollTop += caret.top - (box.top + box.height / 2);
}

interface Props {
  initial: ChapterDoc;
  /** BCP 47 tag from `manifest.language`; sets spellcheck language and base direction. */
  language: string;
  onChange?: (doc: ChapterDoc) => void;
  /** Read-only reading mode: no toolbar, larger type, no page card. */
  reading?: { size: number; width: Width };
  /** Focus mode: hide the formatting toolbar (shortcuts still work). */
  focus?: boolean;
}

export function Editor({ initial, language, onChange, reading, focus }: Props) {
  const editor = useEditor({
    extensions: reading ? extensions : [...extensions, Search],
    editorProps: { attributes: { lang: language, dir: dirFor(language) } },
    content: initial,
    editable: !reading,
    onUpdate: ({ editor }) => onChange?.(editor.getJSON() as ChapterDoc),
    onSelectionUpdate: ({ editor }) => { if (!reading && useSettings.getState().typewriterScroll) centerCaret(editor); },
  });
  const { manuscriptFont, writingWidth } = useSettings();
  const findOpen = useFind((s) => s.open);

  // Find is Write mode only: the Search extension is not loaded for reading. The shortcut works in focus mode too (the
  // bar then sits below the exit button). The native menu owns the accelerators; the keydown listener covers the browser
  // and any platform where the key also reaches the page, so a second call within a few ms is ignored.
  const lastInvoke = useRef(0);
  const invoke = (mode: "find" | "replace" | "toggle") => {
    if (!editor || reading || modalOpen() || Date.now() - lastInvoke.current < 80) return;
    lastInvoke.current = Date.now();
    const { from, to } = editor.state.selection;
    const query = editor.isFocused ? prefillQuery(editor.state.doc.textBetween(from, to, "\n")) : null;
    const find = useFind.getState();
    if (mode === "toggle") find.toggleReplace(query);
    else find.show({ query, ...(mode === "replace" ? { replace: true } : {}) });
  };
  const invokeRef = useRef(invoke);
  invokeRef.current = invoke;
  useEffect(() => {
    if (reading) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.code !== "KeyF") return;
      e.preventDefault();
      invokeRef.current(e.altKey ? "toggle" : "find");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reading]);
  useRegisterCommands(reading ? {} : {
    "edit.find": { run: () => invokeRef.current("find") },
    "edit.findReplace": { run: () => invokeRef.current("replace") },
  });
  if (!editor) return null;
  if (reading) {
    const style = { "--reading-size": `${sizes[reading.size]}rem`, maxWidth: widths[reading.width] } as CSSProperties;
    return (
      <div className="min-h-0 flex-1 overflow-y-auto bg-paper">
        <div className="prose-manuscript prose-reading mx-auto px-6 py-8 md:py-14" style={style}>
          <EditorContent editor={editor} />
        </div>
      </div>
    );
  }
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {findOpen && <FindBar editor={editor} focusMode={focus} />}
      {!focus && <Toolbar editor={editor} />}
      <div className="min-h-0 flex-1 overflow-y-auto max-md:order-first">
        <div className="mx-auto md:p-8" style={{ maxWidth: writingWidths[writingWidth] }}>
          <div className="prose-manuscript p-4 md:rounded-md md:border md:border-border md:bg-paper md:px-14 md:py-12" style={{ fontFamily: manuscriptFonts[manuscriptFont] }}>
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>
    </div>
  );
}
