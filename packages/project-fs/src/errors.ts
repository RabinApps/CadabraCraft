export type ProjectFsErrorCode =
  | "unsafe_path"
  | "path_escape"
  | "workspace_invalid"
  | "already_exists"
  | "not_found"
  | "not_a_file"
  | "icloud_placeholder"
  | "invalid_utf8"
  | "unsupported_image"
  | "bad_image"
  | "image_dimensions"
  | "too_large"
  | "unsupported_source"
  | "permission_denied"
  | "disk_full"
  | "io_error";

/** Every failure in this package carries a stable `code`; messages mirror the Rust layer's wording where one exists. */
export class ProjectFsError extends Error {
  constructor(
    readonly code: ProjectFsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProjectFsError";
  }
}

/**
 * Wraps an unexpected fs error, keeping ProjectFsError. Mirrors `io_error` in the Rust layer: ENOENT is `not_found`,
 * EACCES/EPERM/EROFS `permission_denied`, ENOSPC/EDQUOT `disk_full`, EISDIR/ENOTDIR `not_a_file`, the rest `io_error`.
 */
export function fsError(e: unknown, label?: string): ProjectFsError {
  if (e instanceof ProjectFsError) return e;
  const err = e as NodeJS.ErrnoException;
  const text = label ? `${label}: ${err.message ?? String(e)}` : (err.message ?? String(e));
  switch (err.code) {
    case "ENOENT":
      return new ProjectFsError("not_found", text);
    case "EACCES":
    case "EPERM":
    case "EROFS":
      return new ProjectFsError("permission_denied", text);
    case "ENOSPC":
    case "EDQUOT":
      return new ProjectFsError("disk_full", text);
    case "EISDIR":
    case "ENOTDIR":
      return new ProjectFsError("not_a_file", text);
    default:
      return new ProjectFsError("io_error", text);
  }
}

export const isNotFound = (e: unknown): boolean =>
  (e as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
