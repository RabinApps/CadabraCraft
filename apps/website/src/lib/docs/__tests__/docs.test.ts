import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listEntries } from "../entries";
import { parseFrontmatter } from "../frontmatter";
import { extractHeadings } from "../headings";

describe("frontmatter", () => {
  it("parses strings and numbers", () => {
    const { data, body } = parseFrontmatter('---\ntitle: "Hi: there"\norder: 3\nraw: x\n---\n\nBody');
    expect(data).toEqual({ title: "Hi: there", order: 3, raw: "x" });
    expect(body).toBe("\nBody");
  });

  it("returns the source when there is no frontmatter", () => {
    expect(parseFrontmatter("# Hi")).toEqual({ data: {}, body: "# Hi" });
  });
});

describe("headings", () => {
  it("lists h2 and h3 with unique ids and skips code fences", () => {
    const h = extractHeadings("## One\n\n```\n## Not a heading\n```\n\n### Two [link](/x)\n\n## One\n");
    expect(h).toEqual([
      { id: "one", text: "One", level: 2 },
      { id: "two-link", text: "Two link", level: 3 },
      { id: "one-1", text: "One", level: 2 },
    ]);
  });
});

describe.each(["docs", "guides"] as const)("%s content", (kind) => {
  const entries = listEntries("en", kind);

  it("has pages with complete frontmatter and unique order", () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.title, e.slug).not.toBe("");
      expect(e.description, e.slug).not.toBe("");
      expect(e.updated, e.slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.fallback).toBe(false);
    }
    expect(new Set(entries.map((e) => e.order)).size).toBe(entries.length);
  });

  it("has docs links that point at real pages and headings", () => {
    const docs = new Map(listEntries("en", "docs").map((e) => [e.slug, e]));
    for (const e of entries) {
      const src = readFileSync(path.join(process.cwd(), e.file.replace("apps/website/", "")), "utf8");
      for (const m of src.matchAll(/\]\(\/docs\/([\w-]+)\/(?:#([\w-]+))?\)/g)) {
        const target = docs.get(m[1] ?? "");
        expect(target, `${e.slug} -> ${m[0]}`).toBeDefined();
        if (m[2]) expect(target?.headings.map((h) => h.id), `${e.slug} -> ${m[0]}`).toContain(m[2]);
      }
    }
  });
});
