import { useState } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { useLingui } from "@lingui/react/macro";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Dialog";
import { Field } from "../ui/Input";
import { useRegisterCommands, type Commands } from "../app/commands";

export const MAX_TABLE_ROWS = 50;
export const MAX_TABLE_COLUMNS = 8;

/** Clamps a typed size to a whole number from 1 to `max` (empty or invalid text gives the minimum). */
export const clampSize = (text: string, max: number): number => Math.min(max, Math.max(1, Math.floor(Number(text)) || 1));

/**
 * Insert > Table… and the Format menu's table commands. Menu only, no toolbar button. The table commands are enabled only
 * with the cursor inside a table (Insert > Table is disabled there, since cells cannot hold tables).
 */
export function TableCommands({ editor }: { editor: Editor }) {
  const { t } = useLingui();
  const inTable = useEditorState({ editor, selector: ({ editor: e }) => e.isActive("table") });
  const [size, setSize] = useState<{ rows: string; cols: string } | null>(null);
  const c = () => editor.chain().focus();

  const commands: Commands = {
    "editor.table": { run: () => setSize({ rows: "3", cols: "3" }), enabled: !inTable },
    "editor.tableAddRow": { run: () => c().addRowAfter().run(), enabled: inTable },
    "editor.tableAddColumn": { run: () => c().addColumnAfter().run(), enabled: inTable },
    "editor.tableDeleteRow": { run: () => c().deleteRow().run(), enabled: inTable },
    "editor.tableDeleteColumn": { run: () => c().deleteColumn().run(), enabled: inTable },
    "editor.tableHeaderRow": { run: () => c().toggleHeaderRow().run(), enabled: inTable },
    "editor.tableDelete": { run: () => c().deleteTable().run(), enabled: inTable },
  };
  useRegisterCommands(commands);

  const apply = () => {
    if (!size) return;
    c().insertTable({ rows: clampSize(size.rows, MAX_TABLE_ROWS), cols: clampSize(size.cols, MAX_TABLE_COLUMNS), withHeaderRow: true }).run();
    setSize(null);
  };

  return (
    <Modal open={size !== null} onOpenChange={(o) => !o && setSize(null)} title={t`Insert table`}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); apply(); }}>
        <Field label={t`Rows`} type="number" inputMode="numeric" min={1} max={MAX_TABLE_ROWS} value={size?.rows ?? ""} onChange={(e) => setSize((s) => s && { ...s, rows: e.target.value })} hint={t`The first row is a header. Up to ${MAX_TABLE_ROWS} rows.`} autoFocus />
        <Field label={t`Columns`} type="number" inputMode="numeric" min={1} max={MAX_TABLE_COLUMNS} value={size?.cols ?? ""} onChange={(e) => setSize((s) => s && { ...s, cols: e.target.value })} hint={t`Columns are equal width. Up to ${MAX_TABLE_COLUMNS} columns.`} />
        <div className="flex justify-end gap-2.5">
          <Button onClick={() => setSize(null)}>{t`Cancel`}</Button>
          <Button type="submit" variant="primary">{t`Insert`}</Button>
        </div>
      </form>
    </Modal>
  );
}
