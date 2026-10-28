import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CURRENT_FORMAT_VERSION } from "@cadabracraft/format";
import { type Session, connect, fullBook, seedBook } from "./helpers";

let s: Session;
afterEach(() => s.close());

describe("project_create / project_info", () => {
  it("creates the layout and a valid manifest, then reports an empty book", async () => {
    s = await connect();
    const created = await s.ok("cadabra_project_create", {
      path: "My Book",
      title: "My Book",
      author: "A. Writer",
    });
    expect(created.manifest).toMatchObject({
      formatVersion: CURRENT_FORMAT_VERSION,
      editions: [{ title: "My Book", author: "A. Writer", language: "en" }],
      template: "novel",
      chapters: [],
    });
    expect(created.manifest.editions[0].identifier).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
    for (const d of ["manuscript", "front-matter", "back-matter", "assets", "exports", ".cadabra"])
      expect(existsSync(join(s.root, "My Book", d)), d).toBe(true);
    const info = await s.ok("cadabra_project_info", { path: "My Book" });
    expect(info.totals).toEqual({ chapters: 0, words: 0 });
    expect(info.manifest.editions[0].title).toBe("My Book");
  });

  it("honours language and template, refuses an existing project, unknown templates and bad languages", async () => {
    s = await connect();
    const c = await s.ok("cadabra_project_create", {
      path: "p",
      title: "T",
      author: "A",
      language: "fr",
      template: "modern",
    });
    expect(c.manifest).toMatchObject({ editions: [{ language: "fr" }], template: "modern" });
    const again = await s.call("cadabra_project_create", { path: "p", title: "T2", author: "A" });
    expect(again.data.error.code).toBe("project_exists");
    expect(JSON.parse(readFileSync(join(s.root, "p/cadabra.json"), "utf8")).editions[0].title).toBe(
      "T",
    );
    expect(
      (
        await s.call("cadabra_project_create", {
          path: "q",
          title: "T",
          author: "A",
          template: "nope",
        })
      ).data.error.code,
    ).toBe("template_unknown");
    expect(
      (
        await s.call("cadabra_project_create", {
          path: "q",
          title: "T",
          author: "A",
          language: "not a tag!",
        })
      ).data.error.code,
    ).toBe("invalid_input");
    expect(existsSync(join(s.root, "q"))).toBe(false);
  });

  it("lists chapters with word counts in reading order", async () => {
    s = await connect();
    const { path } = await seedBook(s);
    const info = await s.ok("cadabra_project_info", { path });
    const book = fullBook();
    expect(info.entries.map((e: { title: string }) => e.title)).toEqual(
      book.chapters.map((c) => c.title),
    );
    expect(
      info.entries.every(
        (e: { words: number; section: string }) => e.words > 0 && e.section === "chapters",
      ),
    ).toBe(true);
    expect(info.totals.chapters).toBe(book.chapters.length);
    expect(info.totals.words).toBe(
      info.entries.reduce((n: number, e: { words: number }) => n + e.words, 0),
    );
    expect(info.assets).toEqual(["assets/gradient.png"]);
  });

  it("flags a chapter file that is missing instead of failing", async () => {
    s = await connect();
    const { path } = await seedBook(s);
    const info0 = await s.ok("cadabra_project_info", { path });
    const { rmSync } = await import("node:fs");
    rmSync(join(s.root, path, info0.entries[0].file));
    const info = await s.ok("cadabra_project_info", { path });
    expect(info.entries[0]).toMatchObject({ missing: true, words: 0 });
  });
});

describe("project_validate", () => {
  it("passes a healthy book", async () => {
    s = await connect();
    const { path } = await seedBook(s);
    const v = await s.ok("cadabra_project_validate", { path });
    expect(v).toMatchObject({ valid: true, errors: 0 });
  });

  it("reports an invalid manifest", async () => {
    s = await connect();
    mkdirSync(join(s.root, "bad"));
    writeFileSync(join(s.root, "bad/cadabra.json"), '{"formatVersion":1,"title":""}');
    const r = await s.ok("cadabra_project_validate", { path: "bad" });
    expect(r.valid).toBe(false);
    expect(r.issues[0]).toMatchObject({ severity: "error", code: "manifest_invalid" });
  });

  it("reports missing chapters, schema-invalid chapters, bad JSON and bad asset references", async () => {
    s = await connect();
    const { path, ids } = await seedBook(s);
    const info = await s.ok("cadabra_project_info", { path });
    const file = (i: number): string => join(s.root, path, info.entries[i].file);
    const { rmSync } = await import("node:fs");
    rmSync(file(0));
    writeFileSync(file(1), JSON.stringify({ type: "doc", content: [{ type: "bogusNode" }] }));
    writeFileSync(file(2), "{ not json");
    writeFileSync(
      file(3),
      JSON.stringify({
        type: "doc",
        content: [
          { type: "image", attrs: { src: "assets/missing.png" } },
          { type: "image", attrs: { src: "https://x.test/a.png" } },
          { type: "image", attrs: { src: "assets/gradient.png" } },
        ],
      }),
    );
    writeFileSync(join(s.root, path, "assets/fake.png"), "not a png");
    const v = await s.ok("cadabra_project_validate", { path });
    expect(v.valid).toBe(false);
    const codes = v.issues.map((i: { code: string; where: string }) => `${i.code}@${i.where}`);
    expect(codes).toContain(`chapter_missing@${ids[0]}`);
    expect(codes).toContain(`chapter_schema_invalid@${ids[1]}`);
    expect(codes).toContain(`chapter_json_invalid@${ids[2]}`);
    expect(codes).toContain(`asset_missing@${ids[3]}`);
    expect(codes).toContain(`asset_path_invalid@${ids[3]}`);
    expect(codes.filter((c: string) => c.startsWith("asset_") && c.endsWith(ids[3]!)).length).toBe(
      2,
    );
  });

  it("checks that referenced assets are real images", async () => {
    s = await connect();
    const { path, ids } = await seedBook(s);
    const added = await s.ok("cadabra_chapter_add", { path, title: "Img" });
    writeFileSync(join(s.root, path, "assets/fake.png"), "not a png");
    writeFileSync(
      join(s.root, path, added.chapter.file),
      JSON.stringify({
        type: "doc",
        content: [{ type: "image", attrs: { src: "assets/fake.png" } }],
      }),
    );
    const v = await s.ok("cadabra_project_validate", { path });
    expect(v.issues.map((i: { code: string }) => i.code)).toContain("asset_invalid");
    void ids;
  });
});

describe("templates", () => {
  it("lists the built-in templates", async () => {
    s = await connect();
    const t = await s.ok("cadabra_list_templates");
    expect(t.templates.map((x: { id: string }) => x.id).sort()).toEqual([
      "modern",
      "nonfiction",
      "novel",
      "poetry",
    ]);
    expect(t.templates[0]).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      description: expect.any(String),
      defaultTrimSize: expect.any(String),
    });
  });
  it("set_template changes the manifest, is idempotent and refuses unknown ids", async () => {
    s = await connect();
    await s.ok("cadabra_project_create", { path: "p", title: "T", author: "A" });
    const r1 = await s.ok("cadabra_set_template", { path: "p", template: "nonfiction" });
    const r2 = await s.ok("cadabra_set_template", { path: "p", template: "nonfiction" });
    expect(r1.template).toBe("nonfiction");
    expect(r2.template).toBe("nonfiction");
    expect(JSON.parse(readFileSync(join(s.root, "p/cadabra.json"), "utf8")).template).toBe(
      "nonfiction",
    );
    const bad = await s.call("cadabra_set_template", { path: "p", template: "nope" });
    expect(bad.data.error.code).toBe("template_unknown");
    expect(JSON.parse(readFileSync(join(s.root, "p/cadabra.json"), "utf8")).template).toBe(
      "nonfiction",
    );
  });
});

describe("opening a v3 project", () => {
  it("backs up cadabra.json, rewrites it as v4 and keeps every chapter file", async () => {
    s = await connect();
    const v3 = readFileSync(
      new URL("../../../../fixtures/contract/manifest-v3.json", import.meta.url),
      "utf8",
    );
    const pages = JSON.parse(v3);
    mkdirSync(join(s.root, "old/manuscript"), { recursive: true });
    mkdirSync(join(s.root, "old/front-matter"), { recursive: true });
    mkdirSync(join(s.root, "old/back-matter"), { recursive: true });
    writeFileSync(join(s.root, "old/cadabra.json"), v3);
    const doc = JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] });
    for (const e of [...pages.frontMatter, ...pages.chapters, ...pages.backMatter])
      writeFileSync(join(s.root, "old", e.file), doc);

    const info = await s.ok("cadabra_project_info", { path: "old" });
    expect(info.manifest).toMatchObject({
      formatVersion: CURRENT_FORMAT_VERSION,
      editions: [{ language: "en", title: pages.title, author: pages.author }],
    });
    expect(info.manifest.chapters.map((c: { files: { en: string } }) => c.files.en)).toEqual(
      pages.chapters.map((c: { file: string }) => c.file),
    );

    const backups = readdirSync(join(s.root, "old/.cadabra/backups")).filter((f) =>
      f.startsWith("cadabra-"),
    );
    expect(backups).toHaveLength(1);
    expect(readFileSync(join(s.root, "old/.cadabra/backups", backups[0]!), "utf8")).toBe(v3);
    const onDisk = JSON.parse(readFileSync(join(s.root, "old/cadabra.json"), "utf8"));
    expect(onDisk.formatVersion).toBe(CURRENT_FORMAT_VERSION);
    expect(onDisk.editions[0].title).toBe(pages.title);
    for (const e of [...pages.frontMatter, ...pages.chapters, ...pages.backMatter])
      expect(existsSync(join(s.root, "old", e.file))).toBe(true);
  });
});
