import { t } from "@lingui/core/macro";
import { errMsg } from "@cadabracraft/shared";

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
  | { kind: "permission_denied"; path: string }
  | { kind: "disk_full"; path: string }
  | { kind: "image_dimensions"; name: string; max_megapixels: number }
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
  "permission_denied",
  "disk_full",
  "image_dimensions",
  "io",
]);

/** True for a rejection from a Rust file command. (`TypstError` also uses `not_found`, but with a `message` and no `path`.) */
export function isProjectError(e: unknown): e is ProjectError {
  if (!e || typeof e !== "object" || e instanceof Error) return false;
  const kind = (e as { kind?: unknown }).kind;
  if (typeof kind !== "string" || !KINDS.has(kind)) return false;
  return kind !== "not_found" || typeof (e as { path?: unknown }).path === "string";
}

/** The localized sentence for a Rust file-command failure. `io` carries the operating system's own message. */
export function projectErrorMessage(e: ProjectError): string {
  switch (e.kind) {
    case "unsafe_path":
      return t`Unsafe project path: ${e.path}`;
    case "path_escape":
      return t`${e.path} leaves the project folder through a symbolic link`;
    case "not_found":
      return t`${e.path} does not exist`;
    case "already_exists":
      return t`A project already exists in this folder`;
    case "not_a_project":
      return t`${e.path} is not a CadabraCraft project folder`;
    case "not_utf8":
      return t`${e.path} is not valid UTF-8 text`;
    case "icloud_pending":
      return t`${e.path} is still downloading from iCloud; try again in a moment`;
    case "too_large":
      return t`${e.path} is larger than ${e.max_mb} MB`;
    case "not_a_file":
      return t`${e.path} is not a file`;
    case "unsupported_image":
      return t`Unsupported image type: ${e.name}`;
    case "invalid_image":
      return t`${e.name} is not a valid ${e.ext} image`;
    case "unsupported_document":
      return t`${e.name} is not a .docx, .md, .markdown, .html, .htm or .txt file`;
    case "not_image_asset":
      return t`Not an image in the assets folder: ${e.path}`;
    case "unsupported_reference":
      return t`${e.name} is a type of file that cannot be added as a reference`;
    case "invalid_reference":
      return t`${e.name} is not a valid ${e.ext} file`;
    case "not_reference":
      return t`Not a reference file: ${e.path}`;
    case "not_trash_path":
      return t`Not a page in the trash: ${e.path}`;
    case "cannot_restore":
      return t`Cannot restore ${e.path}`;
    case "image_ref_not_allowed":
      return t`This image path is not allowed: ${e.reference}`;
    case "image_ref_not_found":
      return t`Image not found: ${e.reference}`;
    case "image_ref_outside":
      return t`The image ${e.reference} is outside the document's folder`;
    case "invalid_file_name":
      return t`That file name is not valid`;
    case "permission_denied":
      return t`CadabraCraft does not have permission to use ${e.path}`;
    case "disk_full":
      return t`There is no space left on the disk to write ${e.path}`;
    case "image_dimensions":
      return t`${e.name} is larger than ${e.max_megapixels} megapixels`;
    case "io":
      return e.message;
  }
}

/** What opening a folder without a cadabra.json fails with. Home compares against it to tell "folder gone" from other failures. */
export const noManifestMessage = (): string => t`No cadabra.json in that folder`;

/** True when opening a book failed because the folder is gone or holds no book, as opposed to a book that could not be read. */
export function isMissingFolder(e: unknown): boolean {
  if (isProjectError(e)) return e.kind === "not_found" || e.kind === "not_a_project";
  return e instanceof Error && e.message === noManifestMessage();
}

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
