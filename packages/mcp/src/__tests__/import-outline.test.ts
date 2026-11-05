import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type Session, connect, snapshot } from "./helpers";

let s: Session;
afterEach(() => s.close());

const OPML =
  '<?xml version="1.0"?><opml version="2.0" xmlns:cc="urn:cadabracraft:outline"><head/><body>' +
  '<outline text="Arrival"><outline text="The storm" _note="Ana runs." cc:pov="Ana" cc:status="draft" cc:target="1500" cc:date="2024-05-01" cc:id="sc-1" cc:cast="a"/>' +
  '<outline text="Harbour"/></outline><outline text="Departure"/></body></opml>';

const write = (name: string, text: string | Buffer): void => {
  mkdirSync(join(s.root, "src"), { recursive: true });
  writeFileSync(join(s.root, "src", name), text);
};
const book = async () => {
  await s.ok("cadabra_project_create", { path: "b", title: "Book", author: "Me" });
  return s.ok("cadabra_chapter_add", { path: "b", title: "Existing" });
};
const manifest = () => JSON.parse(readFileSync(join(s.root, "b/cadabra.json"), "utf8"));

describe("cadabra_import_outline", () => {
  it("adds chapters and scenes after the existing ones without touching them or the source", async () => {
    s = await connect();
    const existing = await book();
    const existingFile = join(s.root, "b", existing.chapter.file);
    const before = readFileSync(existingFile, "utf8");
    write("outline.opml", OPML);
    const src = snapshot(join(s.root, "src"));
    const r = await s.ok("cadabra_import_outline", { path: "b", source: "src/outline.opml" });
    expect(r).toMatchObject({ sceneCount: 2 });
    expect(r.chapters.map((c: { title: string }) => c.title)).toEqual(["Arrival", "Departure"]);
    expect(r.warnings.map((w: { code: string }) => w.code)).toEqual(["cast-skipped"]);
    expect(manifest().chapters.map((c: { titles: { en: string } }) => c.titles.en)).toEqual([
      "Existing",
      "Arrival",
      "Departure",
    ]);
    expect(readFileSync(existingFile, "utf8")).toBe(before);
    expect(snapshot(join(s.root, "src"))).toEqual(src);
    const doc = JSON.parse(readFileSync(join(s.root, "b", r.chapters[0].file), "utf8"));
    const scene = doc.content[1];
    expect(scene).toMatchObject({
      type: "scene",
      attrs: {
        title: "The storm",
        synopsis: "Ana runs.",
        pov: "Ana",
        status: "draft",
        target: 1500,
        date: "2024-05-01",
      },
    });
    expect(scene.attrs.id).toMatch(/^sc-[0-9a-f]{8}$/);
    expect(scene.attrs.id).not.toBe("sc-1");
    expect((await s.ok("cadabra_project_validate", { path: "b" })).valid).toBe(true);
    // Importing it again adds a second copy with other scene ids and still changes nothing that was there.
    const again = await s.ok("cadabra_import_outline", { path: "b", source: "src/outline.opml" });
    const other = JSON.parse(readFileSync(join(s.root, "b", again.chapters[0].file), "utf8"));
    expect(other.content[1].attrs.id).not.toBe(scene.attrs.id);
    expect(manifest().chapters).toHaveLength(5);
  });

  it("reads Markdown and CSV outlines, and a format that overrides the extension", async () => {
    s = await connect();
    await book();
    write("o.md", "# One\n\n## Scene\n\nIt happens.\n");
    write("o.csv", "chapter,title,summary\nTwo,S,Hello\n");
    write("o.markdown", "chapter,title\nThree,T\n");
    expect(
      (await s.ok("cadabra_import_outline", { path: "b", source: "src/o.md" })).chapters,
    ).toHaveLength(1);
    expect(
      (await s.ok("cadabra_import_outline", { path: "b", source: "src/o.csv" })).sceneCount,
    ).toBe(1);
    const r = await s.ok("cadabra_import_outline", {
      path: "b",
      source: "src/o.markdown",
      format: "csv",
    });
    expect(r.chapters[0].title).toBe("Three");
  });

  it("refuses hostile, malformed, empty, oversized and mistyped files with a code and writes nothing", async () => {
    s = await connect();
    await book();
    write(
      "xxe.opml",
      '<?xml version="1.0"?><!DOCTYPE opml [<!ENTITY a "b">]><opml><body><outline text="&a;"/></body></opml>',
    );
    write("bad.opml", "<opml><body>");
    write("html.opml", "<html></html>");
    write("empty.md", "no headings here\n");
    write("cols.csv", "x,y\n1,2\n");
    write("open.csv", 'chapter,title\nA,"never closed\n');
    write("big.csv", "chapter,title\n" + "A,B\n".repeat(1_300_000));
    write("book.docx", "x");
    write("bin.md", Buffer.from([0xc3, 0x28, 0x00, 0x01]));
    const before = snapshot(join(s.root, "b"));
    for (const [source, code] of [
      ["src/xxe.opml", "import_failed"],
      ["src/bad.opml", "import_failed"],
      ["src/html.opml", "import_failed"],
      ["src/empty.md", "import_failed"],
      ["src/cols.csv", "import_failed"],
      ["src/open.csv", "import_failed"],
      ["src/big.csv", "import_failed"],
      ["src/book.docx", "source_invalid"],
      ["src/bin.md", "invalid_file"],
      ["src/missing.opml", "not_found"],
      ["../outside.opml", "path_escape"],
    ] as const) {
      const r = await s.call("cadabra_import_outline", { path: "b", source });
      expect(r.isError, source).toBe(true);
      expect(r.data.error.code, source).toBe(code);
    }
    expect(snapshot(join(s.root, "b"))).toEqual(before);
  });

  it("refuses a chapter file that is already on disk and a book that does not exist", async () => {
    s = await connect();
    await book();
    write("o.csv", "chapter,title\nA,S\n");
    const next = "manuscript/002-a.json";
    writeFileSync(join(s.root, "b", next), "{}");
    const r = await s.call("cadabra_import_outline", { path: "b", source: "src/o.csv" });
    expect(r.data.error.code).toBe("io_error");
    expect(existsSync(join(s.root, "b", next))).toBe(true);
    expect(readFileSync(join(s.root, "b", next), "utf8")).toBe("{}");
    expect(
      (await s.call("cadabra_import_outline", { path: "nope", source: "src/o.csv" })).data.error
        .code,
    ).toBe("not_a_project");
  });
});
