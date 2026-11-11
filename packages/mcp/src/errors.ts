import { FormatError } from "@cadabracraft/format";
import {
  FontNotAvailableError,
  MissingAssetError,
  PdfExportError,
  TypstCompileError,
  TypstNotFoundError,
  TypstTimeoutError,
} from "@cadabracraft/export-pdf";
import { ImportError } from "@cadabracraft/import-docx";
import { OutlineError } from "@cadabracraft/outline";
import { ProjectFsError } from "@cadabracraft/project-fs";
import { TemplateError } from "@cadabracraft/templates";
import { errMsg } from "@cadabracraft/shared";

/** Stable machine-readable error codes returned in `{ error: { code, message } }`. Documented in docs/mcp.md. */
export type ErrorCode =
  | "invalid_input"
  | "path_escape"
  | "unsafe_path"
  | "workspace_invalid"
  | "not_found"
  | "not_a_file"
  | "not_a_project"
  | "project_exists"
  | "destination_not_empty"
  | "source_invalid"
  | "too_large"
  | "invalid_manifest"
  | "invalid_file"
  | "chapter_not_found"
  | "chapter_missing"
  | "chapter_not_translated"
  | "language_not_found"
  | "language_exists"
  | "chapter_json_invalid"
  | "invalid_chapter_doc"
  | "empty_input"
  | "empty_book"
  | "import_failed"
  | "import_write_failed"
  | "template_unknown"
  | "unsupported_image"
  | "invalid_image"
  | "unsupported_reference"
  | "invalid_reference"
  | "reference_not_found"
  | "toc_no_contents_page"
  | "toc_page_exists"
  | "matter_page_exists"
  | "toc_item_not_found"
  | "text_not_found"
  | "index_entry_not_found"
  | "glossary_entry_exists"
  | "glossary_entry_not_found"
  | "asset_missing"
  | "icloud_placeholder"
  | "typst_missing"
  | "font_missing"
  | "compile_error"
  | "timeout"
  | "pdf_error"
  | "epub_error"
  | "markdown_error"
  | "docx_error"
  | "rtf_error"
  | "io_error"
  | "internal_error";

export class ToolError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ToolError";
  }
}

const FS_CODES: Record<ProjectFsError["code"], ErrorCode> = {
  unsafe_path: "unsafe_path",
  path_escape: "path_escape",
  workspace_invalid: "workspace_invalid",
  already_exists: "project_exists",
  not_found: "not_found",
  not_a_file: "not_a_file",
  icloud_placeholder: "icloud_placeholder",
  invalid_utf8: "invalid_file",
  unsupported_image: "unsupported_image",
  bad_image: "invalid_image",
  too_large: "too_large",
  unsupported_source: "source_invalid",
  image_dimensions: "invalid_image",
  unsupported_reference: "unsupported_reference",
  bad_reference: "invalid_reference",
  permission_denied: "io_error",
  disk_full: "io_error",
  io_error: "io_error",
};

/** Maps anything thrown inside a tool to a ToolError with a stable code. Never throws. */
export function toToolError(e: unknown): ToolError {
  if (e instanceof ToolError) return e;
  if (e instanceof ProjectFsError) return new ToolError(FS_CODES[e.code] ?? "io_error", e.message);
  if (e instanceof FormatError) return new ToolError("invalid_manifest", e.message);
  if (e instanceof ImportError)
    return new ToolError("import_failed", e.message, { importCode: e.code });
  if (e instanceof OutlineError)
    return new ToolError("import_failed", `${e.message} (${e.code})`, { importCode: e.code });
  if (e instanceof TemplateError) return new ToolError("template_unknown", e.message);
  // Subclasses before the PdfExportError base.
  if (e instanceof FontNotAvailableError)
    return new ToolError("font_missing", e.message, { families: e.families, role: e.role });
  if (e instanceof TypstNotFoundError) return new ToolError("typst_missing", e.message);
  if (e instanceof TypstCompileError) return new ToolError("compile_error", e.message);
  if (e instanceof TypstTimeoutError)
    return new ToolError("timeout", e.message, { seconds: e.seconds });
  if (e instanceof MissingAssetError)
    return new ToolError("asset_missing", e.message, { assets: e.srcs });
  if (e instanceof PdfExportError) return new ToolError("pdf_error", e.message);
  const err = e as NodeJS.ErrnoException | undefined;
  if (err?.code === "ENOENT") return new ToolError("not_found", err.message);
  return new ToolError("internal_error", errMsg(e));
}
