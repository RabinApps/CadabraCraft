import { t } from "@lingui/core/macro";
import { errMsg } from "@cadabracraft/shared";
import type { ImportErrorCode } from "@cadabracraft/import-docx";
import { describeImportCode } from "./import/importErrorText";

/** What the Rust file commands reject with (`ProjectError` in src-tauri/src/project/error.rs). */
export type ProjectError =
  | { kind: "unsafe_path"; path: string }
  | { kind: "path_escape"; path: string }
  | { kind: "not_found"; path: string }
  | { kind: "already_exists" }
  | { kind: "not_a_project"; path: string }
  | { kind: "not_utf8"; path: string }
  | { kind: "icloud_pending"; path: string }
  | { kind: "too_large"; path: string; max_mb: number }
  | { kind: "not_a_file"; path: string }
  | { kind: "unsupported_image"; name: string }
  | { kind: "invalid_image"; name: string; ext: string }
  | { kind: "unsupported_document"; name: string }
  | { kind: "not_image_asset"; path: string }
  | { kind: "unsupported_reference"; name: string }
  | { kind: "invalid_reference"; name: string; ext: string }
  | { kind: "not_reference"; path: string }
  | { kind: "not_trash_path"; path: string }
  | { kind: "cannot_restore"; path: string }
  | { kind: "image_ref_not_allowed"; reference: string }
  | { kind: "image_ref_not_found"; reference: string }
  | { kind: "image_ref_outside"; reference: string }
  | { kind: "invalid_file_name" }
  | { kind: "not_picked"; name: string }
  | { kind: "permission_denied"; path: string }
  | { kind: "disk_full"; path: string }
  | { kind: "image_dimensions"; name: string; max_megapixels: number }
  | { kind: "invalid_manifest" }
  | { kind: "watch_failed"; path: string }
  /** The Rust `.docx` importer refused the file; `code` is an `ImportErrorCode`. */
  | { kind: "import_docx"; code: ImportErrorCode }
  | { kind: "io"; message: string };

const KINDS = new Set<string>([
  "unsafe_path",
  "path_escape",
  "not_found",
  "already_exists",
  "not_a_project",
  "not_utf8",
  "icloud_pending",
  "too_large",
  "not_a_file",
  "unsupported_image",
  "invalid_image",
  "unsupported_document",
  "not_image_asset",
  "unsupported_reference",
  "invalid_reference",
  "not_reference",
  "not_trash_path",
  "cannot_restore",
  "image_ref_not_allowed",
  "image_ref_not_found",
  "image_ref_outside",
  "invalid_file_name",
  "not_picked",
  "permission_denied",
  "disk_full",
  "image_dimensions",
  "invalid_manifest",
  "watch_failed",
  "import_docx",
  "io",
]);

/** True for a rejection from a Rust file command. (`TypstError` also uses `not_found`, but with a `message` and no `path`.) */
export function isProjectError(e: unknown): e is ProjectError {
  if (!e || typeof e !== "object" || e instanceof Error) return false;
  const kind = (e as { kind?: unknown }).kind;
  if (typeof kind !== "string" || !KINDS.has(kind)) return false;
  return kind !== "not_found" || typeof (e as { path?: unknown }).path === "string";
}

type Messages = { [K in ProjectError["kind"]]: (e: Extract<ProjectError, { kind: K }>) => string };

/** The localized sentence of each kind of failure. */
const MESSAGES: Messages = {
  unsafe_path: (e) => t`Unsafe project path: ${e.path}`,
  path_escape: (e) =>
    t`${e.path} leaves the project folder through a symbolic link. Move the real file into the book's folder and try again.`,
  not_found: (e) =>
    t`${e.path} does not exist. Choose another file, or restore it from History if it was removed.`,
  already_exists: () => t`A project already exists in this folder`,
  not_a_project: (e) => t`${e.path} is not a CadabraCraft project folder`,
  not_utf8: (e) =>
    t`${e.path} is not valid UTF-8 text. Choose another file, or save it as UTF-8 and try again.`,
  icloud_pending: (e) => t`${e.path} is still downloading from iCloud; try again in a moment`,
  too_large: (e) => t`${e.path} is larger than ${e.max_mb} MB. Choose a smaller file.`,
  not_a_file: (e) => t`${e.path} is not a file`,
  unsupported_image: (e) => t`Unsupported image type: ${e.name}`,
  invalid_image: (e) => t`${e.name} is not a valid ${e.ext} image. Choose another image file.`,
  unsupported_document: (e) =>
    t`${e.name} is not a .docx, .md, .markdown, .html, .htm or .txt file`,
  not_image_asset: (e) => t`Not an image in the assets folder: ${e.path}`,
  unsupported_reference: (e) => t`${e.name} is a type of file that cannot be added as a reference`,
  invalid_reference: (e) => t`${e.name} is not a valid ${e.ext} file`,
  not_reference: (e) => t`Not a reference file: ${e.path}`,
  not_trash_path: (e) => t`Not a page in the trash: ${e.path}`,
  cannot_restore: (e) => t`Cannot restore ${e.path}`,
  image_ref_not_allowed: (e) => t`This image path is not allowed: ${e.reference}`,
  image_ref_not_found: (e) => t`Image not found: ${e.reference}`,
  image_ref_outside: (e) => t`The image ${e.reference} is outside the document's folder`,
  invalid_file_name: () => t`That file name is not valid`,
  not_picked: (e) => t`${e.name} was not chosen in a file or folder dialog`,
  permission_denied: (e) =>
    t`CadabraCraft does not have permission to use ${e.path}. Check the file is not open elsewhere and that your account can change it, then try again.`,
  disk_full: (e) =>
    t`There is no space left on the disk to write ${e.path}. Free some space and try again.`,
  image_dimensions: (e) => t`${e.name} is larger than ${e.max_megapixels} megapixels`,
  invalid_manifest: () =>
    t`The book's cadabra.json is not a JSON object. Restore it from History or from a backup in .cadabra/backups.`,
  watch_failed: (e) =>
    t`Cannot watch ${e.path} for changes made outside the app. Saving still works; reopen the book to try again.`,
  import_docx: (e) => describeImportCode(e.code),
  io: (e) => t`${e.message}. Try again, and check the file is not open in another program.`,
};

/** The localized sentence for a Rust file-command failure. `io` carries the operating system's own message. */
export function projectErrorMessage(e: ProjectError): string {
  return (MESSAGES[e.kind] as (e: ProjectError) => string)(e);
}

/** What opening a folder without a cadabra.json fails with. Home compares against it to tell "folder gone" from other failures. */
export const noManifestMessage = (): string => t`No cadabra.json in that folder`;

/** True when opening a book failed because the folder is gone or holds no book, as opposed to a book that could not be read. */
export function isMissingFolder(e: unknown): boolean {
  if (isProjectError(e)) return e.kind === "not_found" || e.kind === "not_a_project";
  return e instanceof Error && e.message === noManifestMessage();
}

/** `errText` without its closing full stop, for putting inside a longer sentence. */
export const whyText = (e: unknown): string => errText(e).replace(/[.\s]+$/, "");

/**
 * Only the cause, for a sentence that gives its own next step: the "Try again, and check the file is not open elsewhere" that
 * an unexplained OS error gets on its own is left off, so the step is not said twice.
 */
export const causeText = (e: unknown): string =>
  isProjectError(e) && e.kind === "io" ? e.message.replace(/[.\s]+$/, "") : whyText(e);

/** Message of anything a bridge call can reject with: a Rust `ProjectError`, any `{ message }` object, an Error or a string. */
export function errText(e: unknown): string {
  if (isProjectError(e)) return projectErrorMessage(e);
  if (
    e &&
    typeof e === "object" &&
    !(e instanceof Error) &&
    typeof (e as { message?: unknown }).message === "string"
  )
    return (e as { message: string }).message;
  return errMsg(e);
}
