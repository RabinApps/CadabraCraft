// Pure-function gaps: error mapping, plain-text rendering, image remapping and the warning grouping.
import { describe, expect, it } from "vitest";
import { FormatError } from "@cadabracraft/format";
import {
  FontNotAvailableError,
  MissingAssetError,
  PdfExportError,
  TypstCompileError,
  TypstNotFoundError,
  TypstTimeoutError,
} from "@cadabracraft/export-pdf";
import { ImportError, type ImportWarning } from "@cadabracraft/import-docx";
import { ProjectFsError, type ProjectFsErrorCode } from "@cadabracraft/project-fs";
import { TemplateError } from "@cadabracraft/templates";
import type { ChapterDoc } from "@cadabracraft/shared";
import { docToText, remapImages } from "../doc";
import { ToolError, toToolError } from "../errors";
import { decodeSourceText, groupWarnings } from "../tools/import";

describe("toToolError", () => {
  it("passes a ToolError through", () => {
    const e = new ToolError("not_found", "x");
    expect(toToolError(e)).toBe(e);
  });

  it("maps every project-fs code to a stable tool code", () => {
    const expected: Record<ProjectFsErrorCode, string> = {
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
      image_dimensions: "invalid_image",
      unsupported_reference: "unsupported_reference",
      bad_reference: "invalid_reference",
      too_large: "too_large",
      unsupported_source: "source_invalid",
      permission_denied: "io_error",
      disk_full: "io_error",
      io_error: "io_error",
    };
    for (const [code, tool] of Object.entries(expected))
      expect(toToolError(new ProjectFsError(code as ProjectFsErrorCode, "m")).code, code).toBe(
        tool,
      );
  });

  it("falls back to io_error for a project-fs code it does not know", () => {
    expect(toToolError(new ProjectFsError("brand_new" as ProjectFsErrorCode, "m")).code).toBe(
      "io_error",
    );
  });

  it("maps format, import and template errors", () => {
    expect(toToolError(new FormatError("bad")).code).toBe("invalid_manifest");
    const imp = toToolError(new ImportError("not-a-docx" as never, "bad file"));
    expect(imp.code).toBe("import_failed");
    expect(imp.details).toEqual({ importCode: "not-a-docx" });
    expect(toToolError(new TemplateError("nope")).code).toBe("template_unknown");
  });

  it("maps the PDF errors, subclasses before the base class, with their details", () => {
    const font = toToolError(new FontNotAvailableError(["Garamond"], "body"));
    expect([font.code, font.details]).toEqual([
      "font_missing",
      { families: ["Garamond"], role: "body" },
    ]);
    expect(toToolError(new TypstNotFoundError("PATH")).code).toBe("typst_missing");
    expect(toToolError(new TypstCompileError("boom")).code).toBe("compile_error");
    const timeout = toToolError(new TypstTimeoutError(30));
    expect([timeout.code, timeout.details]).toEqual(["timeout", { seconds: 30 }]);
    const asset = toToolError(new MissingAssetError(["assets/a.png"]));
    expect([asset.code, asset.details]).toEqual(["asset_missing", { assets: ["assets/a.png"] }]);
    expect(toToolError(new PdfExportError("other")).code).toBe("pdf_error");
  });

  it("maps a bare ENOENT, and anything else is internal_error", () => {
    expect(toToolError(Object.assign(new Error("gone"), { code: "ENOENT" })).code).toBe(
      "not_found",
    );
    expect(toToolError(new Error("boom")).code).toBe("internal_error");
    expect(toToolError("just text").message).toBe("just text");
    expect(toToolError(undefined).code).toBe("internal_error");
  });
});

const t = (text: string) => ({ type: "text", text });
const p = (...c: unknown[]) => ({ type: "paragraph", content: c });

describe("docToText", () => {
  it("renders lists with their numbering, nested blocks and empty items", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [p(t("a")), p(t("b"))] }, { type: "listItem" }],
        },
        {
          type: "orderedList",
          attrs: { start: 3 },
          content: [
            { type: "listItem", content: [p(t("x"))] },
            { type: "listItem", content: [p(t("y"))] },
          ],
        },
        { type: "orderedList", content: [{ type: "listItem", content: [p(t("z"))] }] },
        { type: "bulletList" },
      ],
    };
    expect(docToText(doc)).toBe("- a\n  b\n\n\n3. x\n4. y\n\n1. z");
  });

  it("renders quotes, footnotes, scene breaks, tables and images", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "blockquote", content: [p(t("q1")), p(t("q2"))] },
        { type: "blockquote" },
        p(t("see"), { type: "footnote", content: [t("the note")] }, { type: "footnote" }),
        { type: "sceneBreak" },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableHeader", content: [p(t("A")), p(t("B  C"))] },
                { type: "tableHeader" },
              ],
            },
            { type: "tableRow" },
          ],
        },
        { type: "table" },
        { type: "image", attrs: { alt: "A cat", title: "Photo" } },
        { type: "image" },
      ],
    };
    expect(docToText(doc)).toBe(
      [
        "> q1\n> \n> q2",
        "> ",
        "see [note: the note]  [note: ] ",
        "* * *",
        "A B C | \n",
        "",
        "[Image: A cat] Photo",
        "[Image: ]",
      ].join("\n\n"),
    );
  });

  it("is empty for something that is not a document", () => {
    expect(docToText(undefined)).toBe("");
    expect(docToText({ type: "doc" })).toBe("");
  });
});

describe("remapImages", () => {
  const image = (src: string, alt?: string | null) => ({ type: "image", attrs: { src, alt } });
  const doc = (...content: unknown[]) => ({ type: "doc", content }) as ChapterDoc;

  it("re-points, drops (keeping the alt text) and leaves other images alone", () => {
    const map = new Map<string, string | null>([
      ["a.png", "assets/a.png"],
      ["b.png", null],
      ["c.png", null],
    ]);
    const out = remapImages(
      doc(image("a.png"), image("b.png", "Bee"), image("c.png"), image("d.png")),
      map,
    );
    expect(out.content).toEqual([
      image("assets/a.png"),
      p({ type: "text", text: "[Image: Bee]" }),
      p(),
      image("d.png"),
    ]);
  });

  it("walks nested content, and tolerates values that are not nodes", () => {
    const map = new Map<string, string | null>([["a.png", "assets/a.png"]]);
    const input = doc(
      { type: "blockquote", content: [image("a.png"), null, "text"] },
      { type: "image" },
    );
    const out = remapImages(input, map);
    expect(out.content[0]).toEqual({
      type: "blockquote",
      content: [image("assets/a.png"), null, "text"],
    });
    expect(out.content[1]).toEqual({ type: "image" });
    expect((input.content[0] as { content: unknown[] }).content[0]).toEqual(image("a.png"));
  });
});

describe("groupWarnings", () => {
  const w = (over: Partial<ImportWarning>): ImportWarning => ({
    code: "c",
    severity: "info",
    message: "m",
    ...over,
  });

  it("raises a group to warning, sums counts and lists up to three distinct examples", () => {
    const groups = groupWarnings([
      w({ severity: "info", count: 2, examples: ["e1", "e2"] }),
      w({ severity: "warning", examples: ["e2", "e3", "e4"] }),
      w({ message: "plain", line: 4 }),
      w({ code: "other", message: "no line" }),
    ]);
    expect(groups[0]).toMatchObject({
      code: "c",
      severity: "warning",
      count: 4,
      examples: ["e1", "e2", "e3"],
    });
    expect(groups[1]).toMatchObject({ code: "other", count: 1, examples: ["no line"] });
  });

  it("describes an example by its line when the warning has none", () => {
    expect(groupWarnings([w({ message: "odd", line: 7 })])[0]!.examples).toEqual(["odd (line 7)"]);
  });

  it("puts warnings before info, then bigger counts first", () => {
    const codes = groupWarnings([
      w({ code: "i1", count: 5 }),
      w({ code: "w1", severity: "warning", count: 1 }),
      w({ code: "w2", severity: "warning", count: 3 }),
      w({ code: "i2", count: 9 }),
    ]).map((g) => g.code);
    expect(codes).toEqual(["w2", "w1", "i2", "i1"]);
  });
});

describe("decodeSourceText", () => {
  it("reads UTF-16 with a byte order mark in either order", () => {
    const le = new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]);
    const be = new Uint8Array([0xfe, 0xff, 0x00, 0x68, 0x00, 0x69]);
    expect(decodeSourceText(le, "a.md")).toBe("hi");
    expect(decodeSourceText(be, "a.md")).toBe("hi");
  });
  it("drops a UTF-8 byte order mark", () => {
    expect(decodeSourceText(new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]), "a.md")).toBe("hi");
  });
  it("refuses NUL bytes and invalid UTF-8 with an explanation", () => {
    expect(() => decodeSourceText(new Uint8Array([0x68, 0x00, 0x69, 0x00]), "a.md")).toThrow(
      /NUL bytes/,
    );
    expect(() => decodeSourceText(new Uint8Array([0xe9, 0x20]), "a.md")).toThrow(/not valid UTF-8/);
  });
});
