import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { type Session, connect, epubcheckJar, hasPoppler, hasTypst, seedBook } from "./helpers";

let s: Session;
afterEach(() => s.close());

const requireEpubcheck = process.env.REQUIRE_EPUBCHECK === "1";
const requireTypst = process.env.REQUIRE_TYPST === "1";

describe("export_epub / inspect_epub", () => {
  it("writes exports/en-GB/book.epub with template CSS and images, and inspect_epub reads it back", async () => {
    s = await connect({ epubcheckJar: null });
    const { path, ids } = await seedBook(s);
    await s.ok("cadabra_set_template", { path, template: "nonfiction" });
    const r = await s.ok("cadabra_export_epub", { path });
    expect(r.file).toBe("exports/en-GB/book.epub");
    expect(r.bytes).toBeGreaterThan(1000);
    expect(r.chapterCount).toBe(ids.length);
    expect(r.epubcheck).toMatchObject({ ran: false });
    const zip = unzipSync(
      new Uint8Array(readFileSync(join(s.root, path, "exports/en-GB/book.epub"))),
    );
    expect(Object.keys(zip)[0]).toBe("mimetype");
    expect(Object.keys(zip)).toContain("OEBPS/assets/gradient.png");
    expect(new TextDecoder().decode(zip["OEBPS/style.css"])).toContain("counter-reset:chapter"); // nonfiction template css
    expect(readdirSync(join(s.root, path, "exports/en-GB"))).toEqual(["book.epub"]);

    const info = await s.ok("cadabra_inspect_epub", { path });
    expect(info).toMatchObject({
      title: "The Long Quay",
      author: "A. N. Author",
      language: "en-GB",
      chapterCount: ids.length,
    });
    expect(info.entries).toContain("OEBPS/content.opf");
    expect(info.entries).toContain("OEBPS/assets/gradient.png");
  });

  it("refuses an empty book, a missing chapter file and a missing image without writing anything", async () => {
    s = await connect({ epubcheckJar: null });
    await s.ok("cadabra_project_create", { path: "e", title: "T", author: "A" });
    expect((await s.call("cadabra_export_epub", { path: "e" })).data.error.code).toBe("empty_book");
    const a = await s.ok("cadabra_chapter_add", { path: "e", title: "One" });
    writeFileSync(
      join(s.root, "e", a.chapter.file),
      JSON.stringify({
        type: "doc",
        content: [{ type: "image", attrs: { src: "assets/gone.png" } }],
      }),
    );
    expect((await s.call("cadabra_export_epub", { path: "e" })).data.error.code).toBe(
      "asset_missing",
    );
    const { rmSync } = await import("node:fs");
    rmSync(join(s.root, "e", a.chapter.file));
    expect((await s.call("cadabra_export_epub", { path: "e" })).data.error.code).toBe(
      "chapter_missing",
    );
    expect(readdirSync(join(s.root, "e/exports"))).toEqual([]);
  });

  it("inspect_epub reports not_found when nothing was exported", async () => {
    s = await connect();
    await s.ok("cadabra_project_create", { path: "e", title: "T", author: "A" });
    expect((await s.call("cadabra_inspect_epub", { path: "e" })).data.error.code).toBe("not_found");
    expect((await s.call("cadabra_inspect_pdf", { path: "e" })).data.error.code).toBe("not_found");
  });

  const jar = epubcheckJar();
  it.skipIf(!jar && !requireEpubcheck)(
    "the exported EPUB passes EPUBCheck with no messages (REQUIRE_EPUBCHECK=1 fails instead of skipping)",
    async () => {
      expect(
        jar,
        "EPUBCheck jar missing: run scripts/fetch-epubcheck.sh or set EPUBCHECK_JAR",
      ).not.toBeNull();
      s = await connect({ epubcheckJar: jar });
      const { path } = await seedBook(s);
      const r = await s.ok("cadabra_export_epub", { path });
      expect(r.epubcheck).toMatchObject({ ran: true, passed: true, messages: [] });
      // independent run of the real tool on the written file
      const out = execFileSync(
        "java",
        ["-jar", jar!, join(s.root, path, "exports/en-GB/book.epub")],
        {
          encoding: "utf8",
        },
      );
      expect(out).toContain("No errors or warnings detected");
    },
    60_000,
  ); // runs java twice (server and test), each a cold JVM on CI

  it("reports EPUBCheck as not run when the jar is absent", async () => {
    s = await connect({ epubcheckJar: null, repo: "/nonexistent-repo" });
    await s.ok("cadabra_project_create", { path: "e", title: "T", author: "A" });
    await s.ok("cadabra_chapter_add", { path: "e", title: "One" });
    const r = await s.ok("cadabra_export_epub", { path: "e" });
    expect(r.epubcheck.ran).toBe(false);
    expect(r.epubcheck.reason).toMatch(/jar/i);
  });
});

describe("export_pdf / inspect_pdf", () => {
  it("maps a missing typst to typst_missing", async () => {
    s = await connect({ typstBin: "/definitely/not/typst" });
    const { path } = await seedBook(s);
    const r = await s.call("cadabra_export_pdf", { path });
    expect(r.data.error.code).toBe("typst_missing");
    expect(existsSync(join(s.root, path, "exports/en-GB/book.pdf"))).toBe(false);
  });

  it("reports asset_missing and empty_book before running typst", async () => {
    s = await connect({ typstBin: "/definitely/not/typst" });
    await s.ok("cadabra_project_create", { path: "e", title: "T", author: "A" });
    expect((await s.call("cadabra_export_pdf", { path: "e" })).data.error.code).toBe("empty_book");
    const a = await s.ok("cadabra_chapter_add", { path: "e", title: "One" });
    writeFileSync(
      join(s.root, "e", a.chapter.file),
      JSON.stringify({
        type: "doc",
        content: [{ type: "image", attrs: { src: "assets/gone.png" } }],
      }),
    );
    expect((await s.call("cadabra_export_pdf", { path: "e" })).data.error.code).toBe(
      "asset_missing",
    );
  });

  it("inspect_pdf notes poppler_missing instead of failing when poppler is not on PATH", async () => {
    s = await connect({ popplerDir: null });
    await s.ok("cadabra_project_create", { path: "e", title: "T", author: "A" });
    mkdirSync(join(s.root, "e/exports/en"), { recursive: true });
    writeFileSync(join(s.root, "e/exports/en/book.pdf"), "%PDF-1.4 fake");
    const r = await s.ok("cadabra_inspect_pdf", { path: "e" });
    expect(r.poppler).toBe("missing");
    expect(r.note).toContain("poppler_missing");
    expect(r.bytes).toBeGreaterThan(0);
  });

  // A fake typst: `fonts` lists a few families, `compile` writes the Typst source as the "PDF" so the chosen fonts can be read back.
  const fakeTypst = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "cadabra-faketypst-"));
    const bin = join(dir, "typst");
    writeFileSync(
      bin,
      [
        "#!/bin/sh",
        'if [ "$1" = "fonts" ]; then printf "Libertinus Serif\\nEB Garamond\\nInter\\nLora\\n"; exit 0; fi',
        'src=""; out=""; for a in "$@"; do src="$out"; out="$a"; done',
        '(printf "%%PDF-fake\\n"; cat "$src") > "$out"',
      ].join("\n"),
    );
    chmodSync(bin, 0o755);
    return bin;
  };
  const pdfSource = (root: string, path: string): string =>
    readFileSync(join(root, path, "exports/en-GB/book.pdf"), "utf8");

  it("uses the manifest fonts for the PDF, per-key tool arguments win, and a missing font is refused, not substituted", async () => {
    s = await connect({ typstBin: fakeTypst() });
    const { path } = await seedBook(s);
    const file = join(s.root, path, "cadabra.json");
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    manifest.fonts = { body: "EB Garamond", heading: "Inter" };
    writeFileSync(file, JSON.stringify(manifest));
    const r = await s.ok("cadabra_export_pdf", { path });
    expect(r.fonts).toEqual({ body: "EB Garamond", heading: "Inter" });
    expect(pdfSource(s.root, path)).toContain("EB Garamond");
    const o = await s.ok("cadabra_export_pdf", { path, bodyFont: "Lora" });
    expect(o.fonts).toEqual({ body: "Lora", heading: "Inter" });

    manifest.trimSize = "5x8";
    writeFileSync(file, JSON.stringify(manifest));
    const sized = await s.ok("cadabra_export_pdf", { path });
    expect(sized.options.trimSize).toBe("5x8");

    manifest.fonts = { body: "Not Installed Serif" };
    writeFileSync(file, JSON.stringify(manifest));
    const missing = await s.call("cadabra_export_pdf", { path });
    expect(missing.isError).toBe(true);
    expect(missing.data.error.code).toBe("font_missing");
    expect(missing.data.error.details.families).toEqual(["Not Installed Serif"]);
    const argMissing = await s.call("cadabra_export_pdf", {
      path,
      bodyFont: "Lora",
      headingFont: "Nope",
    });
    expect(argMissing.data.error.code).toBe("font_missing");
    expect(argMissing.data.error.details.role).toBe("heading");
  });

  const can = hasTypst() && hasPoppler();
  it.skipIf(!can && !requireTypst)(
    "renders the full book with real typst; inspect_pdf reports pages, size, fonts and text (REQUIRE_TYPST=1 fails instead of skipping)",
    async () => {
      expect(can, "typst and poppler must be installed").toBe(true);
      s = await connect();
      const { path } = await seedBook(s);
      const r = await s.ok("cadabra_export_pdf", {
        path,
        trimSize: "6x9",
        template: "novel",
        pdfA: true,
      });
      expect(r.file).toBe("exports/en-GB/book.pdf");
      expect(r.options).toMatchObject({ trimSize: "6x9", template: "novel", pdfA: true });
      expect(r.fonts.body).toBeTruthy();
      expect(
        readFileSync(join(s.root, path, "exports/en-GB/book.pdf"))
          .subarray(0, 5)
          .toString(),
      ).toBe("%PDF-");
      expect(readdirSync(join(s.root, path, "exports/en-GB"))).toEqual(["book.pdf"]);

      const info = await s.ok("cadabra_inspect_pdf", { path });
      expect(info.poppler).toBe("ok");
      expect(info.pages).toBeGreaterThan(3);
      expect(info.pageSize).toMatch(/432(\.\d+)? x 648/);
      expect(info.fonts.length).toBeGreaterThan(0);
      expect(info.fonts.every((f: { embedded: boolean }) => f.embedded)).toBe(true);
      expect(info.firstPageText).toContain("The harbour lay quiet");
    },
  );

  it.skipIf(!can && !requireTypst)(
    "honours template and trim size choices without changing the manifest",
    async () => {
      expect(can, "typst and poppler must be installed").toBe(true);
      s = await connect();
      const { path } = await seedBook(s);
      await s.ok("cadabra_export_pdf", { path, trimSize: "5x8", template: "nonfiction" });
      const info = await s.ok("cadabra_inspect_pdf", { path });
      expect(info.pageSize).toMatch(/360(\.\d+)? x 576/);
      expect(JSON.parse(readFileSync(join(s.root, path, "cadabra.json"), "utf8")).template).toBe(
        "novel",
      );
    },
  );
});

describe("export_markdown", () => {
  it("writes exports/en-GB/book.md for the whole book; marks without syntax fail unless htmlMarks is set", async () => {
    s = await connect({ epubcheckJar: null });
    const { path, ids } = await seedBook(s);
    const failed = await s.call("cadabra_export_markdown", { path });
    expect(failed.isError).toBe(true);
    expect(failed.data.error.code).toBe("markdown_error");
    expect(failed.data.error.message).toMatch(/htmlMarks/);
    expect(existsSync(join(s.root, path, "exports/en-GB/book.md"))).toBe(false);

    const r = await s.ok("cadabra_export_markdown", { path, htmlMarks: true });
    expect(r).toMatchObject({
      file: "exports/en-GB/book.md",
      chapterCount: ids.length,
      htmlMarks: true,
    });
    const md = readFileSync(join(s.root, path, "exports/en-GB/book.md"), "utf8");
    expect(md.startsWith("# ")).toBe(true);
    expect(md).toContain("](../assets/gradient.png");
    expect(readdirSync(join(s.root, path, "exports/en-GB"))).toEqual(["book.md"]);
  });

  it("writes plain Markdown for a simple chapter and refuses an empty book", async () => {
    s = await connect({ epubcheckJar: null });
    await s.ok("cadabra_project_create", { path: "m", title: "T", author: "A" });
    expect((await s.call("cadabra_export_markdown", { path: "m" })).data.error.code).toBe(
      "empty_book",
    );
    const a = await s.ok("cadabra_chapter_add", { path: "m", title: "One" });
    const md = "# One\n\nHello *there* **you**[^1].\n\n- a\n- b\n\n[^1]: Note.\n";
    await s.ok("cadabra_chapter_write_markdown", {
      path: "m",
      chapterId: a.chapter.id,
      markdown: md,
    });
    await s.ok("cadabra_export_markdown", { path: "m" });
    expect(readFileSync(join(s.root, "m/exports/en/book.md"), "utf8")).toBe(md);
  });
});

describe("export_docx / export_rtf", () => {
  const manifestFile = (path: string) => join(s.root, path, "cadabra.json");

  it("writes exports/en-GB/manuscript.docx in manuscript format with the chosen font", async () => {
    s = await connect({ epubcheckJar: null });
    const { path, ids } = await seedBook(s);
    const r = await s.ok("cadabra_export_docx", { path });
    expect(r).toMatchObject({
      file: "exports/en-GB/manuscript.docx",
      language: "en-GB",
      chapterCount: ids.length,
      skipped: [],
      font: "times",
    });
    const parts = unzipSync(
      new Uint8Array(readFileSync(join(s.root, path, "exports/en-GB/manuscript.docx"))),
    );
    expect(strFromU8(parts["word/document.xml"]!)).toContain("The harbour lay quiet");
    expect(strFromU8(parts["word/header2.xml"]!)).toContain("Author / THE LONG QUAY / ");
    expect(Object.keys(parts)).toContain("word/media/image1.png");
    expect(readdirSync(join(s.root, path, "exports/en-GB"))).toEqual(["manuscript.docx"]);
    const c = await s.ok("cadabra_export_docx", { path, font: " courier " });
    expect(c.font).toBe("courier");
    const styles = unzipSync(
      new Uint8Array(readFileSync(join(s.root, path, "exports/en-GB/manuscript.docx"))),
    )["word/styles.xml"]!;
    expect(strFromU8(styles)).toContain('w:ascii="Courier New" w:hAnsi="Courier New" w:eastAsia');
  });

  it("writes exports/en-GB/manuscript.rtf as 7-bit RTF with the font and the images it can hold", async () => {
    s = await connect({ epubcheckJar: null });
    const { path, ids } = await seedBook(s);
    const r = await s.ok("cadabra_export_rtf", { path, font: "Lora" });
    expect(r).toMatchObject({
      file: "exports/en-GB/manuscript.rtf",
      chapterCount: ids.length,
      font: "Lora",
    });
    const rtf = readFileSync(join(s.root, path, "exports/en-GB/manuscript.rtf"), "latin1");
    expect(rtf.startsWith("{\\rtf1")).toBe(true);
    expect(rtf).toContain("\\fnil\\fcharset0 Lora;");
    expect(rtf).toContain("{\\pict\\pngblip");
    expect(rtf).toContain("Author / THE LONG QUAY / ");
    expect(readdirSync(join(s.root, path, "exports/en-GB"))).toEqual(["manuscript.rtf"]);
  });

  it("treats front and back matter as matter: the generated title page replaces the title-page page", async () => {
    s = await connect({ epubcheckJar: null });
    const { path, ids } = await seedBook(s);
    const manifest = JSON.parse(readFileSync(manifestFile(path), "utf8"));
    const [first, second] = manifest.chapters.splice(0, 2);
    manifest.frontMatter.push({ ...first, kind: "title-page" });
    manifest.backMatter.push({ ...second, kind: "acknowledgments" });
    writeFileSync(manifestFile(path), JSON.stringify(manifest));
    const r = await s.ok("cadabra_export_rtf", { path });
    expect(r.chapterCount).toBe(ids.length);
    const rtf = readFileSync(join(s.root, path, "exports/en-GB/manuscript.rtf"), "latin1");
    expect(rtf).not.toContain(first.titles["en-GB"]);
    // The back matter page is written after the last chapter.
    expect(rtf.indexOf(second.titles["en-GB"])).toBeGreaterThan(
      rtf.indexOf(manifest.chapters.at(-1).titles["en-GB"]),
    );
    const docx = await s.ok("cadabra_export_docx", { path });
    expect(docx.chapterCount).toBe(ids.length);
  });

  it("an image Word can hold but RTF cannot (GIF) fails only RTF with rtf_error, naming the page, and writes nothing", async () => {
    s = await connect({ epubcheckJar: null });
    await s.ok("cadabra_project_create", { path: "g", title: "T", author: "A" });
    const a = await s.ok("cadabra_chapter_add", { path: "g", title: "One" });
    const { storeImage } = await import("@cadabracraft/project-fs");
    const gif = new Uint8Array([
      ...Array.from("GIF89a", (c) => c.charCodeAt(0)),
      1,
      0,
      1,
      0,
      0,
      0,
      0,
      0,
      0,
    ]);
    const stored = storeImage(join(s.root, "g"), "dot.gif", gif);
    await s.ok("cadabra_chapter_write_json", {
      path: "g",
      chapterId: a.chapter.id,
      doc: { type: "doc", content: [{ type: "image", attrs: { src: stored, alt: "dot" } }] },
    });
    await s.ok("cadabra_export_docx", { path: "g" });
    const bad = await s.call("cadabra_export_rtf", { path: "g" });
    expect(bad.isError).toBe(true);
    expect(bad.data.error.code).toBe("rtf_error");
    expect(bad.data.error.message).toContain("In “One”");
    expect(bad.data.error.message).toContain("PNG or JPEG");
    expect(existsSync(join(s.root, "g/exports/en/manuscript.rtf"))).toBe(false);
  });

  it("a Word export failure is a docx_error naming the page", async () => {
    s = await connect({ epubcheckJar: null });
    await s.ok("cadabra_project_create", { path: "v", title: "T", author: "A" });
    const a = await s.ok("cadabra_chapter_add", { path: "v", title: "One" });
    const { storeImage } = await import("@cadabracraft/project-fs");
    const stored = storeImage(
      join(s.root, "v"),
      "pic.svg",
      new TextEncoder().encode("<svg></svg>"),
    );
    await s.ok("cadabra_chapter_write_json", {
      path: "v",
      chapterId: a.chapter.id,
      doc: { type: "doc", content: [{ type: "image", attrs: { src: stored, alt: "x" } }] },
    });
    const bad = await s.call("cadabra_export_docx", { path: "v" });
    expect(bad.data.error.code).toBe("docx_error");
    expect(bad.data.error.message).toContain("SVG");
    expect(existsSync(join(s.root, "v/exports/en/manuscript.docx"))).toBe(false);
  });

  it("refuses an empty book without writing anything", async () => {
    s = await connect({ epubcheckJar: null });
    await s.ok("cadabra_project_create", { path: "e", title: "T", author: "A" });
    for (const tool of ["cadabra_export_docx", "cadabra_export_rtf"])
      expect((await s.call(tool, { path: "e" })).data.error.code).toBe("empty_book");
    expect(existsSync(join(s.root, "e/exports/en/manuscript.docx"))).toBe(false);
    expect(existsSync(join(s.root, "e/exports/en/manuscript.rtf"))).toBe(false);
  });
});
