import { invoke } from "@tauri-apps/api/core";

/**
 * Native pickers. Every path they return is absolute, only ever passed straight to a command, and never stored in a
 * project. Every picker opens its dialog in Rust, which remembers the path: `createProject`, `importAsset`,
 * `readImportSource`, `importReference` and `fontsImport` accept only a path picked this way (a typed `not_picked`
 * error, or `invalid_font` for fonts, otherwise). Files dropped on the window are remembered by Rust as well.
 */
export const dialogBridge = {
  /** Native folder picker; the folder can then be passed to `createProject` (or `openProject`). Null on cancel. */
  pickFolder: () => invoke<string | null>("pick_folder"),
  /** Native file picker for one image; its path can then be passed to `importAsset`. Null on cancel. */
  pickImage: () => invoke<string | null>("pick_image"),
  /** Native file picker for a document to import; its path can then be passed to `readImportSource` (and, for Markdown, `readImportImage`). Null on cancel. */
  pickImportSource: () => invoke<string | null>("pick_import_source"),
  /** Native file picker for reference files (any type, several at once); the paths can then be passed to `importReference`. Empty on cancel. */
  pickReferenceFiles: () => invoke<string[]>("pick_reference_files"),
  /** Native file picker for one font file (.ttf or .otf); its path can then be passed to `fontsImport`. Null on cancel. */
  pickFontFile: () => invoke<string | null>("pick_font_file"),
};
