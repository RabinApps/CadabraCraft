import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type Session, connect } from "./helpers";

let s: Session;
afterEach(() => s.close());

const fresh = async () => {
  s = await connect({ epubcheckJar: null });
  await s.ok("cadabra_project_create", { path: "p", title: "T", author: "A" });
  return (await s.ok("cadabra_chapter_add", { path: "p", title: "One" })).chapter as {
    id: string;
    file: string;
  };
};
const doc = (textAlign?: string) => ({
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "One" }] },
    {
      type: "paragraph",
      ...(textAlign ? { attrs: { textAlign } } : {}),
      content: [{ type: "text", text: "Middle" }],
    },
  ],
});

describe("text alignment through the tools", () => {
  it("keeps textAlign when a chapter is written as JSON and read back, and on disk", async () => {
    const ch = await fresh();
    await s.ok("cadabra_chapter_write_json", { path: "p", chapterId: ch.id, doc: doc("center") });
    const read = await s.ok("cadabra_chapter_read", { path: "p", chapterId: ch.id });
    expect(read.doc.content[1].attrs).toEqual({ textAlign: "center" });
    const onDisk = JSON.parse(readFileSync(join(s.root, "p", ch.file), "utf8"));
    expect(onDisk.content[1].attrs).toEqual({ textAlign: "center" });
    expect((await s.ok("cadabra_project_validate", { path: "p" })).valid).toBe(true);
  });

  it("refuses an alignment that is not start, center or end", async () => {
    const ch = await fresh();
    const r = await s.call("cadabra_chapter_write_json", {
      path: "p",
      chapterId: ch.id,
      doc: doc("justify"),
    });
    expect(r.isError).toBe(true);
    expect(r.data.error.code).toBe("invalid_chapter_doc");
    expect(r.data.error.message).toMatch(/text alignment "justify" is not allowed/);
  });

  it("reads the div wrapper of Markdown as an alignment, and writes it back with htmlMarks", async () => {
    const ch = await fresh();
    await s.ok("cadabra_chapter_write_markdown", {
      path: "p",
      chapterId: ch.id,
      markdown: '# One\n\n<div align="right">\n\nEnd\n\n</div>\n\nplain\n',
    });
    const read = await s.ok("cadabra_chapter_read", { path: "p", chapterId: ch.id });
    expect(
      read.doc.content.map((n: { attrs?: { textAlign?: string } }) => n.attrs?.textAlign),
    ).toEqual([undefined, "end", undefined]);
    await s.ok("cadabra_export_markdown", { path: "p", htmlMarks: true });
    const md = readFileSync(join(s.root, "p", "exports/en/book.md"), "utf8");
    expect(md).toContain('<div align="right">\n\nEnd\n\n</div>');
    expect(md).toContain("\n\nplain\n");
  });
});
