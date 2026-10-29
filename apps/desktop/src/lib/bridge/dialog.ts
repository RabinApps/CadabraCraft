import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

/**
 * Dev-automation only, for the pickers that still run in the webview (references, fonts; the folder, image and import
 * pickers run in Rust and consume the queue there): an agent can queue answers for the next native dialogs (see src-tauri/src/automation.rs).
 * Returns undefined when nothing is queued, in production builds, or when the command doesn't exist, so the real
 * dialog opens. Returns null when the queued answer is "cancel".
 */
const queuedDialog = async (): Promise<string | null | undefined> => {
  if (!import.meta.env.DEV) return undefined;
  try {
    const r = await invoke<{ answer: string | null } | null>("automation_take_dialog");
    return r ? r.answer : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Native pickers. Every path they return is absolute, only ever passed straight to a command, and never stored in a
 * project. The folder, image and import-source pickers open their dialog in Rust, which remembers the path:
 * `createProject`, `importAsset` and `readImportSource` accept only a path picked this way (a typed `not_picked` error otherwise).
 */
export const dialogBridge = {
  /** Native folder picker; the folder can then be passed to `createProject` (or `openProject`). Null on cancel. */
  pickFolder: () => invoke<string | null>("pick_folder"),
  /** Native file picker for one image; its path can then be passed to `importAsset`. Null on cancel. */
  pickImage: () => invoke<string | null>("pick_image"),
  /** Native file picker for a document to import; its path can then be passed to `readImportSource` (and, for Markdown, `readImportImage`). Null on cancel. */
  pickImportSource: () => invoke<string | null>("pick_import_source"),
  /** Native file picker for reference files (any type, several at once); absolute paths, only ever passed to `importReference`. */
  pickReferenceFiles: async (): Promise<string[]> => {
    const queued = await queuedDialog();
    if (queued !== undefined) return queued === null ? [] : [queued];
    const r = await open({ multiple: true, directory: false });
    return Array.isArray(r) ? r : typeof r === "string" ? [r] : [];
  },
  /** Native file picker for one font file (.ttf or .otf); absolute path, only ever passed to `fontsImport`. */
  pickFontFile: async (): Promise<string | null> => {
    const queued = await queuedDialog();
    if (queued !== undefined) return queued;
    const r = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Fonts", extensions: ["ttf", "otf"] }],
    });
    return typeof r === "string" ? r : null;
  },
};
