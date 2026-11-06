import { useRef, useState, type MutableRefObject } from "react";
import { plural, t } from "@lingui/core/macro";
import type { Editor } from "@tiptap/react";
import type { EditorView } from "@tiptap/pm/view";
import { useSettings } from "../../state/view/editorPrefs";
import { modalOpen } from "../../state/app/commands";
import { useProject } from "../../state/project/index";
import { cleanPastedHtml } from "./pasteClean";
import {
  MAX_HTML_CHARS,
  crossesCells,
  insertConverted,
  literalContent,
  pasteAction,
  safeLooksLikeHtml,
  tryConvertHtmlText,
  type Converted,
} from "./htmlPaste";

type Content = ReturnType<typeof literalContent>;
type Range = { from: number; to: number };
export type InsertFn = (content: Content, range: Range) => boolean;
type AskFn = (text: string, converted: Converted, from: number, to: number) => void;

/** Pasted text that holds HTML tags, waiting for the author's answer in the dialog. */
export interface PendingPaste {
  text: string;
  converted: Converted;
  from: number;
  to: number;
}

/** Tells the author when a conversion left something out. */
export function warnNotice(warnings: number) {
  if (warnings > 0)
    useProject.setState({
      notice: plural(warnings, {
        one: "Converted, with # thing that could not be kept",
        other: "Converted, with # things that could not be kept",
      }),
    });
}

/** A task item's checkbox lives in a non-editable label; clicking it flips `checked` (one undo step). */
export function toggleTaskItem(view: EditorView, event: MouseEvent): boolean {
  const label = (event.target as HTMLElement | null)?.closest?.('li[data-type="taskItem"] > label');
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
}

/** Pasted HTML loses pictures from outside the book; the author is told. */
export function transformPastedHtml(html: string): string {
  const r = cleanPastedHtml(html);
  if (r.droppedImages > 0)
    useProject.setState({
      notice: t`Pasted pictures were left out. Use Insert, Image to add a picture to the book.`,
    });
  return r.html;
}

interface PasteRefs {
  askingRef: MutableRefObject<boolean>;
  askRef: MutableRefObject<AskFn>;
  insertRef: MutableRefObject<InsertFn>;
}

/**
 * Only text/plain that looks like HTML is handled here; a real HTML clipboard keeps ProseMirror's own path.
 * Nothing in here may throw or block: on any failure the default paste runs.
 */
export function createHandlePaste({ askingRef, askRef, insertRef }: PasteRefs) {
  return (view: EditorView, event: ClipboardEvent): boolean => {
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
        $from.parent.type.name === "codeBlock" || $from.marks().some((m) => m.type.name === "code");
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
  };
}

/**
 * Insert at the range the paste happened at: the dialog takes focus, and the editor's selection can move while it is open.
 * One transaction (one undo step), checked against the schema; returns false when nothing was inserted.
 */
export function makeInserter(editor: Editor | null): InsertFn {
  return (content, range) => {
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
}

/** The notice for a selection that cannot be converted, or null when it can. */
function selectionProblem(editor: Editor, from: number, to: number): string | null {
  if (to - from > MAX_HTML_CHARS) return t`The selection is too large to convert`;
  const text = editor.state.doc.textBetween(from, to, "\n");
  if (!safeLooksLikeHtml(text)) return t`No HTML found in the selection`;
  if (crossesCells(editor.state, from, to))
    return t`Select text inside one cell or paragraph to convert it`;
  return null;
}

/** Converts the HTML tags in the selection to real formatting (the "Convert HTML" command). */
export function convertSelection(editor: Editor | null, insert: InsertFn) {
  if (!editor || editor.isDestroyed) return;
  const { from, to } = editor.state.selection;
  const problem = selectionProblem(editor, from, to);
  if (problem) {
    useProject.setState({ notice: problem });
    return;
  }
  const c = tryConvertHtmlText(editor.state.doc.textBetween(from, to, "\n"));
  if (!c || !insert(c.content, { from, to })) {
    useProject.setState({ notice: t`Could not convert the HTML in the selection` });
    return;
  }
  warnNotice(c.warnings);
}

/** State of the "Paste as styled text?" dialog and the answers to it. */
export function usePasteFlow() {
  const [pending, setPending] = useState<PendingPaste | null>(null);
  const [remember, setRemember] = useState(false);
  // Set the moment a paste opens the dialog (before React re-renders), so a quick second paste is ignored.
  const askingRef = useRef(false);
  const askRef = useRef<AskFn>(() => {});
  askRef.current = (text, converted, from, to) => {
    askingRef.current = true;
    setRemember(false);
    setPending({ text, converted, from, to });
  };
  const insertRef = useRef<InsertFn>(() => false);
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
  return { pending, remember, setRemember, askingRef, askRef, insertRef, close, answer };
}
