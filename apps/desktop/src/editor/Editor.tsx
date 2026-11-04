import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import { WandSparkles } from "lucide-react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { chapterJson, extensions, shortcutRemap } from "@cadabracraft/editor-schema";
import { editorRemap, pressed } from "../app/settings/shortcutBindings";
import type { ChapterDoc } from "@cadabracraft/shared";
import { useSettings } from "../state/editorPrefs";
import { dirFor } from "../i18n/locales";
import { Toolbar } from "./Toolbar";
import { Search } from "./search/plugin";
import { Pagination } from "./pagination/plugin";
import { PageFrame, ReflowFrame } from "./PageFrame";
import { KEY_WINDOW_MS, followCaret } from "./typewriter";
import { TabKey } from "./tabKey";
import { FootnoteA11y } from "./footnoteA11y";
import { cleanPastedHtml, cleanPastedText } from "./pasteClean";
import { usePageView } from "../app/hooks/usePageView";
import { FindBar } from "./FindBar";
import { prefillQuery } from "../lib/search/findHelpers";
import { useFind } from "./findStore";
import { registerHeadingJump } from "./headingJump";
import { docLeaves, wordOffset, wordsFrom } from "./pagination/exact";
import { alignWord } from "../lib/pageWords";
import { takePreviewJump } from "../state/previewJump";
import { modalOpen, useRegisterCommands } from "../state/commands";
import { useProject } from "../state/project/index";
import { Modal } from "../ui/Dialog";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import {
  MAX_HTML_CHARS,
  crossesCells,
  insertConverted,
  literalContent,
  pasteAction,
  safeLooksLikeHtml,
  truncate,
  tryConvertHtmlText,
  type Converted,
} from "./htmlPaste";

interface Props {
  initial: ChapterDoc;
  /** BCP 47 tag from `manifest.language`; sets spellcheck language and base direction. */
  language: string;
  onChange?: (doc: ChapterDoc) => void;
  /** Focus mode: hide the formatting toolbar (shortcuts still work). */
  focus?: boolean;
  /** The page holds no text (a blank page the author added): its page is drawn, but nothing can be typed into it. */
  readOnly?: boolean;
}

/** Tells the author when a conversion left something out. */
function warnNotice(warnings: number) {
  if (warnings > 0)
    useProject.setState({
      notice: plural(warnings, {
        one: "Converted, with # thing that could not be kept",
        other: "Converted, with # things that could not be kept",
      }),
    });
}

export function Editor({ initial, language, onChange, focus, readOnly }: Props) {
  const { t } = useLingui();
  // Pasted text that holds HTML tags, waiting for the author's answer in the dialog.
  const [pending, setPending] = useState<{
    text: string;
    converted: Converted;
    from: number;
    to: number;
  } | null>(null);
  const [remember, setRemember] = useState(false);
  // Set the moment a paste opens the dialog (before React re-renders), so a quick second paste is ignored.
  const askingRef = useRef(false);
  /** When a key last went down in the editor (typewriter scrolling follows the caret only for keys). */
  const lastKeyAt = useRef(0);
  const askRef = useRef<(text: string, converted: Converted, from: number, to: number) => void>(
    () => {},
  );
  askRef.current = (text, converted, from, to) => {
    askingRef.current = true;
    setRemember(false);
    setPending({ text, converted, from, to });
  };
  const editor = useEditor({
    editable: !readOnly,
    // Keys the author moved in Settings > Shortcuts are read when the editor is made (the settings page replaces the editor).
    extensions: [
      ...extensions,
      Search,
      Pagination,
      TabKey,
      FootnoteA11y((n) => t`Footnote ${n}`),
      shortcutRemap(editorRemap(useSettings.getState().shortcutOverrides)),
    ],
    editorProps: {
      // A task item's checkbox lives in a non-editable label; clicking it flips `checked` (one undo step).
      handleDOMEvents: {
        keydown: () => {
          lastKeyAt.current = Date.now();
          return false;
        },
        // Committing IME text counts as typing: the line settles once the composition ends.
        compositionend: () => {
          lastKeyAt.current = Date.now();
          return false;
        },
        mousedown: (view, event) => {
          const label = (event.target as HTMLElement | null)?.closest?.(
            'li[data-type="taskItem"] > label',
          );
          if (!label || !view.editable) return false;
          event.preventDefault();
          const at = view.posAtDOM(label, 0);
          const $pos = view.state.doc.resolve(at);
          const node = $pos.parent;
          if (node.type.name !== "taskItem") return true;
          view.dispatch(
            view.state.tr.setNodeMarkup($pos.before(), undefined, {
              ...node.attrs,
              checked: !node.attrs.checked,
            }),
          );
          return true;
        },
      },
      // A textbox that holds many paragraphs: screen readers need `aria-multiline` to read it as one (Enter makes a new paragraph).
      attributes: {
        lang: language,
        dir: dirFor(language),
        "aria-label": t`Page text`,
        "aria-multiline": "true",
      },
      // Pasted text and HTML lose what no export can carry (control characters) and pictures from outside the book.
      transformPastedText: (text) => cleanPastedText(text),
      transformPastedHTML: (html) => {
        const r = cleanPastedHtml(html);
        if (r.droppedImages > 0)
          useProject.setState({
            notice: t`Pasted pictures were left out. Use Insert, Image to add a picture to the book.`,
          });
        return r.html;
      },
      // Only text/plain that looks like HTML is handled here; a real HTML clipboard keeps ProseMirror's own path.
      // Nothing in here may throw or block: on any failure the default paste runs.
      handlePaste: (view, event) => {
        try {
          const data = event.clipboardData;
          if (!data) return false;
          // The dialog is open: swallow the paste instead of stacking a second one or typing behind the dialog.
          if (askingRef.current) {
            event.preventDefault();
            return true;
          }
          const text = data.getData("text/plain");
          const { $from } = view.state.selection;
          const inCode =
            $from.parent.type.name === "codeBlock" ||
            $from.marks().some((m) => m.type.name === "code");
          const action = pasteAction({
            text,
            hasHtml: data.types.includes("text/html"),
            inCode,
            pref: useSettings.getState().rawHtmlPaste,
          });
          // Another dialog is open: never open a second one.
          if (action === "default" || (action === "ask" && modalOpen())) return false;
          const { from, to } = view.state.selection;
          if (crossesCells(view.state, from, to)) return false;
          const c = tryConvertHtmlText(text);
          if (!c) {
            useProject.setState({
              notice: t`Could not convert the HTML, so it was pasted as text`,
            });
            return false;
          }
          event.preventDefault();
          if (action === "ask") {
            askRef.current(text, c, from, to);
            return true;
          }
          if (!insertRef.current(c.content, { from, to })) return false;
          warnNotice(c.warnings);
          return true;
        } catch {
          return false;
        }
      },
    },
    content: initial,
    onUpdate: ({ editor }) => onChange?.(chapterJson(editor)),
    onSelectionUpdate: ({ editor }) => {
      // Only a caret moved by typing or the keys is followed: a click, a find or an outline jump already chose where to look.
      if (useSettings.getState().typewriterScroll && Date.now() - lastKeyAt.current < KEY_WINDOW_MS)
        followCaret(editor);
    },
  });
  const pageView = usePageView();
  const findOpen = useFind((s) => s.open);
  const insertRef = useRef<
    (content: ReturnType<typeof literalContent>, range: { from: number; to: number }) => boolean
  >(() => false);
  // Insert at the range the paste happened at: the dialog takes focus, and the editor's selection can move while it is open.
  // One transaction (one undo step), checked against the schema; returns false when nothing was inserted.
  insertRef.current = (content, range) => {
    if (!editor || editor.isDestroyed || !content.length) return false;
    try {
      const tr = insertConverted(editor.state, content, range);
      if (!tr) return false;
      editor.view.dispatch(tr.scrollIntoView());
      editor.commands.focus(); // deferred, so it lands after a closing dialog gives focus back
      return true;
    } catch {
      return false;
    }
  };
  const hasSelection = useEditorState({
    editor,
    selector: ({ editor: e }) => !!e && !e.state.selection.empty,
  });

  const close = () => {
    askingRef.current = false;
    setPending(null);
  };
  const answer = (convert: boolean) => {
    if (!pending) return;
    const done = insertRef.current(
      convert ? pending.converted.content : literalContent(pending.text),
      pending,
    );
    // The choice is remembered only when the author confirms and it was applied.
    if (remember) useSettings.getState().set({ rawHtmlPaste: convert ? "convert" : "text" });
    if (done && convert) warnNotice(pending.converted.warnings);
    if (!done)
      useProject.setState({
        notice: t`Nothing was pasted here. Select text inside one paragraph or cell and try again`,
      });
    close();
  };
  const convertSelection = () => {
    if (!editor || editor.isDestroyed) return;
    const { from, to } = editor.state.selection;
    if (to - from > MAX_HTML_CHARS) {
      useProject.setState({ notice: t`The selection is too large to convert` });
      return;
    }
    const text = editor.state.doc.textBetween(from, to, "\n");
    if (!safeLooksLikeHtml(text)) {
      useProject.setState({ notice: t`No HTML found in the selection` });
      return;
    }
    if (crossesCells(editor.state, from, to)) {
      useProject.setState({ notice: t`Select text inside one cell or paragraph to convert it` });
      return;
    }
    const c = tryConvertHtmlText(text);
    if (!c) {
      useProject.setState({ notice: t`Could not convert the HTML in the selection` });
      return;
    }
    if (!insertRef.current(c.content, { from, to })) {
      useProject.setState({ notice: t`Could not convert the HTML in the selection` });
      return;
    }
    warnNotice(c.warnings);
  };
  const convertRef = useRef(convertSelection);
  convertRef.current = convertSelection;

  // Find is Write mode only (Read mode has none). The shortcut works in focus mode too (the
  // bar then sits below the exit button). The native menu owns the accelerators; the keydown listener covers the browser
  // and any platform where the key also reaches the page, so a second call within a few ms is ignored.
  const lastInvoke = useRef(0);
  const invoke = (mode: "find" | "replace" | "toggle") => {
    if (!editor || modalOpen() || Date.now() - lastInvoke.current < 80) return;
    lastInvoke.current = Date.now();
    const { from, to } = editor.state.selection;
    const query = editor.isFocused
      ? prefillQuery(editor.state.doc.textBetween(from, to, "\n"))
      : null;
    const find = useFind.getState();
    if (mode === "toggle") find.toggleReplace(query);
    else find.show({ query, ...(mode === "replace" ? { replace: true } : {}) });
  };
  const invokeRef = useRef(invoke);
  invokeRef.current = invoke;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const toggle = pressed(e, "edit.findReplace");
      if (!toggle && !pressed(e, "edit.find")) return;
      e.preventDefault();
      invokeRef.current(toggle ? "toggle" : "find");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useRegisterCommands({
    "edit.find": { run: () => invokeRef.current("find") },
    "edit.findReplace": { run: () => invokeRef.current("replace") },
    "edit.convertHtml": { run: () => convertRef.current(), enabled: hasSelection },
  });
  // The outline navigator moves the caret to a heading by its number among the chapter's headings.
  useEffect(() => {
    if (!editor) return;
    return registerHeadingJump((index) => {
      if (editor.isDestroyed) return false;
      let seen = 0;
      let target = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "heading" && seen++ === index) target = pos;
        return target < 0;
      });
      if (target < 0) return false;
      editor
        .chain()
        .focus()
        .setTextSelection(target + 1)
        .run();
      (editor.view.nodeDOM(target) as HTMLElement | null)?.scrollIntoView({ block: "start" });
      return true;
    });
  }, [editor]);
  // The print preview opened this chapter at a page: put the caret on the text that starts it.
  const currentId = useProject((s) => s.currentId);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const jump = takePreviewJump(currentId);
    if (!jump) return;
    const doc = editor.state.doc;
    const leaves = docLeaves(doc)[jump.block];
    // The report counts the leaves of a block without the blank paragraphs the exporter skips.
    const leaf = leaves?.filter((l) => !l.blank)[jump.leaf] ?? leaves?.[0];
    if (!leaf) return;
    const inside = jump.word === null ? null : wordOffset(leaf.node, jump.word);
    let at = leaf.pos + 1 + (inside ?? 0) + (jump.char ?? 0);
    // A click on a word of the page: the word of the text that is under it, found by walking the page's words and the text's together.
    if (jump.click) {
      const words = wordsFrom(doc, at, jump.click.tokens.length + 40);
      const hit = alignWord(
        jump.click.tokens,
        jump.click.index,
        words.map((w) => w.text),
      );
      if (hit !== null) at = words[hit]!.pos;
    }
    editor.chain().focus().setTextSelection(Math.min(at, doc.content.size)).scrollIntoView().run();
  }, [editor, currentId]);
  // The page surface and the phone's reflow are different components, so crossing the breakpoint moves the editor's DOM: the browser
  // drops the focus and the selection with it. Whether the editor had the focus is read in the render that switches (the DOM has not
  // moved yet), and the focus and selection are put back once it has.
  const surface = pageView.on;
  const lastSurface = useRef(surface);
  const refocus = useRef(false);
  if (lastSurface.current !== surface) {
    lastSurface.current = surface;
    refocus.current = !!editor && !editor.isDestroyed && editor.view.hasFocus();
  }
  useLayoutEffect(() => {
    if (!refocus.current || !editor || editor.isDestroyed) return;
    refocus.current = false;
    editor.view.focus();
  }, [editor, surface]);
  if (!editor) return null;
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {findOpen && <FindBar editor={editor} focusMode={focus} />}
      {!focus && <Toolbar editor={editor} />}
      <Modal
        open={pending !== null}
        onOpenChange={() => {
          close();
          editor.commands.focus();
        }}
        title={t`Paste as styled text?`}
        description={t`The text you pasted contains HTML tags. CadabraCraft can turn them into real formatting, or keep the tags as plain text.`}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 rounded-md border border-border bg-paper p-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-ink-muted">{t`What you pasted`}</p>
              <p className="mt-1 break-words font-mono text-xs text-ink" data-testid="paste-source">
                {truncate(pending?.text ?? "")}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-ink-muted">{t`Becomes`}</p>
              <p className="mt-1 break-words text-sm text-ink" data-testid="paste-result">
                {pending?.converted.preview}
              </p>
            </div>
          </div>
          <Checkbox
            label={t`Remember my choice`}
            hint={t`You can change this later in Settings, Editor.`}
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          <div className="flex justify-end gap-2.5">
            <Button onClick={() => answer(false)}>{t`Keep as text`}</Button>
            <Button
              variant="primary"
              icon={WandSparkles}
              onClick={() => answer(true)}
              autoFocus
            >{t`Convert`}</Button>
          </div>
        </div>
      </Modal>
      {pageView.on ? (
        <PageFrame editor={editor}>
          <EditorContent editor={editor} />
        </PageFrame>
      ) : (
        <ReflowFrame>
          <EditorContent editor={editor} />
        </ReflowFrame>
      )}
    </div>
  );
}
