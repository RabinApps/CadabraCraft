// Edge cases for hand-written JSON and unusual options (no typst needed). Fake typst binaries are shell scripts.
import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DocNode } from "@cadabracraft/shared";
import { getTemplate } from "@cadabracraft/templates";
import {
  PdfExportError,
  TypstCompileError,
  TypstNotFoundError,
  TypstTimeoutError,
} from "../errors";
import { createNodeRunner, findTypst } from "../node";
import { assertNoUnknownFont } from "../runner";
import { buildTypst, resolveFonts } from "../typst";
import { preamble } from "../typst/preamble";
import type { PdfChapter, PdfOptions } from "../types";

const book = { title: "B", author: "A", language: "en" };
const node = (type: string, rest: object = {}): DocNode => ({ type, ...rest }) as DocNode;
const chapter = (...content: DocNode[]): PdfChapter[] => [
  { id: "c", title: "C", doc: { type: "doc", content } },
];
const build = (...content: DocNode[]) => buildTypst(book, chapter(...content));
const text = (t: string): DocNode => ({ type: "text", text: t });
const cell = (type = "tableCell", content?: DocNode[]) => node(type, content ? { content } : {});
const para = (t = "x") => node("paragraph", { content: [text(t)] });
const row = (...cells: DocNode[]) => node("tableRow", { content: cells });
const table = (...rows: DocNode[]) => node("table", { content: rows });

describe("block edge cases", () => {
  it("rejects a source with no recognisable image extension", () => {
    expect(() => build(node("image", { attrs: { src: "noextension" } }))).toThrow(
      /Unsupported image type/,
    );
  });
  it("rejects an image without attrs or src", () => {
    expect(() => build(node("image"))).toThrow(/Image without a source/);
  });
  it("renders headings without attrs as level 1, and empty containers as empty", () => {
    expect(build(node("heading", { content: [text("H")] }))).toContain("#heading(level: 1)[H]");
    expect(build(node("blockquote"))).toContain("#quote(block: true)[\n\n]");
    expect(build(node("bulletList"))).toContain("#list(\n,\n)");
    expect(build(node("codeBlock"))).toContain('#raw(block: true, "")');
    expect(build(node("paragraph"))).not.toContain("undefined");
  });
  it("rejects a list child that is not a list item", () => {
    expect(() => build(node("bulletList", { content: [para()] }))).toThrow(
      /Unsupported node type in chapter: paragraph/,
    );
  });
  it("rejects table structure problems", () => {
    expect(() => build(table(para()))).toThrow(/Unsupported node type in chapter: paragraph/);
    expect(() => build(table(row(para())))).toThrow(/Unsupported node type in chapter: paragraph/);
    expect(() => build(table(node("tableRow")))).toThrow(/non-zero/);
    expect(() => build(table(row(cell("tableCell", [node("bulletList")]))))).toThrow(
      /Unsupported node in a table cell/,
    );
  });
  it("accepts cells without content and bolds header cells outside the header row", () => {
    const src = build(
      table(row(cell("tableHeader", [para("h")])), row(cell("tableHeader", [para("i")]))),
    );
    expect(src).toContain("table.header([h])");
    expect(src).toContain("#strong[i]");
    expect(build(table(row(cell())))).toContain("#table(");
  });
  it("renders footnotes without content and with paragraph children", () => {
    const fn = (...c: DocNode[]) =>
      node("paragraph", { content: [node("footnote", { content: c })] });
    expect(build(node("paragraph", { content: [node("footnote")] }))).toContain("#footnote[]");
    expect(build(fn())).toContain("#footnote[]");
    expect(build(fn(para("note")))).toContain("#footnote[note]");
    expect(build(fn(text("raw")))).toContain("#footnote[raw]");
  });
});

describe("options edge cases", () => {
  it("rejects an unknown trim size", () => {
    expect(() =>
      buildTypst(book, chapter(para()), { trimSize: "bogus" } as unknown as PdfOptions),
    ).toThrow(/Unknown trim size "bogus"/);
  });
  it("preamble itself refuses an unknown trim size (buildTypst checks first, so call it directly)", () => {
    const fonts = { body: "B", heading: "H" };
    const margins = { top: 1, bottom: 1, inside: 1, outside: 1 };
    expect(() =>
      preamble(
        book,
        getTemplate("novel"),
        { trimSize: "bogus" } as unknown as PdfOptions,
        fonts,
        margins,
        false,
      ),
    ).toThrow(/Unknown trim size "bogus"/);
  });
  it("omits lang for a missing or unparseable language", () => {
    const noLang = { title: "B", author: "A" } as unknown as typeof book;
    for (const b of [noLang, { ...book, language: "1" }])
      expect(buildTypst(b, chapter(para()))).not.toContain(", lang:");
  });
  it("uses the template's heading fonts when no override is given", () => {
    const t = structuredClone(getTemplate("novel"));
    t.print.headingFonts = ["Heading Font"];
    expect(
      resolveFonts({ template: t } as PdfOptions, ["Heading Font", ...t.print.bodyFonts]),
    ).toMatchObject({
      heading: "Heading Font",
    });
  });
  it("treats a front or back page without a kind as custom", () => {
    const pages: PdfChapter[] = [
      { id: "f", title: "F", doc: { type: "doc", content: [para()] }, section: "front" },
      { id: "c", title: "C", doc: { type: "doc", content: [para()] } },
      { id: "b", title: "B", doc: { type: "doc", content: [para()] }, section: "back" },
    ];
    expect(() => buildTypst(book, pages)).not.toThrow();
  });
});

describe("assertNoUnknownFont", () => {
  it("falls back to 'unknown' when the warning names no family", () => {
    expect(() => assertNoUnknownFont("warning: unknown font family")).toThrow(
      /could not find font "unknown"/,
    );
  });
});

// The fake binaries are POSIX shell scripts, which Windows cannot run; the win32 lookup is tested here by faking the platform.
describe.skipIf(process.platform === "win32")("node runner with fake typst binaries", () => {
  let dir = "";
  const sh = (name: string, body: string): string => {
    dir ||= mkdtempSync(join(tmpdir(), "cc-fake-typst-"));
    const p = join(dir, name);
    writeFileSync(p, `#!/bin/sh\n${body}\n`);
    chmodSync(p, 0o755);
    return p;
  };
  const env = { path: process.env.PATH, bin: process.env.TYPST_BIN };
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
    if (env.path === undefined) delete process.env.PATH;
    else process.env.PATH = env.path;
    if (env.bin === undefined) delete process.env.TYPST_BIN;
    else process.env.TYPST_BIN = env.bin;
    Object.defineProperty(process, "platform", platform);
  });

  it("finds typst on PATH, skipping directories and empty entries", () => {
    const real = sh("typst", "exit 0");
    mkdirSync(join(dir, "sub", "typst"), { recursive: true });
    delete process.env.TYPST_BIN;
    process.env.PATH = ["", join(dir, "sub"), dir].join(":");
    expect(findTypst()).toBe(real);
  });
  it("searches for typst.exe, typst.cmd and typst on win32", () => {
    const real = sh("typst.cmd", "exit 0");
    delete process.env.TYPST_BIN;
    process.env.PATH = dir;
    Object.defineProperty(process, "platform", { value: "win32" });
    expect(findTypst()).toBe(real);
  });
  it("copes with PATH being unset", () => {
    delete process.env.TYPST_BIN;
    delete process.env.PATH;
    expect(() => findTypst()).toThrow(TypstNotFoundError);
  });
  it("lists fonts, passing --font-path, and wraps a failure", async () => {
    const ok = sh("ok", 'for a in "$@"; do echo "$a"; done');
    const fonts = await createNodeRunner({ typstPath: ok, fontPaths: ["/f"] }).listFonts();
    expect(fonts).toEqual(["fonts", "--font-path", "/f"]);
    const bad = sh("bad", "echo boom >&2; exit 3");
    await expect(createNodeRunner({ typstPath: bad }).listFonts()).rejects.toThrow(
      /Could not list fonts with typst/,
    );
  });
  const compile = (typstPath: string, timeoutMs?: number) =>
    createNodeRunner({ typstPath, ...(timeoutMs ? { timeoutMs } : {}) }).compile("x", new Map(), {
      pdfA: false,
    });
  it("reports a timeout", async () => {
    await expect(compile(sh("slow", "sleep 5"), 100)).rejects.toThrow(TypstTimeoutError);
  });
  it("reports compile errors with stderr, or the exec error when stderr is empty", async () => {
    await expect(compile(sh("err", "echo broken >&2; exit 1"))).rejects.toThrow(/broken/);
    await expect(compile(sh("quiet", "exit 1"))).rejects.toThrow(TypstCompileError);
  });
  it("reports a clean exit that wrote no PDF", async () => {
    await expect(compile(sh("empty", "exit 0"))).rejects.toThrow(/without producing a PDF/);
  });
  it("keeps the temp directory when asked", async () => {
    const empty = sh("keep", "exit 0");
    const savedTmp = process.env.TMPDIR;
    process.env.TMPDIR = dir;
    try {
      await expect(
        createNodeRunner({ typstPath: empty, keepTemp: true }).compile("x", new Map(), {
          pdfA: false,
        }),
      ).rejects.toThrow(TypstCompileError);
      expect(readdirSync(dir).some((n) => n.startsWith("cadabracraft-pdf-"))).toBe(true);
    } finally {
      if (savedTmp === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = savedTmp;
    }
  });
  it("keeps PdfExportError instances distinguishable", async () => {
    await expect(compile(sh("empty2", "exit 0"))).rejects.toBeInstanceOf(PdfExportError);
  });
});
