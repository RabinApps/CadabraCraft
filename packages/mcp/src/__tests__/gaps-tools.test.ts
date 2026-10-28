// Tool behaviour that the main suites leave out: damaged or unusual projects, translations, odd EPUBs and PDFs, imports that fail half way.
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import {
  addEdition,
  chapterFileName,
  parseManifest,
  serializeManifest,
  type Manifest,
} from "@cadabracraft/format";
import { type Session, connect, docxPara, gradientPng, makeDocx, tmpRoot } from "./helpers";

let s: Session;
afterEach(() => s.close());

const posix = process.platform !== "win32";
const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
const imageDoc = (...srcs: string[]) => ({
  type: "doc",
  content: srcs.map((src) => ({ type: "image", attrs: { src, alt: "a" } })),
});
const at = (...p: string[]) => join(s.root, "p", ...p);
const manifest = () => parseManifest(readFileSync(at("cadabra.json"), "utf8")).manifest;
const editManifest = (fn: (m: Manifest) => void) => {
  const m = manifest();
  fn(m);
  writeFileSync(at("cadabra.json"), serializeManifest(m));
};
const put = (rel: string, contents: string | Uint8Array) => {
  mkdirSync(dirname(at(rel)), { recursive: true });
  writeFileSync(at(rel), contents);
};
const errorCode = async (name: string, args: Record<string, unknown>) => {
  const r = await s.call(name, args);
  expect(r.isError, `${name} should fail`).toBe(true);
  return r.data.error.code as string;
};

const newBook = async (language?: string) => {
  s = await connect();
  await s.ok("cadabra_project_create", { path: "p", title: "Book", author: "Me", language });
};
const addChapter = async (title: string, content: unknown = doc(`${title} text`)) => {
  const a = await s.ok("cadabra_chapter_add", { path: "p", title });
  await s.ok("cadabra_chapter_write_json", { path: "p", chapterId: a.chapter.id, doc: content });
  return a.chapter.id as string;
};

/** Two chapters and a French edition made the way the app does (copies of the source, marked untranslated). */
const withFrench = async () => {
  await newBook();
  await addChapter("One");
  await addChapter("Two");
  const fr = {
    language: "fr",
    title: "Livre",
    author: "Moi",
    identifier: "urn:uuid:fr",
    isbn: null,
    cover: null,
  };
  const { manifest: next, files } = addEdition(manifest(), fr, "copy");
  for (const f of files) put(f.path, readFileSync(at(f.from!), "utf8"));
  writeFileSync(at("cadabra.json"), serializeManifest(next));
};

describe("chapters on a damaged project", () => {
  it("chapter_add will not overwrite a file the book does not list", async () => {
    await newBook();
    const file = `manuscript/${chapterFileName(1, "One")}`;
    put(file, "precious");
    expect(await errorCode("cadabra_chapter_add", { path: "p", title: "One" })).toBe("io_error");
    expect(readFileSync(at(file), "utf8")).toBe("precious");
    expect(manifest().chapters).toEqual([]);
  });

  it.skipIf(!posix)(
    "chapter_remove reports a failed move to the trash, with the manifest already saved and the text kept",
    async () => {
      await newBook();
      const id = await addChapter("One");
      const file = manifest().chapters[0]!.files.en!;
      rmSync(at(".cadabra"), { recursive: true, force: true });
      writeFileSync(at(".cadabra"), "not a folder");
      expect(await errorCode("cadabra_chapter_remove", { path: "p", chapterId: id })).toBe(
        "not_a_file",
      );
      expect(existsSync(at(file))).toBe(true);
    },
  );
});

describe("translations", () => {
  it("rename in French for an unknown chapter is chapter_not_found", async () => {
    await withFrench();
    expect(
      await errorCode("cadabra_chapter_rename", {
        path: "p",
        chapterId: "ch-9",
        title: "x",
        language: "fr",
      }),
    ).toBe("chapter_not_found");
  });

  it("chapter_read of a page added after the edition says it has no French text yet", async () => {
    await withFrench();
    await s.ok("cadabra_chapter_add", { path: "p", title: "Three" });
    expect(
      await errorCode("cadabra_chapter_read", { path: "p", chapterId: "ch-3", language: "fr" }),
    ).toBe("chapter_not_translated");
  });

  it("writing French twice marks it translated once; reading it back says translated", async () => {
    await withFrench();
    const write = (text: string) =>
      s.ok("cadabra_chapter_write_json", {
        path: "p",
        chapterId: "ch-1",
        doc: doc(text),
        language: "fr",
      });
    await write("Un");
    const hash = manifest();
    await write("Deux");
    expect(manifest()).toEqual(hash);
    const r = await s.ok("cadabra_chapter_read", { path: "p", chapterId: "ch-1", language: "fr" });
    expect(r.chapter.translated).toBe(true);
    expect(r.text).toBe("Deux");
  });

  it("project_info in French shows a page with no French text as untitled-in-French, fileless and empty", async () => {
    await withFrench();
    await s.ok("cadabra_chapter_add", { path: "p", title: "Three" });
    const info = await s.ok("cadabra_project_info", { path: "p", language: "fr" });
    const three = info.entries.find((e: { id: string }) => e.id === "ch-3");
    expect(three).toMatchObject({ title: "Three", file: null, words: 0 });
    expect(three.translations.fr).toEqual({ file: null, translated: false });
  });
});

describe("project_info and project_validate on damaged books", () => {
  it("project_info reports unreadable chapters per entry instead of failing", async () => {
    await newBook();
    await addChapter("One");
    await addChapter("Two");
    await addChapter("Three");
    const files = manifest().chapters.map((c) => c.files.en!);
    put(files[0]!, "{not json");
    rmSync(at(files[1]!));
    mkdirSync(at(files[1]!));
    const info = await s.ok("cadabra_project_info", { path: "p" });
    const [bad, dir, ok] = info.entries;
    expect(bad.error).toMatch(/not valid JSON/);
    expect(dir.error).toMatch(/EISDIR/);
    expect(ok.words).toBeGreaterThan(0);
  });

  it("project_validate reports an unknown template, an unreadable chapter and unusable images, checking a shared image once", async () => {
    await newBook();
    await addChapter("One", imageDoc("assets/a.png", "assets/a.png", "assets/dir.png"));
    await addChapter("Two");
    put("assets/a.png", "not a png at all");
    await addChapter("Three", imageDoc("assets/a.png"));
    mkdirSync(at("assets/dir.png"));
    const second = manifest().chapters[1]!.files.en!;
    rmSync(at(second));
    mkdirSync(at(second));
    editManifest((m) => (m.template = "gone"));
    const r = await s.ok("cadabra_project_validate", { path: "p" });
    const codes = r.issues.map((i: { code: string }) => i.code);
    expect(codes).toContain("template_unknown");
    expect(codes).toContain("chapter_unreadable");
    expect(codes.filter((c: string) => c === "asset_invalid")).toHaveLength(3); // a.png (checked once, used by two chapters) and dir.png
    expect(r.valid).toBe(false);
  });
});

describe("export of unusual books", () => {
  it("export_epub says epub_error when the language has no Contents translation", async () => {
    await newBook("pt");
    await addChapter("Um");
    expect(await errorCode("cadabra_export_epub", { path: "p", epubcheckJar: null })).toBe(
      "epub_error",
    );
  });

  it("export_pdf names an unknown template before reading the book", async () => {
    await newBook();
    expect(await errorCode("cadabra_export_pdf", { path: "p", template: "gone" })).toBe(
      "template_unknown",
    );
  });

  it("falls back to the default template when the manifest names one that is gone", async () => {
    await newBook();
    await addChapter("One");
    editManifest((m) => (m.template = "gone"));
    const r = await s.ok("cadabra_export_markdown", { path: "p" });
    expect(r.chapterCount).toBe(1);
    const epub = await s.ok("cadabra_export_epub", { path: "p" });
    expect(epub.template).toBe("novel");
  });

  it("refuses a chapter that is not valid in the editor schema", async () => {
    await newBook();
    const id = await addChapter("One");
    put(
      manifest().chapters.find((c) => c.id === id)!.files.en!,
      JSON.stringify({ type: "doc", content: [{ type: "bogus" }] }),
    );
    expect(await errorCode("cadabra_export_markdown", { path: "p" })).toBe("invalid_chapter_doc");
  });

  it("refuses an image that is not an assets/ path, a folder where an image should be, and a non-image", async () => {
    await newBook();
    const id = await addChapter("One");
    const file = manifest().chapters.find((c) => c.id === id)!.files.en!;
    put(file, JSON.stringify(imageDoc("https://example.org/a.png")));
    expect(await errorCode("cadabra_export_markdown", { path: "p" })).toBe("invalid_chapter_doc");
    put(file, JSON.stringify(imageDoc("assets/x.png")));
    mkdirSync(at("assets/x.png"));
    expect(await errorCode("cadabra_export_markdown", { path: "p" })).toBe("not_a_file");
    rmSync(at("assets/x.png"), { recursive: true });
    put("assets/x.png", "plain text");
    expect(await errorCode("cadabra_export_markdown", { path: "p" })).toBe("invalid_image");
  });

  it("loads a shared image once and titles a translated page that has no French title by its source title", async () => {
    await withFrench();
    put("assets/g.png", gradientPng());
    for (const f of ["manuscript/001-one.json", "manuscript/002-two.json"])
      put(f, JSON.stringify(imageDoc("assets/g.png")));
    await s.ok("cadabra_chapter_write_json", {
      path: "p",
      chapterId: "ch-1",
      doc: imageDoc("assets/g.png"),
      language: "fr",
    });
    await s.ok("cadabra_chapter_write_json", {
      path: "p",
      chapterId: "ch-2",
      doc: imageDoc("assets/g.png"),
      language: "fr",
    });
    editManifest((m) => delete m.chapters[0]!.titles.fr);
    const r = await s.ok("cadabra_export_markdown", { path: "p", language: "fr" });
    expect(r.chapterCount).toBe(2);
    expect(readFileSync(at("exports/fr/book.md"), "utf8")).toContain("# One");
  });
});

describe.skipIf(!posix)("inspect_pdf with stand-in poppler tools", () => {
  const tools = (scripts: Record<string, string>) => {
    const dir = tmpRoot();
    for (const [name, body] of Object.entries(scripts)) {
      writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`);
      chmodSync(join(dir, name), 0o755);
    }
    return dir;
  };

  it("says pdf_error when pdfinfo cannot read the file", async () => {
    const popplerDir = tools({ pdfinfo: "echo 'Syntax Error: bad' >&2; exit 1" });
    await newBook();
    put("exports/en/book.pdf", "%PDF-broken");
    s = await (async () => (await s.close(), connect({ root: s.root, popplerDir })))();
    expect(await errorCode("cadabra_inspect_pdf", { path: "p" })).toBe("pdf_error");
  });

  it("reports missing fields as null when only pdfinfo is installed", async () => {
    const popplerDir = tools({ pdfinfo: "echo 'Title: x'" });
    await newBook();
    put("exports/en/book.pdf", "%PDF-1.7");
    s = await (async () => (await s.close(), connect({ root: s.root, popplerDir })))();
    const r = await s.ok("cadabra_inspect_pdf", { path: "p" });
    expect(r).toMatchObject({
      poppler: "ok",
      pageSize: null,
      pdfVersion: null,
      fonts: [],
      firstPageText: "",
    });
  });
});

describe("inspect_epub on odd packages", () => {
  const NS = 'xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"';
  const container = (opf: string) =>
    `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="${opf}" media-type="application/oebps-package+xml"/></rootfiles></container>`;
  const epub = (files: Record<string, string>) =>
    put(
      "exports/en/book.epub",
      zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))),
    );

  it("refuses something that is not a zip", async () => {
    await newBook();
    put("exports/en/book.epub", "this is not a zip");
    expect(await errorCode("cadabra_inspect_epub", { path: "p" })).toBe("epub_error");
  });

  it("refuses an EPUB with no container, or a container pointing at a missing package", async () => {
    await newBook();
    epub({ mimetype: "application/epub+zip" });
    expect(await errorCode("cadabra_inspect_epub", { path: "p" })).toBe("epub_error");
    epub({ "META-INF/container.xml": container("OEBPS/missing.opf") });
    expect(await errorCode("cadabra_inspect_epub", { path: "p" })).toBe("epub_error");
  });

  it("reads repeated and attributed metadata, a single manifest item and spine items without an idref", async () => {
    await newBook();
    epub({
      "META-INF/container.xml": container("c.opf"),
      "c.opf": `<package ${NS} version="3.0"><metadata><dc:title id="t">Named</dc:title><dc:identifier>a</dc:identifier><dc:identifier>b</dc:identifier><dc:language>en</dc:language></metadata><manifest><item id="x" href="x.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="x"/><itemref/></spine></package>`,
    });
    const r = await s.ok("cadabra_inspect_epub", { path: "p" });
    expect(r).toMatchObject({
      title: "Named",
      author: null,
      identifier: "a",
      language: "en",
      chapterCount: 2,
      epubVersion: "3.0",
    });
  });

  it("copes with a package that has no metadata, manifest or spine, or no package at all", async () => {
    await newBook();
    epub({ "META-INF/container.xml": container("c.opf"), "c.opf": `<package ${NS}/>` });
    expect(await s.ok("cadabra_inspect_epub", { path: "p" })).toMatchObject({
      title: null,
      chapterCount: 0,
    });
    epub({ "META-INF/container.xml": container("c.opf"), "c.opf": "<other/>" });
    expect(await s.ok("cadabra_inspect_epub", { path: "p" })).toMatchObject({
      title: null,
      epubVersion: null,
      chapterCount: 0,
    });
  });
});

describe("import_file edge cases", () => {
  const importFile = (source: string, extra: Record<string, unknown> = {}) =>
    s.call("cadabra_import_file", { source, destination: "out", ...extra });

  it("names a book 'Untitled' when the file name is only separators", async () => {
    s = await connect();
    writeFileSync(join(s.root, "-.md"), "# Hello\n\nText.\n");
    const r = await importFile("-.md");
    expect(r.isError).toBe(false);
    expect(r.data.manifest.editions[0].title).toBe("Untitled");
  });

  it("keeps a malformed percent-escape in an image reference as written and warns that the image is missing", async () => {
    s = await connect();
    writeFileSync(join(s.root, "b.md"), "# Hello\n\n![x](bad%zz.png)\n");
    const r = await importFile("b.md");
    expect(r.isError).toBe(false);
    expect(r.data.warnings.map((w: { code: string }) => w.code)).toContain("image-not-imported");
  });

  it("warns, and still imports the text, when an embedded image is not really an image", async () => {
    s = await connect();
    const body =
      docxPara("First", "Heading1") +
      `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><wp:docPr id="1" name="p" descr="alt"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId9"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
    writeFileSync(
      join(s.root, "bad.docx"),
      makeDocx(
        body,
        { "image1.png": new Uint8Array([1, 2, 3, 4]) },
        '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>',
      ),
    );
    const r = await importFile("bad.docx");
    expect(r.isError).toBe(false);
    expect(r.data.imageCount).toBe(0);
    expect(r.data.warnings.map((w: { code: string }) => w.code)).toContain("image-not-imported");
  });

  it("reports import_write_failed, saying what was written, when the destination cannot be created", async () => {
    s = await connect();
    writeFileSync(join(s.root, "b.md"), "# Hello\n\nText.\n");
    writeFileSync(join(s.root, "afile"), "x");
    const r = await s.call("cadabra_import_file", { source: "b.md", destination: "afile/sub" });
    expect(r.isError).toBe(true);
    expect(r.data.error.code).toBe("import_write_failed");
    expect(r.data.error.details).toMatchObject({ written: { images: 0, chapters: 0 } });
  });
});
