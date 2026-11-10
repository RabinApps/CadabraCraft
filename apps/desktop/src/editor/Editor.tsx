import { useEffect, useRef } from "react";
import { useLingui } from "@lingui/react/macro";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import {
  chapterJson,
  extensions,
  shortcutRemap,
  SmartTypography,
} from "@cadabracraft/editor-schema";
import { editorRemap } from "../app/settings/shortcutBindings";
import type { ChapterDoc } from "@cadabracraft/shared";
import { useSettings } from "../state/view/editorPrefs";
import { dirFor } from "../i18n/locales";
import { Toolbar } from "./toolbar/Toolbar";
import { Search } from "./search/plugin";
import { Pagination } from "./pagination/plugin";
import { PageFrame, ReflowFrame } from "./pageview/PageFrame";
import { KEY_WINDOW_MS, followCaret } from "./typewriter";
import { TabKey } from "./tabKey";
import { FootnoteA11y } from "./footnoteA11y";
import { cleanPastedText } from "./paste/pasteClean";
import { usePageView } from "../app/hooks/usePageView";
import { EDITOR_DROP_ATTR } from "../lib/fileDrop";
import { EditorFileDrop } from "./drop/EditorFileDrop";
import { FindBar } from "./find/FindBar";
import { useFind } from "./find/findStore";
import { ReadAloudHighlight } from "./readAloud/highlight";
import { ReadAloudBar } from "./readAloud/ReadAloudBar";
import { useReadAloud } from "./readAloud/useReadAloud";
import { useReadAloudRequest } from "../state/app/readAloudRequest";
import { useCommentAnchoring } from "./useCommentAnchoring";
import { useSceneEditingBridge } from "./useSceneEditingBridge";
import { PasteDialog } from "./paste/PasteDialog";
import {
  convertSelection,
  createHandlePaste,
  makeInserter,
  toggleTaskItem,
  transformPastedHtml,
  usePasteFlow,
} from "./paste/pasteFlow";
import {
  useFindShortcuts,
  useHeadingJump,
  useJumpFromPreview,
  useRefocusOnSurfaceChange,
} from "./useEditorEffects";

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

export function Editor({ initial, language, onChange, focus, readOnly }: Props) {
  const { t } = useLingui();
  const { pending, remember, setRemember, askingRef, askRef, insertRef, close, answer } =
    usePasteFlow();
  /** When a key last went down in the editor (typewriter scrolling follows the caret only for keys). */
  const lastKeyAt = useRef(0);
  /** The edition language, read by the typing rules on every key so a change needs no new editor. */
  const languageRef = useRef(language);
  languageRef.current = language;
  const editor = useEditor({
    editable: !readOnly,
    // Keys the author moved in Settings > Shortcuts are read when the editor is made (the settings page replaces the editor).
    extensions: [
      ...extensions,
      Search,
      ReadAloudHighlight,
      Pagination,
      TabKey,
      // Smart quotes, dashes and ellipsis: always added, switched by the app setting and the language at each key (architecture.md, "Smart typography").
      SmartTypography.configure({
        enabled: () => useSettings.getState().smartTypography,
        language: () => languageRef.current,
      }),
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
        mousedown: toggleTaskItem,
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
      transformPastedHTML: transformPastedHtml,
      // Only text/plain that looks like HTML is handled here; a real HTML clipboard keeps ProseMirror's own path.
      handlePaste: createHandlePaste({ askingRef, askRef, insertRef }),
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
  insertRef.current = makeInserter(editor);
  const hasSelection = useEditorState({
    editor,
    selector: ({ editor: e }) => !!e && !e.state.selection.empty,
  });
  // The comments rail anchors a new thread by putting a `comment` mark on what is selected here.
  useCommentAnchoring(editor, hasSelection);

  useFindShortcuts(editor, () => convertSelection(editor, insertRef.current), hasSelection);
  useHeadingJump(editor);
  useSceneEditingBridge(editor);
  useJumpFromPreview(editor);
  useRefocusOnSurfaceChange(editor, pageView.on);
  const readAloud = useReadAloud(editor, language);
  const readAloudCount = useReadAloudRequest((s) => s.count);
  const readAloudSeen = useRef(readAloudCount);
  useEffect(() => {
    if (readAloudCount === readAloudSeen.current) return;
    readAloudSeen.current = readAloudCount;
    readAloud.readFromCursor();
  }, [readAloudCount, readAloud]);
  if (!editor) return null;
  return (
    <div {...{ [EDITOR_DROP_ATTR]: "" }} className="relative flex min-h-0 flex-1 flex-col">
      {findOpen && <FindBar editor={editor} focusMode={focus} />}
      {!focus && <Toolbar editor={editor} />}
      {readAloud.state.status !== "idle" && <ReadAloudBar {...readAloud} />}
      <PasteDialog
        pending={pending}
        remember={remember}
        onRemember={setRemember}
        onAnswer={answer}
        onClose={() => {
          close();
          editor.commands.focus();
        }}
      />
      {/* The page area: files dragged over it show the drop highlight (a picture dropped here is added to the page). */}
      {/* order-first: on a phone the toolbar is docked below the page (see PageFrame). */}
      <div className="relative flex min-h-0 flex-1 flex-col max-md:order-first">
        {pageView.on ? (
          <PageFrame editor={editor}>
            <EditorContent editor={editor} />
          </PageFrame>
        ) : (
          <ReflowFrame>
            <EditorContent editor={editor} />
          </ReflowFrame>
        )}
        <EditorFileDrop editor={editor} readOnly={!!readOnly} />
      </div>
    </div>
  );
}
