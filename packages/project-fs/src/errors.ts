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
  | "too_large"
  | "unsupported_source"
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

/** Wraps an unexpected fs error, keeping ProjectFsError and mapping ENOENT to `not_found`. */
export function fsError(e: unknown, label?: string): ProjectFsError {
  if (e instanceof ProjectFsError) return e;
  const err = e as NodeJS.ErrnoException;
  const text = label ? `${label}: ${err.message ?? String(e)}` : (err.message ?? String(e));
  return new ProjectFsError(err.code === "ENOENT" ? "not_found" : "io_error", text);
}

export const isNotFound = (e: unknown): boolean => (e as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
