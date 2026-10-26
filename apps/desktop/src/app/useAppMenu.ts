import { useEffect, useMemo } from "react";
import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { canAddMatter, readingOrder } from "@cadabracraft/format";
import type { MatterKind } from "@cadabracraft/shared";
import { bridge } from "../lib/bridge";
import { errText } from "../lib/projectError";
import { runCommand, useCommandRegistry, useRegisterCommands, useStartDialogs, type Commands } from "./commands";
import { useLayout } from "./layout";
import { buildMenuModel } from "./menuModel";
import { showNativeMenu } from "./nativeMenu";
import { useRecents } from "./recents";
import { SPONSOR_URL } from "./sponsor";
import { useProject } from "./store";

type View = "book" | "settings" | "templates" | "print";

export interface AppMenuHooks {
  view: View;
  setView: (v: View) => void;
  mode: "write" | "read";
  setMode: (m: "write" | "read") => void;
  openExport: (format: "epub" | "pdf") => void;
  openDetails: () => void;
  /** Shows a failure from a menu action in the page's error banner. */
  fail: (message: string) => void;
}

const FRONT: MatterKind[] = ["title-page", "copyright", "dedication", "epigraph", "foreword", "preface", "custom"];
const BACK: MatterKind[] = ["acknowledgments", "about-the-author", "also-by", "colophon", "custom"];
const isMac = (): boolean => typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);

/**
 * Registers what the File, Edit, Insert, View and Help menus can do in the current context, and shows the native menu.
 * A book command is only registered while a book is open and its main view is showing, so everywhere else its item is greyed out.
 */
export function useAppMenu(h: AppMenuHooks): void {
  const manifest = useProject((s) => s.manifest);
  const currentId = useProject((s) => s.currentId);
  const history = useProject((s) => s.history);
  const actions = useProject((s) => s.actions);
  const recents = useRecents((s) => s.recents);
  const clearRecents = useRecents((s) => s.clear);
  const { focus, details, set: setLayout } = useLayout();
  const setCreating = useStartDialogs((s) => s.setCreating);
  const setImporting = useStartDialogs((s) => s.setImporting);

  const open = manifest !== null;
  const inBook = open && h.view === "book";
  const writing = inBook && h.mode === "write";
  const order = manifest ? readingOrder(manifest) : [];
  const index = order.findIndex((p) => p.id === currentId);
  const guard = (f: () => Promise<unknown>) => () => { void f().catch((e) => h.fail(errText(e))); };
  /** Leaves the open book (saving first) so the start screen can show a dialog. */
  const leave = async () => { h.setView("book"); await actions.closeProject(); };

  const commands: Record<string, Commands[string]> = {
    "app.settings": { run: () => h.setView("settings"), enabled: h.view !== "settings" },
    "file.new": { run: guard(async () => { await leave(); setCreating(true); }) },
    "file.open": { run: guard(async () => { const root = await bridge.pickFolder(); if (root) { await leave(); await actions.openProject(root); } }) },
    "file.import": { run: guard(async () => { await leave(); setImporting(true); }) },
    "file.openRecent": { run: (root) => { if (root) void leave().then(() => actions.openProject(root)).catch((e) => h.fail(errText(e))); } },
    "file.clearRecents": { run: clearRecents, enabled: recents.length > 0 },
    "help.sponsor": { run: guard(() => bridge.openUrl(SPONSOR_URL)) },
  };
  if (inBook) {
    Object.assign(commands, {
      "file.save": { run: guard(actions.flush) },
      "file.bookDetails": { run: h.openDetails },
      "file.exportEpub": { run: guard(async () => { await actions.flush(); h.openExport("epub"); }) },
      "file.exportPdf": { run: guard(async () => { await actions.flush(); h.openExport("pdf"); }) },
      "file.printPreview": { run: guard(async () => { await actions.flush(); h.setView("print"); }) },
      "file.close": { run: guard(leave) },
      "edit.bookUndo": { run: guard(actions.undo), enabled: history.undo.length > 0 },
      "edit.bookRedo": { run: guard(actions.redo), enabled: history.redo.length > 0 },
      "insert.chapter": { run: guard(() => actions.add(t`Chapter ${manifest!.chapters.length + 1}`)) },
      "view.write": { run: () => h.setMode("write"), checked: h.mode === "write" },
      "view.read": { run: guard(async () => { await actions.flush(); h.setMode("read"); }), checked: h.mode === "read" },
      "view.details": { run: () => setLayout({ details: !details }), checked: details, enabled: h.mode === "write" },
      "go.previous": { run: guard(async () => { const p = order[index - 1]; if (p) await actions.selectChapter(p.id); }), enabled: index > 0 },
      "go.next": { run: guard(async () => { const p = order[index + 1]; if (p) await actions.selectChapter(p.id); }), enabled: index >= 0 && index < order.length - 1 },
    });
    for (const k of FRONT) commands[`insert.front.${k}`] = { run: guard(() => actions.addMatter("front", k)), enabled: canAddMatter(manifest!, k) };
    for (const k of BACK) commands[`insert.back.${k}`] = { run: guard(() => actions.addMatter("back", k)), enabled: canAddMatter(manifest!, k) };
  }
  if (writing) commands["view.focus"] = { run: () => setLayout({ focus: !focus }), checked: focus };
  useRegisterCommands(commands);

  // The native menu follows the registry: same structure, different availability and a few labels.
  const registry = useCommandRegistry();
  const undoLabel = history.undo.at(-1)?.label ?? null;
  const redoLabel = history.redo.at(-1)?.label ?? null;
  const model = useMemo(
    () => buildMenuModel({ mac: isMac(), commands: registry, recents, undoLabel, redoLabel }),
    // The labels come from the current language, so a language change rebuilds the menu too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [registry, recents, undoLabel, redoLabel, i18n.locale],
  );
  useEffect(() => { void showNativeMenu(model, (id, arg) => { runCommand(id, arg); }); }, [model]);
}
