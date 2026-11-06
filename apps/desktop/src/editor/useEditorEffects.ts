import { useEffect, useLayoutEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { pressed } from "../app/settings/shortcutBindings";
import { modalOpen, useRegisterCommands } from "../state/app/commands";
import { useProject } from "../state/project/index";
import { takePreviewJump, type PreviewJump } from "../state/pages/previewJump";
import { prefillQuery } from "../lib/search/findHelpers";
import { alignWord } from "../lib/page/pageWords";
import { useFind } from "./find/findStore";
import { registerHeadingJump } from "./headingJump";
import { docLeaves, wordOffset, wordsFrom } from "./pagination/exact";

/**
 * Find is Write mode only (Read mode has none). The shortcut works in focus mode too (the
 * bar then sits below the exit button). The native menu owns the accelerators; the keydown listener covers the browser
 * and any platform where the key also reaches the page, so a second call within a few ms is ignored.
 */
export function useFindShortcuts(
  editor: Editor | null,
  convert: () => void,
  hasSelection: boolean,
) {
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
  const convertRef = useRef(convert);
  convertRef.current = convert;
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
}

/** The outline navigator moves the caret to a heading by its number among the chapter's headings. */
export function useHeadingJump(editor: Editor | null) {
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
}

/** Where in the chapter the preview's jump points: the position of the text that starts the page. */
function jumpTarget(editor: Editor, jump: PreviewJump): number | null {
  const doc = editor.state.doc;
  const leaves = docLeaves(doc)[jump.block];
  // The report counts the leaves of a block without the blank paragraphs the exporter skips.
  const leaf = leaves?.filter((l) => !l.blank)[jump.leaf] ?? leaves?.[0];
  if (!leaf) return null;
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
  return at;
}

/** The print preview opened this chapter at a page: put the caret on the text that starts it. */
export function useJumpFromPreview(editor: Editor | null) {
  const currentId = useProject((s) => s.currentId);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const jump = takePreviewJump(currentId);
    if (!jump) return;
    const at = jumpTarget(editor, jump);
    if (at === null) return;
    editor
      .chain()
      .focus()
      .setTextSelection(Math.min(at, editor.state.doc.content.size))
      .scrollIntoView()
      .run();
  }, [editor, currentId]);
}

/**
 * The page surface and the phone's reflow are different components, so crossing the breakpoint moves the editor's DOM: the browser
 * drops the focus and the selection with it. Whether the editor had the focus is read in the render that switches (the DOM has not
 * moved yet), and the focus and selection are put back once it has.
 */
export function useRefocusOnSurfaceChange(editor: Editor | null, surface: boolean) {
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
}
