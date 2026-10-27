import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import { WandSparkles } from "lucide-react";
import { EditorContent, useEditor, useEditorState, type Editor as TipTapEditor } from "@tiptap/react";
import { looksLikeHtml } from "@cadabracraft/import-docx";
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
import { useProject } from "../app/store";
import { Modal } from "../ui/Dialog";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import { convertHtmlText, literalContent, pasteAction, truncate, type Converted } from "./htmlPaste";

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

/** Tells the author when a conversion left something out. */
function warnNotice(warnings: number) {
  if (warnings > 0) useProject.setState({ notice: plural(warnings, { one: "Converted, with # thing that could not be kept", other: "Converted, with # things that could not be kept" }) });
}

export function Editor({ initial, language, onChange, reading, focus }: Props) {
  const { t } = useLingui();
  // Pasted text that holds HTML tags, waiting for the author's answer in the dialog.
  const [pending, setPending] = useState<{ text: string; converted: Converted; from: number; to: number } | null>(null);
  const [remember, setRemember] = useState(false);
  const askRef = useRef<(text: string, from: number, to: number) => void>(() => {});
  askRef.current = (text, from, to) => { setRemember(false); setPending({ text, converted: convertHtmlText(text), from, to }); };
  const editor = useEditor({
    extensions: reading ? extensions : [...extensions, Search],
    editorProps: {
      attributes: { lang: language, dir: dirFor(language) },
      // Only text/plain that looks like HTML is handled here; a real HTML clipboard keeps ProseMirror's own path.
      handlePaste: reading ? undefined : (view, event) => {
        const data = event.clipboardData;
        if (!data) return false;
        const text = data.getData("text/plain");
        const { $from } = view.state.selection;
        const inCode = $from.parent.type.name === "codeBlock" || view.state.selection.$from.marks().some((m) => m.type.name === "code");
        const action = pasteAction({ text, hasHtml: data.types.includes("text/html"), inCode, pref: useSettings.getState().rawHtmlPaste });
        if (action === "default") return false;
        event.preventDefault();
        const { from, to } = view.state.selection;
        if (action === "ask") { askRef.current(text, from, to); return true; }
        const c = convertHtmlText(text);
        insertRef.current(c.content, { from, to });
        warnNotice(c.warnings);
        return true;
      },
    },
    content: initial,
    editable: !reading,
    onUpdate: ({ editor }) => onChange?.(editor.getJSON() as ChapterDoc),
    onSelectionUpdate: ({ editor }) => { if (!reading && useSettings.getState().typewriterScroll) centerCaret(editor); },
  });
  const { manuscriptFont, writingWidth } = useSettings();
  const findOpen = useFind((s) => s.open);
  const insertRef = useRef<(content: ReturnType<typeof literalContent>, range: { from: number; to: number }) => void>(() => {});
  // Insert at the range the paste happened at: the dialog takes focus, and the editor's selection can move while it is open.
  insertRef.current = (content, { from, to }) => {
    if (!editor || !content.length) return;
    const size = editor.state.doc.content.size;
    editor.chain().focus().insertContentAt({ from: Math.min(from, size), to: Math.min(to, size) }, content).run();
  };
  const hasSelection = useEditorState({ editor, selector: ({ editor: e }) => !!e && !e.state.selection.empty });

  const answer = (convert: boolean) => {
    if (!pending) return;
    if (remember) useSettings.getState().set({ rawHtmlPaste: convert ? "convert" : "text" });
    insertRef.current(convert ? pending.converted.content : literalContent(pending.text), pending);
    if (convert) warnNotice(pending.converted.warnings);
    setPending(null);
  };
  const convertSelection = () => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const text = editor.state.doc.textBetween(from, to, "\n");
    if (!looksLikeHtml(text)) { useProject.setState({ notice: t`No HTML found in the selection` }); return; }
    const c = convertHtmlText(text);
    editor.chain().focus().insertContentAt({ from, to }, c.content).run();
    warnNotice(c.warnings);
  };
  const convertRef = useRef(convertSelection);
  convertRef.current = convertSelection;

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
    "edit.convertHtml": { run: () => convertRef.current(), enabled: hasSelection },
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
      <Modal
        open={pending !== null}
        onOpenChange={(o) => { if (!o) { setPending(null); editor.commands.focus(); } }}
        title={t`Paste as styled text?`}
        description={t`The text you pasted contains HTML tags. CadabraCraft can turn them into real formatting, or keep the tags as plain text.`}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 rounded-md border border-border bg-paper p-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-ink-muted">{t`What you pasted`}</p>
              <p className="mt-1 break-words font-mono text-xs text-ink" data-testid="paste-source">{truncate(pending?.text ?? "")}</p>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-ink-muted">{t`Becomes`}</p>
              <p className="mt-1 break-words text-sm text-ink" data-testid="paste-result">{pending?.converted.preview}</p>
            </div>
          </div>
          <Checkbox label={t`Remember my choice`} hint={t`You can change this later in Settings, Editor.`} checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <div className="flex justify-end gap-2.5">
            <Button onClick={() => answer(false)}>{t`Keep as text`}</Button>
            <Button variant="primary" icon={WandSparkles} onClick={() => answer(true)} autoFocus>{t`Convert`}</Button>
          </div>
        </div>
      </Modal>
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
