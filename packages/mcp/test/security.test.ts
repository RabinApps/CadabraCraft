import { existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type Session, connect, snapshot, tmpRoot } from "./helpers";

let s: Session;
afterEach(() => s.close());

// Every tool that takes a project `path` with the minimal remaining arguments it needs.
const PATH_TOOLS: [string, Record<string, unknown>][] = [
  ["cadabra_project_create", { title: "T", author: "A" }],
  ["cadabra_project_info", {}],
  ["cadabra_project_validate", {}],
  ["cadabra_chapter_add", { title: "X" }],
  ["cadabra_chapter_rename", { chapterId: "ch-1", title: "X" }],
  ["cadabra_chapter_move", { chapterId: "ch-1", delta: 1 }],
  ["cadabra_chapter_remove", { chapterId: "ch-1" }],
  ["cadabra_chapter_read", { chapterId: "ch-1" }],
  ["cadabra_chapter_write_markdown", { chapterId: "ch-1", markdown: "# x" }],
  ["cadabra_chapter_write_json", { chapterId: "ch-1", doc: { type: "doc", content: [{ type: "paragraph" }] } }],
  ["cadabra_export_epub", {}],
  ["cadabra_export_pdf", {}],
  ["cadabra_inspect_pdf", {}],
  ["cadabra_inspect_epub", {}],
  ["cadabra_set_template", { template: "novel" }],
];

describe("every path is confined to the workspace root", () => {
  for (const [tool, extra] of PATH_TOOLS) {
    it(`${tool} refuses ../, absolute and symlink escapes`, async () => {
      s = await connect();
      const outside = tmpRoot();
      mkdirSync(join(outside, "victim"));
      writeFileSync(join(outside, "victim/cadabra.json"), "{}");
      symlinkSync(outside, join(s.root, "link"));
      const before = snapshot(outside);
      for (const path of ["../" + "escape", "../../etc", outside, join(outside, "victim"), "link", "link/victim", "a/../../x", "\0"]) {
        const r = await s.call(tool, { path, ...extra });
        expect(r.isError, `${tool} ${JSON.stringify(path)}`).toBe(true);
        expect(r.data?.error?.code ?? "invalid_input", `${tool} ${JSON.stringify(path)}`).toMatch(/path_escape|invalid_input/);
      }
      expect(snapshot(outside)).toEqual(before);
      expect(readdirSync(outside)).toEqual(["victim"]);
    });
  }

  it("import_file refuses an escaping source or destination and writes nothing outside", async () => {
    s = await connect();
    const outside = tmpRoot();
    writeFileSync(join(outside, "b.md"), "# Hi\n\ntext");
    symlinkSync(join(outside, "b.md"), join(s.root, "b.md"));
    writeFileSync(join(s.root, "ok.md"), "# Hi\n\ntext");
    for (const source of [join(outside, "b.md"), "../b.md", "b.md"]) {
      const r = await s.call("cadabra_import_file", { source, destination: "new" });
      expect(r.data.error.code, source).toBe("path_escape");
    }
    for (const destination of [join(outside, "dest"), "../dest", "x/../../dest"]) {
      const r = await s.call("cadabra_import_file", { source: "ok.md", destination });
      expect(r.data.error.code, destination).toBe("path_escape");
    }
    expect(readdirSync(outside)).toEqual(["b.md"]);
    expect(existsSync(join(s.root, "new"))).toBe(false);
  });

  it("a symlinked folder inside a project cannot be used to write outside it", async () => {
    s = await connect();
    await s.ok("cadabra_project_create", { path: "p", title: "T", author: "A" });
    const outside = tmpRoot();
    const { rmSync } = await import("node:fs");
    rmSync(join(s.root, "p/exports"), { recursive: true });
    symlinkSync(outside, join(s.root, "p/exports"));
    await s.ok("cadabra_chapter_add", { path: "p", title: "One" });
    const r = await s.call("cadabra_export_epub", { path: "p" });
    expect(r.isError).toBe(true);
    expect(r.data.error.code).toBe("path_escape");
    expect(readdirSync(outside)).toEqual([]);
  });

  it("allows an absolute path that is inside the root", async () => {
    s = await connect();
    const r = await s.ok("cadabra_project_create", { path: join(s.root, "abs"), title: "T", author: "A" });
    expect(r.root).toBe(join(s.root, "abs"));
  });
});
