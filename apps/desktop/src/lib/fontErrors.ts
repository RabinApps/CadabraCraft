import { t } from "@lingui/core/macro";
import { errText } from "./projectError";

export type FontErrorCode =
  "network" | "checksum" | "disk-full" | "unknown" | "invalid" | "cancelled" | "other";

/** A font failure with a message written for the author and a code the screen can act on. */
export class FontUiError extends Error {
  constructor(
    public readonly code: FontErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "FontUiError";
  }
}

/** Error shapes the Rust side sends (`FontError` in src-tauri/src/fonts/error.rs). */
type RustError =
  | { kind: "network"; message: string }
  | { kind: "checksum"; file: string }
  | { kind: "disk_full" }
  | { kind: "unknown_font"; font: string }
  | { kind: "invalid_font"; message: string }
  | { kind: "cancelled" }
  | { kind: "other"; message: string };

/** Turns whatever a font command rejected with into a message for the author. */
export function describeFontError(e: unknown): FontUiError {
  if (e instanceof FontUiError) return e;
  const cause = { cause: e };
  if (e && typeof e === "object" && "kind" in e) {
    const r = e as RustError;
    switch (r.kind) {
      case "network":
        return new FontUiError(
          "network",
          t`The download failed. Check your connection and try again.`,
          cause,
        );
      case "checksum":
        return new FontUiError(
          "checksum",
          t`The downloaded file was damaged and was deleted. Try the download again.`,
          cause,
        );
      case "disk_full":
        return new FontUiError(
          "disk-full",
          t`There is not enough disk space for this font. Free some space and try again.`,
          cause,
        );
      case "unknown_font":
        return new FontUiError(
          "unknown",
          t`This font is not available any more. Choose another font.`,
          cause,
        );
      case "invalid_font":
        return new FontUiError(
          "invalid",
          t`That file is not a usable font. Choose a .ttf or .otf file.`,
          cause,
        );
      case "cancelled":
        return new FontUiError("cancelled", t`The download was cancelled.`, cause);
      case "other":
        return new FontUiError("other", t`${r.message}. Try again.`, cause);
    }
  }
  return new FontUiError("other", t`${errText(e)}. Try again.`, cause);
}
