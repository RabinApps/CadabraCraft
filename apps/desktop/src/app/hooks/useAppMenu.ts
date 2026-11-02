import { useEffect, useMemo } from "react";
import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { canAddMatter, readingOrder } from "@cadabracraft/format";
import type { MatterKind } from "@cadabracraft/shared";
import { bridge } from "../../lib/bridge";
import { errText } from "../../lib/projectError";
import {
  runCommand,
  useCommandRegistry,
  useRegisterCommands,
  useStartDialogs,
  type Commands,
} from "../../state/commands";
import { useLayout } from "../../state/layout";
import { useQuickNav } from "../../state/quickNav";
import { useSettings } from "../../state/editorPrefs";
import { buildMenuModel } from "../shell/menuModel";
import { quitApp } from "../shell/quit";
import { showNativeMenu } from "../shell/nativeMenu";
import { useRecents } from "../../state/recents";
import { useLicenses } from "../../state/licenses";
import { useUpdates } from "../../state/updates";
import { SPONSOR_URL } from "../../state/sponsor";
import { isMac } from "../../lib/platform";
import type { ExportFormat } from "../export/exportFormat";
import { useProject } from "../../state/project/index";

type View = "book" | "settings" | "fonts" | "templates" | "print";

export interface AppMenuHooks {
  view: View;
  setView: (v: View) => void;
  mode: "write" | "read";
  setMode: (m: "write" | "read") => void;
  openExport: (format: ExportFormat) => void;
  openDetails: () => void;
  /** Shows a failure from a menu action in the page's error banner. */
  fail: (message: string) => void;
}

const FRONT: MatterKind[] = [
  "title-page",
  "copyright",
  "dedication",
  "epigraph",
  "contents",
  "foreword",
  "preface",
  "custom",
];
const BACK: MatterKind[] = ["acknowledgments", "about-the-author", "also-by", "colophon", "custom"];

/**
 * Registers what the File, Edit, Insert, View and Help menus can do in the current context, and shows the native menu.
 * A book command is only registered while a book is open and its main view is showing, so everywhere else its item is greyed out.
 */
/** Manual check from the Help menu: says so when the app is current, and reports a failure. */
async function checkForUpdatesNow(h: { fail: (message: string) => void }) {
  await useUpdates.getState().check(true);
  const { status } = useUpdates.getState();
  if (status.kind === "current") useProject.setState({ notice: t`CadabraCraft is up to date.` });
  if (status.kind === "unsupported")
    useProject.setState({ notice: t`Your package manager updates this copy of CadabraCraft.` });
  if (status.kind === "error") h.fail(status.message);
}

export function useAppMenu(h: AppMenuHooks): void {
  const manifest = useProject((s) => s.manifest);
  const currentId = useProject((s) => s.currentId);
  const history = useProject((s) => s.history);
  const actions = useProject((s) => s.actions);
  const recents = useRecents((s) => s.recents);
  const clearRecents = useRecents((s) => s.clear);
  const { focus, details, references, set: setLayout } = useLayout();
  const showQuickNav = useQuickNav((s) => s.show);
  const setCreating = useStartDialogs((s) => s.setCreating);
  const setImporting = useStartDialogs((s) => s.setImporting);
  const setImportingInto = useStartDialogs((s) => s.setImportingInto);

  const open = manifest !== null;
  const inBook = open && h.view === "book";
  const writing = inBook && h.mode === "write";
  const order = manifest ? readingOrder(manifest) : [];
  const index = order.findIndex((p) => p.id === currentId);
  const guard = (f: () => Promise<unknown>) => () => {
    void f().catch((e) => h.fail(errText(e)));
  };
  /** Leaves the open book (saving first) so the start screen can show a dialog. */
  const leave = async () => {
    h.setView("book");
    await actions.closeProject();
  };

  const commands: Record<string, Commands[string]> = {
    "app.quit": { run: guard(quitApp), global: true },
    "view.palette": { run: () => showQuickNav("palette") },
    "app.settings": {
      run: () => h.setView("settings"),
      enabled: h.view !== "settings" && h.view !== "fonts",
    },
    "file.new": {
      run: guard(async () => {
        await leave();
        setCreating(true);
      }),
    },
    "file.open": {
      run: guard(async () => {
        const root = await bridge.pickFolder();
        if (root) {
          await leave();
          await actions.openProject(root);
        }
      }),
    },
    "file.import": {
      run: guard(async () => {
        await leave();
        setImporting(true);
      }),
    },
    "file.openRecent": {
      run: (root) => {
        if (root)
          void leave()
            .then(() => actions.openProject(root))
            .catch((e) => h.fail(errText(e)));
      },
    },
    "file.clearRecents": { run: clearRecents, enabled: recents.length > 0 },
    "help.sponsor": { run: guard(() => bridge.openUrl(SPONSOR_URL)) },
    "help.licenses": { run: () => useLicenses.getState().show() },
    "help.updates": { run: () => void checkForUpdatesNow(h) },
  };
  if (inBook) {
    Object.assign(commands, {
      "file.save": { run: guard(actions.flush) },
      "file.bookDetails": { run: h.openDetails },
      "file.exportEpub": {
        run: guard(async () => {
          await actions.flush();
          h.openExport("epub");
        }),
      },
      "file.exportPdf": {
        run: guard(async () => {
          await actions.flush();
          h.openExport("pdf");
        }),
      },
      "file.exportMarkdown": {
        run: guard(async () => {
          await actions.flush();
          h.openExport("markdown");
        }),
      },
      "file.exportDocx": {
        run: guard(async () => {
          await actions.flush();
          h.openExport("docx");
        }),
      },
      "file.exportRtf": {
        run: guard(async () => {
          await actions.flush();
          h.openExport("rtf");
        }),
      },
      "file.exportAudiobook": {
        run: guard(async () => {
          await actions.flush();
          h.openExport("audiobook");
        }),
      },
      "file.printPreview": {
        run: guard(async () => {
          await actions.flush();
          h.setView("print");
        }),
      },
      "file.importInto": {
        run: guard(async () => {
          await actions.flush();
          setImportingInto(true);
        }),
      },
      "file.close": { run: guard(leave) },
      "edit.bookUndo": { run: guard(actions.undo), enabled: history.undo.length > 0 },
      "edit.bookRedo": { run: guard(actions.redo), enabled: history.redo.length > 0 },
      "insert.chapter": {
        run: guard(() => actions.add(t`Chapter ${manifest!.chapters.length + 1}`)),
      },
      "view.write": { run: () => h.setMode("write"), checked: h.mode === "write" },
      "view.read": {
        run: guard(async () => {
          await actions.flush();
          h.setMode("read");
        }),
        checked: h.mode === "read",
      },
      "view.details": {
        run: () => setLayout({ details: !details }),
        checked: details,
        enabled: h.mode === "write",
      },
      "view.references": {
        run: () => setLayout({ references: !references }),
        checked: references,
        enabled: h.mode === "write",
      },
      "go.previous": {
        run: guard(async () => {
          const p = order[index - 1];
          if (p) await actions.selectChapter(p.id);
        }),
        enabled: index > 0,
      },
      "go.next": {
        run: guard(async () => {
          const p = order[index + 1];
          if (p) await actions.selectChapter(p.id);
        }),
        enabled: index >= 0 && index < order.length - 1,
      },
    });
    for (const k of FRONT)
      commands[`insert.front.${k}`] = {
        run: guard(() => actions.addMatter("front", k)),
        enabled: canAddMatter(manifest!, k),
      };
    for (const k of BACK)
      commands[`insert.back.${k}`] = {
        run: guard(() => actions.addMatter("back", k)),
        enabled: canAddMatter(manifest!, k),
      };
  }
  if (writing) {
    // The outline jumps inside the editor, which exists in Write mode only.
    commands["view.outline"] = { run: () => showQuickNav("outline") };
    commands["view.focus"] = { run: () => setLayout({ focus: !focus }), checked: focus };
  }
  useRegisterCommands(commands);

  // The native menu follows the registry: same structure, different availability and a few labels.
  const registry = useCommandRegistry();
  const shortcuts = useSettings((s) => s.shortcutOverrides);
  const undoLabel = history.undo.at(-1)?.label ?? null;
  const redoLabel = history.redo.at(-1)?.label ?? null;
  const model = useMemo(
    () =>
      buildMenuModel({
        mac: isMac(),
        commands: registry,
        recents,
        undoLabel,
        redoLabel,
        shortcuts,
      }),
    // The labels come from the current language, so a language change rebuilds the menu too.
    [registry, recents, undoLabel, redoLabel, shortcuts, i18n.locale],
  );
  useEffect(() => {
    void showNativeMenu(model, (id, arg) => runCommand(id, arg));
  }, [model]);
}
