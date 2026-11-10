import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { t } from "@lingui/core/macro";
import { pressed } from "../../app/settings/shortcutBindings";
import { modalOpen } from "../../state/app/commands";
import { useProject } from "../../state/project/index";
import { setMarkOpeners, useMarkAnchor } from "../../lib/indexing/anchor";
import { newIndexEntryId } from "../../lib/indexing/ids";
import { GlossaryMarkDialog, type GlossaryMarkValues } from "./GlossaryMarkDialog";
import { IndexMarkDialog, type IndexMarkValues, type MarkSelection } from "./IndexMarkDialog";

/** The selected words and where they are, or null when nothing is selected. */
function selectionOf(editor: Editor): MarkSelection | null {
  const { from, to, empty } = editor.state.selection;
  if (empty) return null;
  const text = editor.state.doc.textBetween(from, to, " ");
  return text.trim() === "" ? null : { text, from, to };
}

/**
 * The editor's side of the index entry and glossary term commands: the two dialogs, the keys that open them (Settings > Shortcuts
 * can move them), and what the panels need to know (whether words are selected, how to open the dialogs). The marks are put on
 * the selection in one transaction, so one Undo takes one back.
 */
export function useMarkDialogs(editor: Editor | null) {
  const actions = useProject((s) => s.actions);
  const entries = useProject((s) => s.manifest?.glossary?.entries);
  const [index, setIndex] = useState<MarkSelection | null>(null);
  const [glossary, setGlossary] = useState<{ selection: MarkSelection | null } | null>(null);
  const hasSelection = useEditorState({
    editor,
    selector: ({ editor: e }) => !!e && selectionOf(e) !== null,
  });
  const openIndex = () => {
    const selection = editor && !editor.isDestroyed ? selectionOf(editor) : null;
    if (!selection) {
      useProject.setState({ notice: t`Select the words you want to list in the index first.` });
      return;
    }
    setIndex(selection);
  };
  const openGlossary = () => {
    if (editor && !editor.isDestroyed) setGlossary({ selection: selectionOf(editor) });
  };
  const latest = useRef({ openIndex, openGlossary });
  latest.current = { openIndex, openGlossary };
  useEffect(() => {
    if (!editor) return;
    setMarkOpeners({
      openIndex: () => latest.current.openIndex(),
      openGlossary: () => latest.current.openGlossary(),
    });
    const onKey = (e: KeyboardEvent) => {
      const idx = pressed(e, "editor.indexEntry");
      if ((!idx && !pressed(e, "editor.glossaryTerm")) || modalOpen()) return;
      e.preventDefault();
      if (idx) latest.current.openIndex();
      else latest.current.openGlossary();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      setMarkOpeners(null);
    };
  }, [editor]);
  useEffect(() => {
    useMarkAnchor.setState({ hasSelection: hasSelection === true });
  }, [hasSelection]);

  const refocus = () => editor?.commands.focus(null, { scrollIntoView: false });
  const addIndex = (selection: MarkSelection, v: IndexMarkValues) => {
    if (!editor || editor.isDestroyed) return;
    const attrs = {
      id: newIndexEntryId(),
      term: v.term,
      ...(v.sub ? { sub: v.sub } : {}),
      ...(v.see ? { see: v.see } : {}),
      ...(v.seeAlso ? { seeAlso: v.seeAlso } : {}),
    };
    setIndex(null);
    const ok = editor
      .chain()
      .focus(null, { scrollIntoView: false })
      .setTextSelection({ from: selection.from, to: selection.to })
      .setMark("indexEntry", attrs)
      .run();
    if (!ok) useProject.setState({ notice: t`An index entry cannot go here` });
    else if (v.markAll) {
      const { id: _id, ...entry } = attrs;
      void actions.markIndexOccurrences(entry, selection.text.trim());
    }
  };
  const addGlossary = async (selection: MarkSelection | null, v: GlossaryMarkValues) => {
    const id = "id" in v.entry ? v.entry.id : await actions.addGlossaryEntry(v.entry);
    if (!id) return;
    setGlossary(null);
    if (selection && editor && !editor.isDestroyed) {
      const ok = editor
        .chain()
        .focus(null, { scrollIntoView: false })
        .setTextSelection({ from: selection.from, to: selection.to })
        .setMark("glossaryTerm", { id })
        .run();
      if (!ok) useProject.setState({ notice: t`A glossary term cannot go here` });
    } else refocus();
    if (v.firstUse) void actions.markGlossaryOccurrences(id, true);
  };
  const dialogs = (
    <>
      <IndexMarkDialog
        selection={index}
        onClose={() => {
          setIndex(null);
          refocus();
        }}
        onSubmit={(v) => index && addIndex(index, v)}
      />
      <GlossaryMarkDialog
        open={glossary !== null}
        selection={glossary?.selection ?? null}
        entries={entries ?? []}
        onClose={() => {
          setGlossary(null);
          refocus();
        }}
        onSubmit={(v) => void addGlossary(glossary?.selection ?? null, v)}
      />
    </>
  );
  return { openIndex, openGlossary, dialogs };
}
