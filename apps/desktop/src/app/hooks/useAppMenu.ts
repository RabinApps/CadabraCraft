import { useEffect, useMemo } from "react";
import { i18n } from "@lingui/core";
import { readingOrder } from "@cadabracraft/format";
import {
  runCommand,
  useCommandRegistry,
  useRegisterCommands,
  useStartDialogs,
  type Command,
} from "../../state/app/commands";
import { useLayout } from "../../state/view/layout";
import { useLibraryOpen } from "../../state/app/library";
import { useQuickNav } from "../../state/app/quickNav";
import { useSettings } from "../../state/view/editorPrefs";
import { buildMenuModel } from "../shell/native/menuModel";
import { showNativeMenu } from "../shell/native/nativeMenu";
import { useRecents } from "../../state/app/recents";
import { isMac } from "../../lib/platform";
import { useProject } from "../../state/project/index";
import {
  appCommands,
  bookCommands,
  writingCommands,
  type AppMenuHooks,
  type CommandEnv,
} from "./appMenuCommands";

export type { AppMenuHooks } from "./appMenuCommands";

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
  const { focus, details, references, set: setLayout } = useLayout();
  const typewriter = useSettings((s) => s.typewriterScroll);
  const setPrefs = useSettings((s) => s.set);
  const showQuickNav = useQuickNav((s) => s.show);
  const setCreating = useStartDialogs((s) => s.setCreating);
  const setImporting = useStartDialogs((s) => s.setImporting);
  const setImportingInto = useStartDialogs((s) => s.setImportingInto);
  const setLibraryOpen = useLibraryOpen((s) => s.setOpen);

  const open = manifest !== null;
  const inBook = open && h.view === "book";
  const writing = inBook && h.mode === "write";
  const order = manifest ? readingOrder(manifest) : [];
  const env: CommandEnv = {
    h,
    actions,
    manifest,
    history,
    order,
    index: order.findIndex((p) => p.id === currentId),
    recentCount: recents.length,
    clearRecents,
    layout: { focus, details, references },
    setLayout,
    typewriter,
    setTypewriter: (on) => setPrefs({ typewriterScroll: on }),
    showQuickNav,
    setCreating,
    setImporting,
    setImportingInto,
    setLibraryOpen,
  };
  const commands: Record<string, Command> = {
    ...appCommands(env),
    ...(inBook ? bookCommands(env) : {}),
    ...(writing ? writingCommands(env) : {}),
  };
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
