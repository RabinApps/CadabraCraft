import { t } from "@lingui/core/macro";
import { canAddMatter, chaptersOf, type Manifest } from "@cadabracraft/format";
import type { MatterKind } from "@cadabracraft/shared";
import { bridge } from "../../lib/bridge";
import { errText } from "../../lib/projectError";
import type { Command } from "../../state/app/commands";
import { useAnalysis } from "../../state/app/analysis";
import { useWritingDialog } from "../../state/app/writingDialog";
import { useLicenses } from "../../state/app/licenses";
import { SPONSOR_URL } from "../../state/app/sponsor";
import { useUpdates } from "../../state/app/updates";
import { useProject } from "../../state/project/index";
import { quitApp } from "../shell/native/quit";
import type { ExportFormat } from "../export/exportFormat";
import { useReadAloudRequest } from "../../state/app/readAloudRequest";

export type View =
  "book" | "settings" | "fonts" | "templates" | "print" | "welcome" | "board" | "timeline";

export interface AppMenuHooks {
  view: View;
  setView: (v: View) => void;
  mode: "write" | "read";
  setMode: (m: "write" | "read") => void;
  openExport: (format: ExportFormat) => void;
  openDetails: () => void;
  /** Help > Welcome to CadabraCraft…: the first-run screen, shown over the current page. */
  openWelcome: () => void;
  /** Shows a failure from a menu action in the page's error banner. */
  fail: (message: string) => void;
}

type Actions = ReturnType<typeof useProject.getState>["actions"];
type History = ReturnType<typeof useProject.getState>["history"];

/** Everything the menu commands read or call, gathered once per render by `useAppMenu`. */
export interface CommandEnv {
  h: AppMenuHooks;
  actions: Actions;
  manifest: Manifest | null;
  history: History;
  /** The reading order of the open book and the position of the open page in it (-1 when none). */
  order: readonly { id: string }[];
  index: number;
  recentCount: number;
  clearRecents: () => void;
  layout: { focus: boolean; details: boolean; references: boolean };
  setLayout: (patch: { focus?: boolean; details?: boolean; references?: boolean }) => void;
  typewriter: boolean;
  setTypewriter: (on: boolean) => void;
  showQuickNav: (kind: "palette" | "outline") => void;
  setCreating: (on: boolean) => void;
  setImporting: (on: boolean) => void;
  setImportingInto: (on: boolean) => void;
  setLibraryOpen: (on: boolean) => void;
}

export const FRONT: MatterKind[] = [
  "title-page",
  "copyright",
  "dedication",
  "epigraph",
  "contents",
  "foreword",
  "preface",
  "custom",
];
export const BACK: MatterKind[] = [
  "acknowledgments",
  "about-the-author",
  "also-by",
  "colophon",
  "index",
  "glossary",
  "custom",
];

/** Manual check from the Help menu: says so when the app is current, and reports a failure. */
async function checkForUpdatesNow(h: { fail: (message: string) => void }) {
  await useUpdates.getState().check(true);
  const { status } = useUpdates.getState();
  if (status.kind === "current") useProject.setState({ notice: t`CadabraCraft is up to date.` });
  if (status.kind === "unsupported")
    useProject.setState({ notice: t`Your package manager updates this copy of CadabraCraft.` });
  if (status.kind === "error") h.fail(status.message);
}

/** Wraps an async action so that a failure goes to the page's error banner. */
export const guarded = (env: CommandEnv) => (f: () => Promise<unknown>) => () => {
  void f().catch((e) => env.h.fail(errText(e)));
};

/** Leaves the open book (saving first) so the start screen can show a dialog. */
const leave = async (env: CommandEnv) => {
  env.h.setView("book");
  await env.actions.closeProject();
};

/** The commands that work everywhere: Quit, Settings, the start-screen File items and Help. */
export function appCommands(env: CommandEnv): Record<string, Command> {
  const { h, actions } = env;
  const guard = guarded(env);
  return {
    "app.quit": { run: guard(quitApp), global: true },
    "view.palette": { run: () => env.showQuickNav("palette") },
    "app.settings": {
      run: () => h.setView("settings"),
      enabled: h.view !== "settings" && h.view !== "fonts",
    },
    "file.new": {
      run: guard(async () => {
        await leave(env);
        env.setCreating(true);
      }),
    },
    "file.open": {
      run: guard(async () => {
        const root = await bridge.pickFolder();
        if (root) {
          await leave(env);
          await actions.openProject(root);
        }
      }),
    },
    "file.import": {
      run: guard(async () => {
        await leave(env);
        env.setImporting(true);
      }),
    },
    "file.library": {
      run: guard(async () => {
        await leave(env);
        env.setLibraryOpen(true);
      }),
    },
    "file.openRecent": {
      run: (root) => {
        if (root)
          void leave(env)
            .then(() => actions.openProject(root))
            .catch((e) => h.fail(errText(e)));
      },
    },
    "file.clearRecents": { run: env.clearRecents, enabled: env.recentCount > 0 },
    "help.welcome": { run: () => h.openWelcome() },
    "help.sponsor": { run: guard(() => bridge.openUrl(SPONSOR_URL)) },
    "help.licenses": { run: () => useLicenses.getState().show() },
    "help.updates": { run: () => void checkForUpdatesNow(h) },
  };
}

const EXPORT_COMMANDS: [string, ExportFormat][] = [
  ["file.exportEpub", "epub"],
  ["file.exportPdf", "pdf"],
  ["file.exportMarkdown", "markdown"],
  ["file.exportDocx", "docx"],
  ["file.exportRtf", "rtf"],
  ["file.exportAudiobook", "audiobook"],
];

/** The File commands of an open book: save, details, the exports, import into this book and close. */
function bookFileCommands(env: CommandEnv): Record<string, Command> {
  const { h, actions } = env;
  const guard = guarded(env);
  /** Saves what was typed first, so the next view shows it. */
  const afterFlush = (f: () => void): Command => ({
    run: guard(async () => {
      await actions.flush();
      f();
    }),
  });
  const commands: Record<string, Command> = {
    "file.save": { run: guard(actions.flush) },
    "file.bookDetails": { run: h.openDetails },
    "file.analysis": { run: () => useAnalysis.getState().show() },
    "file.writingHistory": { run: () => useWritingDialog.getState().show() },
    "file.printPreview": afterFlush(() => h.setView("print")),
    "file.importInto": afterFlush(() => env.setImportingInto(true)),
    "file.close": { run: guard(() => leave(env)) },
  };
  for (const [id, format] of EXPORT_COMMANDS) commands[id] = afterFlush(() => h.openExport(format));
  return commands;
}

/** The Edit, Insert and View commands of an open book, and Previous / Next page. */
function bookViewCommands(env: CommandEnv): Record<string, Command> {
  const { h, actions, manifest, history, order, index, layout, setLayout } = env;
  const guard = guarded(env);
  const afterFlush = (f: () => void): Command => ({
    run: guard(async () => {
      await actions.flush();
      f();
    }),
  });
  const goTo = (at: number) =>
    guard(async () => {
      const p = order[at];
      if (p) await actions.selectChapter(p.id);
    });
  return {
    "edit.bookUndo": { run: guard(actions.undo), enabled: history.undo.length > 0 },
    "edit.bookRedo": { run: guard(actions.redo), enabled: history.redo.length > 0 },
    "insert.chapter": {
      run: guard(() => actions.add(t`Chapter ${chaptersOf(manifest!).length + 1}`)),
    },
    "insert.blank": { run: guard(() => actions.addBlank()) },
    "view.write": { run: () => h.setMode("write"), checked: h.mode === "write" },
    "view.read": { ...afterFlush(() => h.setMode("read")), checked: h.mode === "read" },
    "view.details": {
      run: () => setLayout({ details: !layout.details }),
      checked: layout.details,
      enabled: h.mode === "write",
    },
    "view.references": {
      run: () => setLayout({ references: !layout.references }),
      checked: layout.references,
      enabled: h.mode === "write",
    },
    "view.board": afterFlush(() => h.setView("board")),
    "view.timeline": afterFlush(() => h.setView("timeline")),
    "go.previous": { run: goTo(index - 1), enabled: index > 0 },
    "go.next": { run: goTo(index + 1), enabled: index >= 0 && index < order.length - 1 },
  };
}

/** The commands that exist while a book is open and its main view is showing. */
export function bookCommands(env: CommandEnv): Record<string, Command> {
  const { actions, manifest } = env;
  const guard = guarded(env);
  const commands = { ...bookFileCommands(env), ...bookViewCommands(env) };
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
  return commands;
}

/** The commands that jump inside the editor, which exists in Write mode only. */
export function writingCommands(env: CommandEnv): Record<string, Command> {
  const { layout, setLayout, typewriter } = env;
  return {
    "view.outline": { run: () => env.showQuickNav("outline") },
    "view.focus": { run: () => setLayout({ focus: !layout.focus }), checked: layout.focus },
    "view.typewriter": { run: () => env.setTypewriter(!typewriter), checked: typewriter },
    "view.readAloud": { run: () => useReadAloudRequest.getState().request() },
  };
}
