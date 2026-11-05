import { describe, expect, it } from "vitest";
import {
  AudioTimeoutError,
  ChecksumError,
  DiskFullError,
  DownloadError,
  EncodeError,
  EngineNotFoundError,
  SynthesisError,
  VoiceNotInstalledError,
} from "@cadabracraft/export-audio";
import { MissingAssetError, TypstCompileError, TypstTimeoutError } from "@cadabracraft/export-pdf";
import type { ImportErrorCode } from "@cadabracraft/import-docx";
import { describeAudioError } from "../audioErrors";
import { describeFontError } from "../fontErrors";
import { describeImportCode, describeOutlineCode } from "../importErrorText";
import { describePdfError } from "../pdfErrors";
import { errText, projectErrorMessage, type ProjectError } from "../projectError";

/** WCAG 3.3.3: a message that says what went wrong also says what to do next. */
const NEXT_STEP =
  /(try again|choose another|choose a|free some space|restore it|reinstall|not open|reopen|download|split|simplify|add the image|check|move the real|save it as|open it in|saving still works)/i;

const PATH = { path: "a/b.json" };
const MUST_HAVE_STEP: ProjectError[] = [
  { kind: "path_escape", ...PATH },
  { kind: "not_found", ...PATH },
  { kind: "not_utf8", ...PATH },
  { kind: "icloud_pending", ...PATH },
  { kind: "too_large", ...PATH, max_mb: 5 },
  { kind: "invalid_image", name: "x.png", ext: "png" },
  { kind: "permission_denied", ...PATH },
  { kind: "disk_full", ...PATH },
  { kind: "invalid_manifest" },
  { kind: "watch_failed", ...PATH },
  { kind: "import_docx", code: "invalid-zip" },
  { kind: "io", message: "boom" },
];

describe("every message says what to do next", () => {
  it.each(MUST_HAVE_STEP)("project error $kind", (c) => {
    expect(projectErrorMessage(c)).toMatch(NEXT_STEP);
  });
  it.each<ImportErrorCode>([
    "invalid-zip",
    "archive-too-large",
    "too-many-entries",
    "missing-document",
    "invalid-xml",
    "too-many-nodes",
    "input-too-large",
    "too-deeply-nested",
  ])("import code %s", (code) => {
    expect(describeImportCode(code)).toMatch(NEXT_STEP);
  });
  it.each(["too-large", "malformed", "not-opml", "not-csv", "too-many", "empty"] as const)(
    "outline code %s",
    (code) => {
      expect(describeOutlineCode(code)).toMatch(NEXT_STEP);
    },
  );
  it.each<[string, unknown]>([
    ["compile", new TypstCompileError("bad")],
    ["timeout", new TypstTimeoutError(5)],
    ["asset", new MissingAssetError(["a.png"])],
    ["other", new Error("weird")],
  ])("pdf %s", (_n, e) => {
    expect(describePdfError(e).message).toMatch(NEXT_STEP);
  });
  it.each<[string, unknown]>([
    ["voice-missing", new VoiceNotInstalledError("amy")],
    ["engine-missing", new EngineNotFoundError("/x")],
    ["engine-failed", new SynthesisError("x")],
    ["encode", new EncodeError("flac", "x")],
    ["download", new DownloadError("offline")],
    ["checksum", new ChecksumError("a")],
    ["disk-full", new DiskFullError()],
    ["timeout", new AudioTimeoutError(3)],
    ["other", new Error("weird")],
  ])("audio %s", (_n, e) => {
    expect(describeAudioError(e).message).toMatch(NEXT_STEP);
  });
  it.each([
    { kind: "network", message: "x" },
    { kind: "checksum", file: "a" },
    { kind: "disk_full" },
    { kind: "unknown_font", font: "x" },
    { kind: "invalid_font", message: "x" },
    { kind: "other", message: "x" },
    new Error("plain"),
  ])("font %j", (e) => {
    expect(describeFontError(e).message).toMatch(NEXT_STEP);
  });
  it("errText carries the next step for a bridge io error", () => {
    expect(errText({ kind: "io", message: "boom" })).toMatch(/boom\. Try again/);
  });
});
