import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { IMAGE_EXTENSIONS } from "@cadabracraft/shared";

/**
 * Dev-automation only: an agent can queue answers for the next native dialogs (see src-tauri/src/automation.rs).
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

/** Native pickers. Every path they return is absolute, only ever passed straight to a command, and never stored in a project. */
export const dialogBridge = {
  pickFolder: async (): Promise<string | null> => {
    const queued = await queuedDialog();
    if (queued !== undefined) return queued;
    const r = await open({ directory: true, multiple: false });
    return typeof r === "string" ? r : null;
  },
  /** Native file picker for one image; returns its absolute path (only ever passed to `importAsset`, never stored). */
  pickImage: async (): Promise<string | null> => {
    const queued = await queuedDialog();
    if (queued !== undefined) return queued;
    const r = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Images", extensions: IMAGE_EXTENSIONS }],
    });
    return typeof r === "string" ? r : null;
  },
  /** Native file picker for a document to import; returns its absolute path (read-only, never stored in a project). */
  pickImportSource: async (): Promise<string | null> => {
    const queued = await queuedDialog();
    if (queued !== undefined) return queued;
    const r = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Documents", extensions: ["docx", "md", "markdown", "html", "htm"] }],
    });
    return typeof r === "string" ? r : null;
  },
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
