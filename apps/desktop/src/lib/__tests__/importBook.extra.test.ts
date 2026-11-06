import { i18n } from "@lingui/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChapterDoc } from "@cadabracraft/shared";
import type { ImportResult } from "@cadabracraft/import-docx";
import { disk } from "../../test/fakeBridge";

const state = vi.hoisted(() => ({
  markdownThrows: null as unknown,
  failStore: null as string | null,
  imageReads: [] as string[],
}));
vi.mock("@cadabracraft/import-docx", async (orig) => {
  const actual = await orig<typeof import("@cadabracraft/import-docx")>();
  return {
    ...actual,
    importMarkdown: (text: string, o: never) => {
      if (state.markdownThrows) throw state.markdownThrows;
      return actual.importMarkdown(text, o);
    },
  };
});
vi.mock("../bridge", async () =>
  (await import("../../test/fakeBridge")).fakeBridge({
    readImportSource: async () => new TextEncoder().encode("# One\n\na\n\n# Two\n\nb\n"),
    readImportImage: async (_s: string, ref: string) => {
      state.imageReads.push(ref);
      throw new Error("not found");
    },
    importAssetBytes: async (_r: string, name: string) => {
      if (state.failStore === name) throw new Error("no space");
      return `assets/${name}`;
    },
  }),
);

import { ImportError } from "@cadabracraft/import-docx";
import {
  applyChapterEdits,
  formatReport,
  groupWarnings,
  parseText,
  remapImages,
  runImport,
  titleFromFile,
  writeImport,
} from "../import/importBook";

beforeEach(() => {
  disk.clear();
  state.markdownThrows = null;
  state.failStore = null;
  state.imageReads = [];
  vi.restoreAllMocks();
});

const md = { ext: "md", bytes: new TextEncoder().encode("# T\n\nx\n") };

describe("groupWarnings and formatReport", () => {
  const warnings = [
    { code: "a", severity: "info" as const, message: "benign", line: 3 },
    { code: "a", severity: "warning" as const, message: "lost", count: 2, examples: ["e1", "e1"] },
    { code: "b", severity: "info" as const, message: "meh" },
    { code: "c", severity: "warning" as const, message: "bad" },
    { code: "c", severity: "warning" as const, message: "bad2", examples: ["x", "y", "z", "w"] },
  ];
  it("counts, upgrades severity, dedupes and caps examples, and sorts warnings first then by count", () => {
    const g = groupWarnings(warnings);
    expect(g.map((x) => [x.code, x.severity, x.count])).toEqual([
      ["a", "warning", 3],
      ["c", "warning", 2],
      ["b", "info", 1],
    ]);
    expect(g[0]!.examples).toEqual(["benign (line 3)", "e1"]);
    expect(g[1]!.examples).toEqual(["bad", "x", "y"]);
  });
  it("formats a text report, with or without warnings", () => {
    const text = formatReport({
      fileName: "b.md",
      title: "B",
      chapterCount: 2,
      imageCount: 1,
      warnings,
    });
    expect(text).toContain("Import of b.md: 2 chapter(s), 1 image(s)");
    expect(text).toContain("- [warning] a x3: benign");
    expect(text).toContain("    benign (line 3)");
    expect(
      formatReport({ fileName: "b.md", title: "B", chapterCount: 1, imageCount: 0, warnings: [] }),
    ).toMatch(/No warnings\.$/);
  });
});

describe("remapImages", () => {
  const img = (src: string, alt?: string | null) => ({ type: "image", attrs: { src, alt } });
  it("replaces mapped sources, removes null-mapped images keeping the alt text, and leaves the rest", () => {
    const doc = {
      type: "doc",
      content: [
        img("a.png"),
        img("gone.png", "A cat"),
        img("gone.png", null),
        img("other.png"),
        { type: "image", attrs: {} },
        { type: "horizontalRule" },
        { type: "paragraph", content: [{ type: "text", text: "t" }] },
      ],
    } as unknown as ChapterDoc;
    const out = remapImages(
      doc,
      new Map<string, string | null>([
        ["a.png", "assets/a.png"],
        ["gone.png", null],
      ]),
    );
    expect(out.content).toEqual([
      img("assets/a.png"),
      { type: "paragraph", content: [{ type: "text", text: "[Image: A cat]" }] },
      { type: "paragraph", content: [] },
      img("other.png"),
      { type: "image", attrs: {} },
      { type: "horizontalRule" },
      { type: "paragraph", content: [{ type: "text", text: "t" }] },
    ]);
    expect(doc.content[0]).toEqual(img("a.png")); // input is not mutated
  });
  it("passes non-object nodes through", () => {
    expect(remapImages({ type: "doc", content: [null, "s"] } as never, new Map()).content).toEqual([
      null,
      "s",
    ]);
  });
});

describe("parseText failures", () => {
  const cases: [ConstructorParameters<typeof ImportError>[0], RegExp][] = [
    ["invalid-zip", /valid \.docx/],
    ["archive-too-large", /too large to import safely/],
    ["too-many-entries", /too many parts/],
    ["missing-document", /no document body/],
    ["invalid-xml", /could not be read/],
    ["too-many-nodes", /too much content/],
    ["input-too-large", /file is too large/],
    ["too-deeply-nested", /nested too deeply/],
  ];
  it.each(cases)("describes %s", (code, re) => {
    state.markdownThrows = new ImportError(code, "raw");
    expect(() => parseText(md)).toThrow(re);
  });
  it("describes a RangeError and rethrows anything else", () => {
    state.markdownThrows = new RangeError("stack");
    expect(() => parseText(md)).toThrow(/too large or too deeply nested/);
    const other = new TypeError("bug");
    state.markdownThrows = other;
    expect(() => parseText(md)).toThrow(other);
  });
});

describe("applyChapterEdits image bookkeeping", () => {
  it("copes with images without a source and with null children", () => {
    const doc = {
      type: "doc",
      content: [
        null,
        { type: "image", attrs: {} },
        { type: "image" },
        { type: "image", attrs: { src: "a" } },
      ],
    } as unknown as ChapterDoc;
    const r = {
      chapters: [{ title: "T", doc }],
      warnings: [],
      assets: [
        { sourcePath: "a", targetPath: "a" },
        { sourcePath: "b", targetPath: "b" },
      ],
    } as unknown as ImportResult;
    expect(applyChapterEdits(r, []).assets.map((x) => x.targetPath)).toEqual(["a"]);
  });
});

describe("writeImport and runImport", () => {
  const result = (assets: ImportResult["assets"]): ImportResult => ({
    chapters: [{ title: "One", doc: { type: "doc", content: [] } as unknown as ChapterDoc }],
    warnings: [],
    assets,
  });

  it("stores embedded bytes, warns when storing fails, and tries a percent-decoded path only when it differs", async () => {
    state.failStore = "bad.png";
    const report = await writeImport({
      sourcePath: "/src/b.md",
      root: "/new",
      title: "B",
      author: "Me",
      result: result([
        { sourcePath: "x", targetPath: "assets/ok.png", bytes: Uint8Array.of(1) },
        { sourcePath: "y", targetPath: "assets/bad.png", bytes: Uint8Array.of(2) },
        { sourcePath: "pic%zz.png?v=1", targetPath: "assets/p.png" },
      ] as ImportResult["assets"]),
    });
    expect(report.imageCount).toBe(1);
    expect(report.warnings.map((w) => w.message).join("\n")).toMatch(
      /pic%zz\.png\?v=1 could not be imported: not found[\s\S]*bad\.png could not be stored: no space/,
    );
    expect(state.imageReads).toEqual(["pic%zz.png?v=1", "pic%zz.png"]);
  });

  it("falls back to en for the pseudo locale", async () => {
    vi.spyOn(i18n, "locale", "get").mockReturnValue("pseudo");
    await writeImport({
      sourcePath: "/src/b.md",
      root: "/new",
      title: "B",
      author: "Me",
      result: result([]),
    });
    expect(JSON.stringify(JSON.parse(disk.get("cadabra.json")!))).toContain('"language":"en"');
  });

  it("applies the author's chapter edits when running an import", async () => {
    const report = await runImport({
      sourcePath: "/src/b.md",
      root: "/new",
      title: "B",
      author: "Me",
      splitHeadingLevel: 1,
      edits: [
        { title: "Uno", include: true },
        { title: "Two", include: false },
      ],
    } as never);
    expect(report.chapterCount).toBe(1);
    expect(JSON.parse(disk.get("cadabra.json")!).chapters).toHaveLength(1);
  });
});

describe("titleFromFile", () => {
  it("drops the folder and extension and turns separators into spaces", () => {
    expect(titleFromFile("/a/my_great-book.docx")).toBe("my great book");
  });
});
