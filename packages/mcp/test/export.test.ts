import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { type Session, connect, epubcheckJar, hasPoppler, hasTypst, seedBook } from "./helpers";

let s: Session;
afterEach(() => s.close());

const requireEpubcheck = process.env.REQUIRE_EPUBCHECK === "1";
const requireTypst = process.env.REQUIRE_TYPST === "1";

describe("export_epub / inspect_epub", () => {
  it("writes exports/book.epub with template CSS and images, and inspect_epub reads it back", async () => {
    s = await connect({ epubcheckJar: null });
    const { path, ids } = await seedBook(s);
    await s.ok("cadabra_set_template", { path, template: "nonfiction" });
    const r = await s.ok("cadabra_export_epub", { path });
    expect(r.file).toBe("exports/book.epub");
    expect(r.bytes).toBeGreaterThan(1000);
    expect(r.chapterCount).toBe(ids.length);
    expect(r.epubcheck).toMatchObject({ ran: false });
    const zip = unzipSync(new Uint8Array(readFileSync(join(s.root, path, "exports/book.epub"))));
    expect(Object.keys(zip)[0]).toBe("mimetype");
    expect(Object.keys(zip)).toContain("OEBPS/assets/gradient.png");
    expect(new TextDecoder().decode(zip["OEBPS/style.css"])).toContain("counter-reset:chapter"); // nonfiction template css
    expect(readdirSync(join(s.root, path, "exports"))).toEqual(["book.epub"]);

    const info = await s.ok("cadabra_inspect_epub", { path });
    expect(info).toMatchObject({ title: "The Long Quay", author: "A. N. Author", language: "en-GB", chapterCount: ids.length });
    expect(info.entries).toContain("OEBPS/content.opf");
    expect(info.entries).toContain("OEBPS/assets/gradient.png");
  });

  it("refuses an empty book, a missing chapter file and a missing image without writing anything", async () => {
    s = await connect({ epubcheckJar: null });
    await s.ok("cadabra_project_create", { path: "e", title: "T", author: "A" });
    expect((await s.call("cadabra_export_epub", { path: "e" })).data.error.code).toBe("empty_book");
    const a = await s.ok("cadabra_chapter_add", { path: "e", title: "One" });
    writeFileSync(join(s.root, "e", a.chapter.file), JSON.stringify({ type: "doc", content: [{ type: "image", attrs: { src: "assets/gone.png" } }] }));
    expect((await s.call("cadabra_export_epub", { path: "e" })).data.error.code).toBe("asset_missing");
    const { rmSync } = await import("node:fs");
    rmSync(join(s.root, "e", a.chapter.file));
    expect((await s.call("cadabra_export_epub", { path: "e" })).data.error.code).toBe("chapter_missing");
    expect(readdirSync(join(s.root, "e/exports"))).toEqual([]);
  });

  it("inspect_epub reports not_found when nothing was exported", async () => {
    s = await connect();
    await s.ok("cadabra_project_create", { path: "e", title: "T", author: "A" });
    expect((await s.call("cadabra_inspect_epub", { path: "e" })).data.error.code).toBe("not_found");
    expect((await s.call("cadabra_inspect_pdf", { path: "e" })).data.error.code).toBe("not_found");
  });

  const jar = epubcheckJar();
  it.skipIf(!jar && !requireEpubcheck)("the exported EPUB passes EPUBCheck with no messages (REQUIRE_EPUBCHECK=1 fails instead of skipping)", async () => {
    expect(jar, "EPUBCheck jar missing: run scripts/fetch-epubcheck.sh or set EPUBCHECK_JAR").not.toBeNull();
    s = await connect({ epubcheckJar: jar });
    const { path } = await seedBook(s);
    const r = await s.ok("cadabra_export_epub", { path });
    expect(r.epubcheck).toMatchObject({ ran: true, passed: true, messages: [] });
    // independent run of the real tool on the written file
    const out = execFileSync("java", ["-jar", jar!, join(s.root, path, "exports/book.epub")], { encoding: "utf8" });
    expect(out).toContain("No errors or warnings detected");
  });

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
    expect(existsSync(join(s.root, path, "exports/book.pdf"))).toBe(false);
  });

  it("reports asset_missing and empty_book before running typst", async () => {
    s = await connect({ typstBin: "/definitely/not/typst" });
    await s.ok("cadabra_project_create", { path: "e", title: "T", author: "A" });
    expect((await s.call("cadabra_export_pdf", { path: "e" })).data.error.code).toBe("empty_book");
    const a = await s.ok("cadabra_chapter_add", { path: "e", title: "One" });
    writeFileSync(join(s.root, "e", a.chapter.file), JSON.stringify({ type: "doc", content: [{ type: "image", attrs: { src: "assets/gone.png" } }] }));
    expect((await s.call("cadabra_export_pdf", { path: "e" })).data.error.code).toBe("asset_missing");
  });

  it("inspect_pdf notes poppler_missing instead of failing when poppler is not on PATH", async () => {
    s = await connect({ popplerDir: null });
    await s.ok("cadabra_project_create", { path: "e", title: "T", author: "A" });
    writeFileSync(join(s.root, "e/exports/book.pdf"), "%PDF-1.4 fake");
    const r = await s.ok("cadabra_inspect_pdf", { path: "e" });
    expect(r.poppler).toBe("missing");
    expect(r.note).toContain("poppler_missing");
    expect(r.bytes).toBeGreaterThan(0);
  });

  const can = hasTypst() && hasPoppler();
  it.skipIf(!can && !requireTypst)("renders the full book with real typst; inspect_pdf reports pages, size, fonts and text (REQUIRE_TYPST=1 fails instead of skipping)", async () => {
    expect(can, "typst and poppler must be installed").toBe(true);
    s = await connect();
    const { path } = await seedBook(s);
    const r = await s.ok("cadabra_export_pdf", { path, trimSize: "6x9", template: "novel", pdfA: true });
    expect(r.file).toBe("exports/book.pdf");
    expect(r.options).toMatchObject({ trimSize: "6x9", template: "novel", pdfA: true });
    expect(r.fonts.body).toBeTruthy();
    expect(readFileSync(join(s.root, path, "exports/book.pdf")).subarray(0, 5).toString()).toBe("%PDF-");
    expect(readdirSync(join(s.root, path, "exports"))).toEqual(["book.pdf"]);

    const info = await s.ok("cadabra_inspect_pdf", { path });
    expect(info.poppler).toBe("ok");
    expect(info.pages).toBeGreaterThan(3);
    expect(info.pageSize).toMatch(/432(\.\d+)? x 648/);
    expect(info.fonts.length).toBeGreaterThan(0);
    expect(info.fonts.every((f: { embedded: boolean }) => f.embedded)).toBe(true);
    expect(info.firstPageText).toContain("The harbour lay quiet");
  });

  it.skipIf(!can && !requireTypst)("honours template and trim size choices without changing the manifest", async () => {
    expect(can, "typst and poppler must be installed").toBe(true);
    s = await connect();
    const { path } = await seedBook(s);
    await s.ok("cadabra_export_pdf", { path, trimSize: "5x8", template: "nonfiction" });
    const info = await s.ok("cadabra_inspect_pdf", { path });
    expect(info.pageSize).toMatch(/360(\.\d+)? x 576/);
    expect(JSON.parse(readFileSync(join(s.root, path, "cadabra.json"), "utf8")).template).toBe("novel");
  });
});
