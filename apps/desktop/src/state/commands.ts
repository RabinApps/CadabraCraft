import { useEffect, useRef } from "react";
import { create } from "zustand";

/**
 * Commands the native menu can run. A component that can do something registers it while it is able to (the toolbar
 * registers the formatting commands while the editor is shown, `App` registers the book commands while a book is open),
 * so a command that is not registered is simply not available and its menu item is disabled.
 */
export interface Command {
  /** `arg` is set by menu items that carry one (a recent project's folder, a page preset). */
  run: (arg?: string) => void;
  /** Registered but not usable right now. Default true. */
  enabled?: boolean;
  /** For toggles and radio items. */
  checked?: boolean;
}

export type Commands = Readonly<Record<string, Command>>;

const useRegistry = create<{ commands: Commands }>(() => ({ commands: {} }));

/** The registered commands (reactive). The menu rebuilds its availability from this. */
export const useCommandRegistry = (): Commands => useRegistry((s) => s.commands);
export const getCommands = (): Commands => useRegistry.getState().commands;

/** True while a dialog is open: menu shortcuts must not act on the page behind it. */
export const modalOpen = (): boolean =>
  typeof document !== "undefined" && document.querySelector("[role=dialog]") !== null;

/** Runs a command if it is registered and enabled and no dialog is open. Returns whether it ran. */
export function runCommand(id: string, arg?: string): boolean {
  const c = getCommands()[id];
  if (!c || c.enabled === false || modalOpen()) return false;
  c.run(arg);
  return true;
}

/** Adds commands to the registry; returns the function that removes exactly those. */
export function registerCommands(commands: Commands): () => void {
  useRegistry.setState((s) => ({ commands: { ...s.commands, ...commands } }));
  return () =>
    useRegistry.setState((s) => {
      const next = { ...s.commands };
      for (const id of Object.keys(commands)) delete next[id];
      return { commands: next };
    });
}

/** Registers commands for as long as the component is mounted (and while they stay in `commands`). */
export function useRegisterCommands(commands: Commands): void {
  // Handlers change on every render; keep the latest ones behind stable wrappers so only availability triggers an update.
  const latest = useRef(commands);
  latest.current = commands;
  const shape = JSON.stringify(
    Object.entries(commands).map(([id, c]) => [id, c.enabled ?? true, c.checked ?? null]),
  );
  useEffect(() => {
    const own = Object.keys(latest.current);
    const wrapped: Record<string, Command> = {};
    for (const id of own) {
      const c = latest.current[id]!;
      wrapped[id] = {
        run: (arg) => latest.current[id]?.run(arg),
        ...(c.enabled === undefined ? {} : { enabled: c.enabled }),
        ...(c.checked === undefined ? {} : { checked: c.checked }),
      };
    }
    return registerCommands(wrapped);
  }, [shape]);
}

/** Dialogs on the start screen that the File menu can also open from a book (it closes the book first). */
export const useStartDialogs = create<{
  creating: boolean;
  importing: boolean;
  setCreating: (v: boolean) => void;
  setImporting: (v: boolean) => void;
}>((set) => ({
  creating: false,
  importing: false,
  setCreating: (creating) => set({ creating }),
  setImporting: (importing) => set({ importing }),
}));
