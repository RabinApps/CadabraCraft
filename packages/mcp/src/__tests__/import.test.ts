import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type Session, connect, docxPara, gradientPng, makeDocx, snapshot } from "./helpers";

let s: Session;
afterEach(() => s.close());

const MD = "# Chapter One\n\nIt was *late*.\n\n![Grad](img/grad.png)\n\n# Chapter Two\n\n<mark>raw</mark>\n\nDone.\n";

function sourceDir(): void {
  mkdirSync(join(s.root, "src/img"), { recursive: true });
  writeFileSync(join(s.root, "src/book.md"), MD);
  writeFileSync(join(s.root, "src/img/grad.png"), gradientPng());
}

describe("import_file (markdown)", () => {
  it("creates a NEW project, writes images, chapters, then the manifest, and never touches the source", async () => {
    s = await connect();
    sourceDir();
    const before = snapshot(join(s.root, "src"));
    const r = await s.ok("cadabra_import_file", { source: "src/book.md", destination: "out", title: "Imported", author: "Me" });
    expect(r).toMatchObject({ chapterCount: 2, imageCount: 1 });
    expect(r.manifest).toMatchObject({ title: "Imported", author: "Me", language: "en" });
    expect(r.warnings.some((g: { code: string }) => g.code === "html")).toBe(true);
    expect(r.warnings[0]).toMatchObject({ code: expect.any(String), severity: expect.any(String), count: expect.any(Number), examples: expect.any(Array) });
    expect(snapshot(join(s.root, "src"))).toEqual(before);
    expect(readdirSync(join(s.root, "src")).sort()).toEqual(["book.md", "img"]);

    const m = JSON.parse(readFileSync(join(s.root, "out/cadabra.json"), "utf8"));
    expect(m.chapters.map((c: { title: string }) => c.title)).toEqual(["Chapter One", "Chapter Two"]);
    expect(readdirSync(join(s.root, "out/assets"))).toEqual(["grad.png"]);
    const doc = JSON.parse(readFileSync(join(s.root, "out", m.chapters[0].file), "utf8"));
    expect(JSON.stringify(doc)).toContain('"src":"assets/grad.png"');
    expect((await s.ok("cadabra_project_validate", { path: "out" })).valid).toBe(true);
  });

  it("defaults the title from the file name and turns unreadable images into a warning plus alt text", async () => {
    s = await connect();
    mkdirSync(join(s.root, "src"));
    writeFileSync(join(s.root, "src/my_great-book.md"), "# One\n\n![Missing](nope.png)\n\n![Out](../secret.png)\n\n![Remote](https://example.com/x.png)\n");
    const r = await s.ok("cadabra_import_file", { source: "src/my_great-book.md", destination: "out" });
    expect(r.manifest.title).toBe("my great book");
    expect(r.imageCount).toBe(0);
    const notImported = r.warnings.find((g: { code: string }) => g.code === "image-not-imported");
    expect(notImported.count).toBe(2);
    const m = JSON.parse(readFileSync(join(s.root, "out/cadabra.json"), "utf8"));
    const text = readFileSync(join(s.root, "out", m.chapters[0].file), "utf8");
    expect(text).toContain("[Image: Missing]");
    expect(text).not.toContain('"image"');
  });

  it("reads percent-encoded image references", async () => {
    s = await connect();
    mkdirSync(join(s.root, "src"));
    writeFileSync(join(s.root, "src/my pic.png"), gradientPng());
    writeFileSync(join(s.root, "src/b.md"), "# One\n\n![x](my%20pic.png)\n");
    const r = await s.ok("cadabra_import_file", { source: "src/b.md", destination: "out" });
    expect(r.imageCount).toBe(1);
  });

  it("refuses a destination that is not empty, leaving it untouched", async () => {
    s = await connect();
    sourceDir();
    mkdirSync(join(s.root, "busy"));
    writeFileSync(join(s.root, "busy/precious.txt"), "do not touch");
    const before = snapshot(join(s.root, "busy"));
    const r = await s.call("cadabra_import_file", { source: "src/book.md", destination: "busy" });
    expect(r.isError).toBe(true);
    expect(r.data.error.code).toBe("destination_not_empty");
    expect(snapshot(join(s.root, "busy"))).toEqual(before);
    // a destination that is a file, and an existing project, are refused too
    writeFileSync(join(s.root, "afile"), "x");
    expect((await s.call("cadabra_import_file", { source: "src/book.md", destination: "afile" })).data.error.code).toBe("destination_not_empty");
    await s.ok("cadabra_project_create", { path: "proj", title: "T", author: "A" });
    expect((await s.call("cadabra_import_file", { source: "src/book.md", destination: "proj" })).data.error.code).toBe("destination_not_empty");
  });

  it("accepts an existing empty destination folder", async () => {
    s = await connect();
    sourceDir();
    mkdirSync(join(s.root, "empty"));
    await s.ok("cadabra_import_file", { source: "src/book.md", destination: "empty" });
    expect(existsSync(join(s.root, "empty/cadabra.json"))).toBe(true);
  });

  it("creates nothing when parsing fails or the source is unusable", async () => {
    s = await connect();
    writeFileSync(join(s.root, "empty.md"), "   \n");
    writeFileSync(join(s.root, "broken.docx"), "this is not a zip");
    writeFileSync(join(s.root, "notes.pdf"), "x");
    mkdirSync(join(s.root, "dir.md"));
    const cases: [string, string][] = [
      ["empty.md", "empty_input"],
      ["broken.docx", "import_failed"],
      ["notes.pdf", "source_invalid"],
      ["dir.md", "source_invalid"],
      ["missing.md", "not_found"],
    ];
    for (const [source, code] of cases) {
      const r = await s.call("cadabra_import_file", { source, destination: "out" });
      expect(r.data.error.code, source).toBe(code);
      expect(existsSync(join(s.root, "out")), source).toBe(false);
    }
  });
});

describe("import_file (docx)", () => {
  it("imports headings, text and embedded images", async () => {
    s = await connect();
    const png = new Uint8Array(gradientPng());
    const body =
      docxPara("First", "Heading1") +
      docxPara("Some body text.") +
      `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><wp:docPr id="1" name="p" descr="A gradient"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId9"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>` +
      docxPara("Second", "Heading1") +
      docxPara("More.");
    writeFileSync(join(s.root, "book.docx"), makeDocx(body, { "image1.png": png }, '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>'));
    const before = snapshot(s.root);
    const r = await s.ok("cadabra_import_file", { source: "book.docx", destination: "out", title: "From Word", author: "W. Riter" });
    expect(r).toMatchObject({ chapterCount: 2, imageCount: 1 });
    expect(snapshot(s.root).filter((l) => !l.startsWith("out/"))).toEqual(before);
    expect((await s.ok("cadabra_project_validate", { path: "out" })).valid).toBe(true);
    const info = await s.ok("cadabra_project_info", { path: "out" });
    expect(info.entries.map((e: { title: string }) => e.title)).toEqual(["First", "Second"]);
    expect(info.assets).toEqual(["assets/image1.png"]);
  });
});

describe("import_file (html)", () => {
  it("takes the title from <title>, drops scripts, groups warnings and reads relative images", async () => {
    s = await connect();
    mkdirSync(join(s.root, "src/img"), { recursive: true });
    writeFileSync(join(s.root, "src/img/grad.png"), gradientPng());
    writeFileSync(
      join(s.root, "src/page.HTM"),
      '<!doctype html><html><head><title>My Page</title><script>alert("secret-js")</script></head><body><h1>One</h1><p>Hello <b>bold</b> <blink>x</blink> <a href="javascript:alert(1)">bad</a></p><img src="img/grad.png" alt="G"><img src="https://example.com/r.png" alt="R"><h1>Two</h1><p>End.</p></body></html>',
    );
    const r = await s.ok("cadabra_import_file", { source: "src/page.HTM", destination: "out" });
    expect(r).toMatchObject({ chapterCount: 2, imageCount: 1 });
    const codes = r.warnings.map((g: { code: string }) => g.code);
    expect(codes).toEqual(expect.arrayContaining(["unsupported-element", "unsafe-link", "remote-image"]));
    const info = await s.ok("cadabra_project_info", { path: "out" });
    expect(info.entries.map((e: { title: string }) => e.title)).toEqual(["One", "Two"]);
    expect((await s.ok("cadabra_project_validate", { path: "out" })).valid).toBe(true);
    const ch = readdirSync(join(s.root, "out/manuscript")).map((f) => readFileSync(join(s.root, "out/manuscript", f), "utf8")).join("\n");
    expect(ch).not.toContain("secret-js");
    expect(readdirSync(join(s.root, "src")).sort()).toEqual(["img", "page.HTM"]);
  });

  it("uses the <title> when there is no heading", async () => {
    s = await connect();
    writeFileSync(join(s.root, "t.html"), "<html><head><title>Only Title</title></head><body><p>Text here.</p></body></html>");
    await s.ok("cadabra_import_file", { source: "t.html", destination: "out" });
    const info = await s.ok("cadabra_project_info", { path: "out" });
    expect(info.entries.map((e: { title: string }) => e.title)).toEqual(["Only Title"]);
  });
});
