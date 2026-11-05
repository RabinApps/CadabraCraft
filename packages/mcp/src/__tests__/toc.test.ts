import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// resolveToc runs before the manifest is saved: the hook lets one test change cadabra.json from outside at that moment.
const hook = vi.hoisted(() => ({ beforeSave: null as null | (() => void), failSave: false }));
vi.mock("@cadabracraft/format", async (orig) => {
  const real = await orig<typeof import("@cadabracraft/format")>();
  return {
    ...real,
    resolveToc: (...a: Parameters<typeof real.resolveToc>) => {
      hook.beforeSave?.();
      return real.resolveToc(...a);
    },
  };
});

// One test makes the manifest save fail, after the Contents file has been written.
vi.mock("../project", async (orig) => {
  const real = await orig<typeof import("../project")>();
  return {
    ...real,
    saveManifest: (...a: Parameters<typeof real.saveManifest>) => {
      if (hook.failSave) throw new Error("disk full");
      return real.saveManifest(...a);
    },
  };
});

import { type Session, connect, seedBook } from "./helpers";

let s: Session;
afterEach(async () => {
  hook.beforeSave = null;
  hook.failSave = false;
  await s.close();
});

interface Toc {
  contentsId: string;
  language: string;
  settings: { depth: number; pageNumbers: boolean; parts: boolean };
  items: {
    key: string;
    kind: string;
    level: number;
    indent?: number;
    title: string;
    renamed: boolean;
    hidden: boolean;
  }[];
  stale: { kind: string; key: string; field?: string }[];
  [k: string]: unknown;
}
const manifestPath = () => join(s.root, "book/cadabra.json");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const manifest = (): any => JSON.parse(readFileSync(manifestPath(), "utf8"));
const toc = (): {
  depth: number;
  pageNumbers: boolean;
  parts: boolean;
  hidden: string[];
  titles: Record<string, Record<string, string>>;
  order?: string[];
  custom: { id: string; titles: Record<string, string>; after: string; target?: string }[];
} => manifest().frontMatter.find((e: { kind?: string }) => e.kind === "contents").toc;
const get = (args: Record<string, unknown> = {}): Promise<Toc> =>
  s.ok("cadabra_toc_get", { path: "book", ...args });
const update = (
  args: Record<string, unknown>,
): Promise<
  Toc & { changed: boolean; created?: string; conflictCopy: string | null; manifestHash: string }
> => s.ok("cadabra_toc_update", { path: "book", ...args });
const fail = async (name: string, args: Record<string, unknown>): Promise<string> => {
  const r = await s.call(name, { path: "book", ...args });
  expect(r.isError, JSON.stringify(args)).toBe(true);
  return r.data.error.code;
};
const keys = (t: Toc) => t.items.map((i) => i.key);

async function book(withPage = true) {
  s = await connect();
  const seeded = await seedBook(s);
  if (withPage) await update({ action: "add_page" });
  return seeded.ids;
}

describe("cadabra_toc_update add_page", () => {
  it("adds the Contents page, writes its file first and lists the chapters", async () => {
    const ids = await book(false);
    expect(await fail("cadabra_toc_get", {})).toBe("toc_no_contents_page");
    const r = await update({ action: "add_page" });
    expect(r).toMatchObject({
      changed: true,
      created: "fm-1",
      contentsId: "fm-1",
      conflictCopy: null,
    });
    expect(r.settings).toEqual({ depth: 0, pageNumbers: true, parts: true });
    expect(keys(r)).toEqual(ids);
    const entry = manifest().frontMatter[0];
    expect(entry).toMatchObject({ id: "fm-1", kind: "contents", titles: { "en-GB": "Contents" } });
    expect(entry.toc).toBeUndefined();
    const doc = JSON.parse(readFileSync(join(s.root, "book", entry.files["en-GB"]), "utf8"));
    expect(doc.content[0]).toMatchObject({ type: "heading", attrs: { level: 1 } });
    expect(JSON.stringify(manifest())).not.toContain(s.root);
  });

  it("refuses a second Contents page and an unlisted file in the way", async () => {
    await book();
    expect(await fail("cadabra_toc_update", { action: "add_page" })).toBe("toc_page_exists");
    expect(manifest().frontMatter).toHaveLength(1);
  });

  it("takes the new file back when the manifest cannot be saved, so adding the page can be retried", async () => {
    await book(false);
    hook.failSave = true;
    expect(await fail("cadabra_toc_update", { action: "add_page" })).not.toBe("toc_page_exists");
    const dir = join(s.root, "book/front-matter");
    expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
    expect(manifest().frontMatter).toEqual([]);
    hook.failSave = false;
    const retry = await update({ action: "add_page" });
    expect(retry.changed).toBe(true);
    expect(readdirSync(dir)).toHaveLength(1);
  });

  it("a failed save of any other action changes nothing and removes no file", async () => {
    await book(true);
    const before = readFileSync(manifestPath(), "utf8");
    const dir = join(s.root, "book/front-matter");
    const files = readdirSync(dir);
    hook.failSave = true;
    expect(await fail("cadabra_toc_update", { action: "set_depth", depth: 2 })).not.toBe(
      "toc_no_contents_page",
    );
    expect(readFileSync(manifestPath(), "utf8")).toBe(before);
    expect(readdirSync(dir)).toEqual(files);
  });

  it("refuses to overwrite a file that exists but is not listed", async () => {
    await book(false);
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(s.root, "book/front-matter"), { recursive: true });
    const probe = await update({ action: "add_page" });
    const file = manifest().frontMatter[0].files["en-GB"] as string;
    expect(probe.changed).toBe(true);
    // remove the entry again, leave the file, and retry
    const m = manifest();
    m.frontMatter = [];
    writeFileSync(manifestPath(), JSON.stringify(m));
    expect(existsSync(join(s.root, "book", file))).toBe(true);
    expect(await fail("cadabra_toc_update", { action: "add_page" })).toBe("io_error");
  });
});

describe("cadabra_toc_get", () => {
  it("returns settings, keys, levels and titles; depth 0 lists chapters only", async () => {
    const ids = await book();
    const t = await get();
    expect(t.language).toBe("en-GB");
    expect(t.items.map((i) => [i.key, i.kind, i.level, i.renamed, i.hidden])).toEqual(
      ids.map((id) => [id, "page", 0, false, false]),
    );
    expect(t.items.map((i) => i.title)).toEqual([
      "The Quay",
      "What the Letter Said",
      "Hostile Characters",
      "Afterword",
    ]);
    expect(t.stale).toEqual([]);
    const text = (await s.call("cadabra_toc_get", { path: "book" })).texts[0];
    expect(text).toBe("Contents fm-1: 4 item(s), depth 0");
  });

  it.each([
    [
      1,
      [
        "ch-1",
        "ch-1#1:the quay:0",
        "ch-2",
        "ch-2#1:what the letter said:0",
        "ch-3",
        "ch-3#1:hostile characters:0",
        "ch-4",
        "ch-4#1:afterword:0",
      ],
      8,
    ],
    [2, null, 10],
    [3, null, 11],
  ])("depth %i lists headings up to that level", async (depth, expected, count) => {
    await book();
    await update({ action: "set_depth", depth });
    const t = await get();
    if (expected) expect(keys(t)).toEqual(expected);
    expect(t.items).toHaveLength(count);
    const levels = t.items.map((i) => i.level);
    expect(Math.max(...levels)).toBe(depth);
    const h = t.items.find((i) => i.level === 2);
    if (depth >= 2)
      expect(h).toMatchObject({
        key: "ch-1#2:morning:0",
        kind: "heading",
        title: "Morning",
        entryId: "ch-1",
        index: 1,
      });
    expect(await get()).toEqual(t); // read-only: same answer, manifest unchanged
  });

  it("reports stale overrides and keeps them on disk", async () => {
    await book();
    await update({ action: "set_depth", depth: 2 });
    await update({ action: "hide", key: "ch-1#2:morning:0" });
    await update({ action: "rename", key: "ch-4#2:thanks:0", title: "Acknowledgements" });
    await update({ action: "move", key: "ch-1#2:morning:0", to: 0 });
    const custom = await update({
      action: "add_custom",
      title: "Extra",
      after: "ch-4#2:thanks:0",
      target: "ch-4#2:thanks:0",
    });
    expect(custom.created).toBe("custom:c-1");
    await update({ action: "set_depth", depth: 0 });
    const t = await get();
    expect(t.stale).toEqual(
      expect.arrayContaining([
        { kind: "hidden", key: "ch-1#2:morning:0" },
        { kind: "title", key: "ch-4#2:thanks:0" },
        { kind: "order", key: "ch-1#2:morning:0" },
        { kind: "custom", key: "custom:c-1", field: "after" },
        { kind: "custom", key: "custom:c-1", field: "target" },
      ]),
    );
    expect(t.items.find((i) => i.key === "custom:c-1")).toMatchObject({
      stale: true,
      target: "ch-4#2:thanks:0",
      title: "Extra",
    });
    expect(toc().hidden).toEqual(["ch-1#2:morning:0"]);
    // remove clears a stale key, show also accepts it
    const r = await update({ action: "remove", key: "ch-1#2:morning:0" });
    expect(r.stale.map((x) => x.key)).not.toContain("ch-1#2:morning:0");
    expect(toc().hidden).toEqual([]);
    await update({ action: "remove", key: "custom:c-1" });
    await update({ action: "remove", key: "ch-4#2:thanks:0" });
    expect((await get()).stale.every((x) => x.kind === "order")).toBe(true); // the stored order still names the headings
    await update({ action: "hide", key: "ch-1" });
    await update({ action: "set_depth", depth: 2 });
    await update({ action: "hide", key: "ch-1#2:morning:0" });
    await update({ action: "set_depth", depth: 0 });
    const shown = await update({ action: "show", key: "ch-1#2:morning:0" });
    expect(shown.stale.some((x) => x.kind === "hidden")).toBe(false);
  });

  it("reads outlines in the requested edition and skips pages without text there", async () => {
    await book();
    await s.ok("cadabra_edition_add", { path: "book", language: "fr", mode: "copy" });
    await update({ action: "set_depth", depth: 2 });
    const doc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Le quai" }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Matin" }] },
      ],
    };
    await s.ok("cadabra_chapter_write_json", {
      path: "book",
      chapterId: "ch-1",
      doc,
      language: "fr",
    });
    await s.ok("cadabra_chapter_rename", {
      path: "book",
      chapterId: "ch-1",
      title: "Le quai",
      language: "fr",
    });
    await s.ok("cadabra_chapter_add", { path: "book", title: "Fresh" }); // source only: no fr text
    const fr = await get({ language: "fr" });
    expect(fr.language).toBe("fr");
    expect(fr.items.filter((i) => i.key.startsWith("ch-1")).map((i) => [i.key, i.title])).toEqual([
      ["ch-1", "Le quai"],
      ["ch-1#1:le quai:0", "Le quai"],
      ["ch-1#2:matin:0", "Matin"],
    ]);
    expect(fr.items.find((i) => i.key === "ch-5")).toMatchObject({ kind: "page", title: "Fresh" });
    expect(keys(fr).filter((k) => k.startsWith("ch-5#"))).toEqual([]);
    // the source edition is unchanged
    expect((await get()).items.find((i) => i.key === "ch-1#2:morning:0")!.title).toBe("Morning");
  });

  it("leaves out the unlisted kinds and the Contents page itself", async () => {
    await book();
    const m = manifest();
    m.frontMatter.unshift({
      id: "fm-9",
      kind: "title-page",
      titles: { "en-GB": "Title" },
      files: { "en-GB": m.chapters[0].files["en-GB"] },
    });
    writeFileSync(manifestPath(), JSON.stringify(m));
    const t = await get();
    expect(keys(t)).not.toContain("fm-9");
    expect(keys(t)).not.toContain("fm-1");
    await update({ action: "set_depth", depth: 1 });
    expect(keys(await get())).not.toContain("fm-9");
  });

  it("fails clearly for an unknown edition, a missing project and a broken chapter file", async () => {
    await book();
    expect(await fail("cadabra_toc_get", { language: "de" })).toBe("language_not_found");
    expect(
      await fail("cadabra_toc_update", { action: "set_depth", depth: 1, language: "de" }),
    ).toBe("language_not_found");
    const r = await s.call("cadabra_toc_get", { path: "nope" });
    expect(r.data.error.code).toBe("not_a_project");
    await update({ action: "set_depth", depth: 1 });
    const file = manifest().chapters[1].files["en-GB"] as string;
    writeFileSync(join(s.root, "book", file), "{ nope");
    expect(await fail("cadabra_toc_get", {})).toBe("chapter_json_invalid");
    rmSync(join(s.root, "book", file));
    expect(await fail("cadabra_toc_get", {})).toBe("chapter_missing");
  });

  it("says toc_no_contents_page for every action but add_page", async () => {
    await book(false);
    for (const args of [
      { action: "set_depth", depth: 1 },
      { action: "reset" },
      { action: "hide", key: "ch-1" },
    ])
      expect(await fail("cadabra_toc_update", args)).toBe("toc_no_contents_page");
    expect(manifest().frontMatter).toEqual([]);
  });
});

describe("cadabra_toc_update actions", () => {
  it("sets depth and page numbers in the manifest", async () => {
    await book();
    const d = await update({ action: "set_depth", depth: 3 });
    expect(d.settings).toEqual({ depth: 3, pageNumbers: true, parts: true });
    expect(toc()).toMatchObject({
      depth: 3,
      pageNumbers: true,
      parts: true,
      hidden: [],
      titles: {},
      custom: [],
    });
    const p = await update({ action: "set_page_numbers", pageNumbers: false });
    expect(p.settings).toEqual({ depth: 3, pageNumbers: false, parts: true });
    expect(toc()).toMatchObject({ depth: 3, pageNumbers: false, parts: true });
    expect(manifest().formatVersion).toBeGreaterThanOrEqual(7);
  });

  it("renames in the edition's language, and an empty title reverts", async () => {
    await book();
    const r = await update({ action: "rename", key: "ch-2", title: "  The Letter " });
    expect(r.items.find((i) => i.key === "ch-2")).toMatchObject({
      title: "The Letter",
      renamed: true,
    });
    expect(toc().titles).toEqual({ "ch-2": { "en-GB": "The Letter" } });
    expect(manifest().chapters[1].titles["en-GB"]).toBe("What the Letter Said"); // chapter itself untouched
    await s.ok("cadabra_edition_add", { path: "book", language: "fr", mode: "copy" });
    await update({ action: "rename", key: "ch-2", title: "La lettre", language: "fr" });
    expect(toc().titles["ch-2"]).toEqual({ "en-GB": "The Letter", fr: "La lettre" });
    const back = await update({ action: "rename", key: "ch-2", title: " ", language: "fr" });
    expect(toc().titles["ch-2"]).toEqual({ "en-GB": "The Letter" });
    expect(back.items.find((i) => i.key === "ch-2")).toMatchObject({
      renamed: false,
      title: "What the Letter Said",
    }); // fr view: no fr rename left;
    await update({ action: "rename", key: "ch-2", title: "" });
    expect(toc().titles).toEqual({});
  });

  it("turns parts on and off and keeps the choice through reset", async () => {
    await book();
    const off = await update({ action: "set_parts", parts: false });
    expect(off.settings).toMatchObject({ parts: false });
    expect(toc().parts).toBe(false);
    const reset = await update({ action: "reset" });
    expect(reset.settings).toMatchObject({ parts: false });
    const on = await update({ action: "set_parts", parts: true });
    expect(on.settings).toMatchObject({ parts: true });
  });

  it("hides and shows items", async () => {
    await book();
    const h = await update({ action: "hide", key: "ch-3" });
    expect(h.items.find((i) => i.key === "ch-3")!.hidden).toBe(true);
    expect(h.items).toHaveLength(4); // hidden items stay in the list, flagged
    expect(toc().hidden).toEqual(["ch-3"]);
    await update({ action: "hide", key: "ch-3" });
    expect(toc().hidden).toEqual(["ch-3"]);
    const v = await update({ action: "show", key: "ch-3" });
    expect(v.items.find((i) => i.key === "ch-3")!.hidden).toBe(false);
    expect(toc().hidden).toEqual([]);
  });

  it("moves an item to a position (clamped) and does nothing when it is already there", async () => {
    await book();
    const m = await update({ action: "move", key: "ch-4", to: 1 });
    expect(keys(m)).toEqual(["ch-1", "ch-4", "ch-2", "ch-3"]);
    expect(m.changed).toBe(true);
    expect(toc().order).toEqual(["ch-1", "ch-4", "ch-2", "ch-3"]);
    expect(keys(await update({ action: "move", key: "ch-4", to: -5 }))).toEqual([
      "ch-4",
      "ch-1",
      "ch-2",
      "ch-3",
    ]);
    expect(keys(await update({ action: "move", key: "ch-4", to: 99 }))).toEqual([
      "ch-1",
      "ch-2",
      "ch-3",
      "ch-4",
    ]);
    const same = await update({ action: "move", key: "ch-4", to: 3 });
    expect(same.changed).toBe(false);
    expect(same.conflictCopy).toBeNull();
  });

  it("adds, renames and removes custom entries", async () => {
    await book();
    const a = await update({ action: "add_custom", title: " Preface note ", after: "ch-1" });
    expect(a).toMatchObject({ created: "custom:c-1" });
    expect(keys(a)).toEqual(["ch-1", "custom:c-1", "ch-2", "ch-3", "ch-4"]);
    expect(toc().custom).toEqual([
      { id: "c-1", titles: { "en-GB": "Preface note" }, after: "ch-1" },
    ]);
    const b = await update({
      action: "add_custom",
      title: "See also",
      after: "ch-4",
      target: "ch-1",
    });
    expect(b.created).toBe("custom:c-2");
    expect(toc().custom[1]).toEqual({
      id: "c-2",
      titles: { "en-GB": "See also" },
      after: "ch-4",
      target: "ch-1",
    });
    expect(b.items.find((i) => i.key === "custom:c-2")).toMatchObject({
      target: "ch-1",
      entryId: "ch-1",
      kind: "custom",
    });
    const r = await update({ action: "rename", key: "custom:c-1", title: "Note" });
    expect(r.items.find((i) => i.key === "custom:c-1")!.title).toBe("Note");
    const gone = await update({ action: "remove", key: "custom:c-1" });
    expect(keys(gone)).not.toContain("custom:c-1");
    expect(toc().custom.map((c) => c.id)).toEqual(["c-2"]);
  });

  it("removes one override and resets all of them, keeping depth and page numbers", async () => {
    await book();
    await update({ action: "set_depth", depth: 1 });
    await update({ action: "set_page_numbers", pageNumbers: false });
    await update({ action: "rename", key: "ch-1", title: "Dock" });
    await update({ action: "hide", key: "ch-1" });
    await update({ action: "move", key: "ch-3", to: 0 });
    await update({ action: "add_custom", title: "Extra", after: "ch-2" });
    const r = await update({ action: "remove", key: "ch-1" });
    expect(r.items.find((i) => i.key === "ch-1")).toMatchObject({
      title: "The Quay",
      renamed: false,
      hidden: false,
    });
    expect(toc().titles).toEqual({});
    expect(toc().order).not.toContain("ch-1");
    const reset = await update({ action: "reset" });
    expect(reset.settings).toEqual({ depth: 1, pageNumbers: false, parts: true });
    expect(toc()).toEqual({
      depth: 1,
      pageNumbers: false,
      parts: true,
      hidden: [],
      titles: {},
      custom: [],
    });
  });
});

describe("cadabra_toc_update errors", () => {
  it("refuses unknown keys without touching the manifest", async () => {
    await book();
    const before = readFileSync(manifestPath(), "utf8");
    const bad = [
      { action: "rename", key: "ch-99", title: "x" },
      { action: "hide", key: "ch-1#1:nope:0" },
      { action: "show", key: "nope" },
      { action: "move", key: "nope", to: 0 },
      { action: "remove", key: "custom:c-9" },
      { action: "add_custom", title: "x", after: "nope" },
      { action: "add_custom", title: "x", after: "ch-1", target: "nope" },
    ];
    for (const args of bad)
      expect(await fail("cadabra_toc_update", args), JSON.stringify(args)).toBe(
        "toc_item_not_found",
      );
    expect(readFileSync(manifestPath(), "utf8")).toBe(before);
    const r = await s.call("cadabra_toc_update", { path: "book", action: "hide", key: "zz" });
    expect(r.data.error.details).toEqual({ key: "zz" });
  });

  it("refuses missing or empty arguments with invalid_input", async () => {
    await book();
    const bad = [
      { action: "set_depth" },
      { action: "set_page_numbers" },
      { action: "rename", title: "x" },
      { action: "rename", key: "ch-1" },
      { action: "hide" },
      { action: "show" },
      { action: "move", key: "ch-1" },
      { action: "move", to: 1 },
      { action: "add_custom", after: "ch-1" },
      { action: "add_custom", title: "x" },
      { action: "add_custom", title: "  ", after: "ch-1" },
      { action: "remove" },
    ];
    for (const args of bad)
      expect(await fail("cadabra_toc_update", args), JSON.stringify(args)).toBe("invalid_input");
    await update({ action: "add_custom", title: "x", after: "ch-1" });
    expect(
      await fail("cadabra_toc_update", { action: "rename", key: "custom:c-1", title: " " }),
    ).toBe("invalid_input");
    // schema-level: depth out of range, unknown action
    for (const args of [
      { action: "set_depth", depth: 4 },
      { action: "set_depth", depth: 1.5 },
      { action: "explode" },
      { action: "hide", key: "" },
    ]) {
      const r = await s.call("cadabra_toc_update", { path: "book", ...args });
      expect(r.isError, JSON.stringify(args)).toBe(true);
    }
    expect(toc().depth).toBe(0);
  });
});

describe("cadabra_toc_update saving", () => {
  it("returns the new manifestHash and no conflict copy on a clean save", async () => {
    await book();
    const r = await update({ action: "set_depth", depth: 1 });
    expect(r.conflictCopy).toBeNull();
    expect(r.manifestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(readdirSync(join(s.root, "book")).filter((n) => n.includes("conflict"))).toEqual([]);
  });

  it("keeps the other version as a conflict copy when cadabra.json changed since it was read", async () => {
    await book();
    const external = manifest();
    external.title = "Edited elsewhere";
    hook.beforeSave = () => {
      hook.beforeSave = null;
      writeFileSync(manifestPath(), JSON.stringify(external));
    };
    const r = await update({ action: "hide", key: "ch-1" });
    expect(r.conflictCopy).toMatch(/^cadabra\.conflict-\d{8}-\d{4}\.json$/);
    expect(JSON.parse(readFileSync(join(s.root, "book", r.conflictCopy!), "utf8")).title).toBe(
      "Edited elsewhere",
    );
    expect(toc().hidden).toEqual(["ch-1"]);
  });

  it("serialises concurrent updates so none is lost", async () => {
    await book();
    await Promise.all(
      ["ch-1", "ch-2", "ch-3", "ch-4"].map((key) => update({ action: "hide", key })),
    );
    expect(toc().hidden.sort()).toEqual(["ch-1", "ch-2", "ch-3", "ch-4"]);
    await Promise.all(
      [1, 2, 3].map((n) => update({ action: "add_custom", title: `C${n}`, after: "ch-1" })),
    );
    expect(
      toc()
        .custom.map((c) => c.id)
        .sort(),
    ).toEqual(["c-1", "c-2", "c-3"]);
  });
});
