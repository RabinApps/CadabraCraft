import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  FormatError,
  addChapter,
  addFrontMatter,
  addLinkReference,
  addNoteReference,
  addReference,
  MAX_NOTE_CHARS,
  MAX_URL_CHARS,
  migrateV11ToV12,
  normalizeWebUrl,
  createManifest,
  danglingLinks,
  linksOf,
  moveReference,
  relink,
  migrateV4ToV5,
  nextReferenceId,
  parseManifest,
  referencesFor,
  removeChapter,
  removeMatter,
  removeReference,
  serializeManifest,
  unlinkEntry,
  updateReference,
  validateManifest,
  validateReferences,
  type Manifest,
} from "../index";

const AT = "2026-10-28T09:30:00.000Z";
const book = (): Manifest => {
  const m = createManifest({ title: "T", author: "A", identifier: "urn:uuid:x" });
  return addChapter(addChapter(m, "One").manifest, "Two").manifest;
};
const ref = (over: Record<string, unknown> = {}) => ({
  id: "ref-1",
  kind: "file" as const,
  file: "references/map.png",
  title: "Map",
  note: "",
  tags: [],
  chapters: [],
  addedAt: AT,
  ...over,
});
const link = (over: Record<string, unknown> = {}) => {
  const { file: _file, ...rest } = ref();
  return { ...rest, kind: "link", url: "https://example.org/a", ...over };
};
const note = (over: Record<string, unknown> = {}) => {
  const { file: _file, ...rest } = ref();
  return { ...rest, kind: "note", text: "Remember the tide.", ...over };
};
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("migration v4 -> v5", () => {
  it("adds an empty reference list and loses nothing", () => {
    const v4 = read("../../../../fixtures/contract/manifest-v4.json");
    const before = JSON.parse(v4);
    const r = parseManifest(v4);
    expect(r.migrated).toBe(true);
    expect(r.fromVersion).toBe(4);
    expect(r.manifest.formatVersion).toBe(12);
    expect(r.manifest.references).toEqual([]);
    expect(r.manifest.editions).toEqual(before.editions);
    expect(r.manifest.chapters).toEqual(before.chapters);
    expect(r.manifest.frontMatter).toEqual(before.frontMatter);
    expect(r.manifest.backMatter).toEqual(before.backMatter);
    expect(r.manifest.template).toBe(before.template);
  });
  it("is a pure step that only adds the list", () => {
    const raw = { formatVersion: 4, template: "novel" };
    expect(migrateV4ToV5(raw)).toEqual({ ...raw, references: [] });
    expect(raw).not.toHaveProperty("references");
  });
  it("serializes as v5 and reopens without migrating again", () => {
    const again = parseManifest(
      serializeManifest(
        parseManifest(read("../../../../fixtures/contract/manifest-v3.json")).manifest,
      ),
    );
    expect(again.migrated).toBe(false);
  });
  it("refuses a v5 manifest without the list", () => {
    const o = { ...createManifest({ title: "T", author: "A", identifier: "u" }) } as Record<
      string,
      unknown
    >;
    delete o.references;
    expect(() => validateManifest(o)).toThrow('"references" must be an array');
  });
});

describe("validateReferences", () => {
  it("accepts a full reference and a name without extension", () => {
    const list = validateReferences([
      ref({ note: "n", tags: ["a", "b"], chapters: ["ch-1"] }),
      ref({ id: "ref-2", file: "references/notes" }),
    ]);
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual(ref({ note: "n", tags: ["a", "b"], chapters: ["ch-1"] }));
  });
  it.each([
    ["not a list", {}, /must be an array/],
    ["no id", [ref({ id: "" })], /references\[0\]\.id/],
    ["bad id", [ref({ id: "1x" })], /must start with a letter/],
    ["duplicate id", [ref(), ref({ file: "references/b.png" })], /duplicate reference id/],
    ["no file", [ref({ file: 3 })], /references\[0\]\.file/],
    ["outside folder", [ref({ file: "assets/map.png" })], /references\/<name>/],
    ["subfolder", [ref({ file: "references/a/b.png" })], /references\/<name>/],
    ["parent path", [ref({ file: "references/../x.png" })], /references\/<name>/],
    ["uppercase extension", [ref({ file: "references/a.PNG" })], /references\/<name>/],
    ["duplicate file", [ref(), ref({ id: "ref-2" })], /duplicate reference file/],
    ["empty title", [ref({ title: "" })], /title/],
    ["note not text", [ref({ note: 1 })], /note/],
    ["tags not a list", [ref({ tags: "a" })], /tags/],
    ["empty tag", [ref({ tags: [""] })], /tags\[0\]/],
    ["duplicate tag", [ref({ tags: ["a", "a"] })], /duplicate tag/],
    ["chapters not a list", [ref({ chapters: null })], /chapters/],
    ["bad date", [ref({ addedAt: "yesterday" })], /date and time/],
    ["missing date", [ref({ addedAt: undefined })], /addedAt/],
    ["null item", [null], /references\[0\]\.id/],
    ["no kind", [ref({ kind: undefined })], /kind/],
    ["unknown kind", [ref({ kind: "video" })], /kind/],
    [
      "a url on a file",
      [ref({ url: "https://a.org/" })],
      /"references\[0\]\.url" is not allowed on a file/,
    ],
    ["a text on a file", [ref({ text: "x" })], /\.text" is not allowed/],
    ["a file on a link", [link({ file: "references/a.png" })], /\.file" is not allowed on a link/],
    ["a link without url", [link({ url: undefined })], /\.url/],
    ["a link with javascript", [link({ url: "javascript:alert(1)" })], /http or https/],
    ["a link not normalized", [link({ url: "https://a.org" })], /http or https/],
    ["a note without text", [note({ text: undefined })], /\.text/],
    ["a note that is too long", [note({ text: "x".repeat(MAX_NOTE_CHARS + 1) })], /longer than/],
    ["a note with a url", [note({ url: "https://a.org/" })], /\.url" is not allowed on a note/],
  ])("rejects %s", (_, input, message) => {
    expect(() => validateReferences(input)).toThrow(FormatError);
    expect(() => validateReferences(input)).toThrow(message);
  });
  it("allows a link to a chapter that is gone (the book still opens)", () => {
    const m = { ...book(), references: [ref({ chapters: ["ch-99"] })] };
    expect(validateManifest(m).references[0]!.chapters).toEqual(["ch-99"]);
    expect(danglingLinks(m)).toEqual([{ reference: "ref-1", chapter: "ch-99" }]);
  });
});

describe("reference edits", () => {
  it("adds a reference with a fresh id, empty note, no tags and no links", () => {
    const a = addReference(book(), { file: "references/a.pdf", title: "A", addedAt: AT });
    const b = addReference(a.manifest, { file: "references/b.pdf", title: "B", addedAt: AT });
    expect(a.reference).toEqual(ref({ id: "ref-1", file: "references/a.pdf", title: "A" }));
    expect(b.manifest.references.map((r) => r.id)).toEqual(["ref-1", "ref-2"]);
    expect(validateManifest(b.manifest).references).toHaveLength(2);
  });
  it("never reuses an id after a removal", () => {
    let m = addReference(book(), { file: "references/a.pdf", title: "A", addedAt: AT }).manifest;
    m = addReference(m, { file: "references/b.pdf", title: "B", addedAt: AT }).manifest;
    m = removeReference(m, "ref-1").manifest;
    expect(nextReferenceId(m)).toBe("ref-3");
    expect(
      nextReferenceId({
        ...m,
        references: [ref({ id: "ref-2" }), ref({ id: "ref-3", file: "references/c.png" })],
      }),
    ).toBe("ref-4");
  });
  it("updates title, note, tags and links, trimming and de-duplicating", () => {
    const m = addReference(book(), { file: "references/a.pdf", title: "A", addedAt: AT }).manifest;
    const u = updateReference(m, "ref-1", {
      title: "New",
      note: "why",
      tags: [" x ", "x", "", "y"],
      chapters: ["ch-1", "ch-1", "ch-2"],
    });
    expect(u.references[0]).toMatchObject({
      title: "New",
      note: "why",
      tags: ["x", "y"],
      chapters: ["ch-1", "ch-2"],
    });
    expect(m.references[0]!.title).toBe("A");
    const partial = updateReference(u, "ref-1", { note: "" });
    expect(partial.references[0]).toMatchObject({ title: "New", tags: ["x", "y"], note: "" });
  });
  it("leaves other references alone", () => {
    let m = addReference(book(), { file: "references/a.pdf", title: "A", addedAt: AT }).manifest;
    m = addReference(m, { file: "references/b.pdf", title: "B", addedAt: AT }).manifest;
    expect(updateReference(m, "ref-2", { title: "Z" }).references[0]).toBe(m.references[0]);
  });
  it("throws for an unknown reference", () => {
    expect(() => updateReference(book(), "ref-9", {})).toThrow("no reference ref-9");
    expect(() => removeReference(book(), "ref-9")).toThrow("no reference ref-9");
  });
  it("removes a reference and returns it", () => {
    const m = addReference(book(), { file: "references/a.pdf", title: "A", addedAt: AT }).manifest;
    const r = removeReference(m, "ref-1");
    expect(r.manifest.references).toEqual([]);
    expect(r.removed).toMatchObject({ kind: "file", file: "references/a.pdf" });
  });
});

describe("links to chapters", () => {
  const linked = (): Manifest => {
    const m = book();
    const withFront = addFrontMatter(m, "dedication", "For you").manifest;
    return {
      ...withFront,
      references: [
        ref({ chapters: ["ch-1", "ch-2"] }),
        ref({ id: "ref-2", file: "references/b.png", chapters: ["ch-2", "fm-1"] }),
        ref({ id: "ref-3", file: "references/c.png" }),
      ],
    };
  };
  it("lists the references linked to a page, in list order", () => {
    expect(referencesFor(linked(), "ch-2").map((r) => r.id)).toEqual(["ref-1", "ref-2"]);
    expect(referencesFor(linked(), "ch-1").map((r) => r.id)).toEqual(["ref-1"]);
    expect(referencesFor(linked(), "ch-3")).toEqual([]);
  });
  it("removing a chapter drops its links and keeps the references", () => {
    const { manifest } = removeChapter(linked(), "ch-2");
    expect(manifest.references.map((r) => r.chapters)).toEqual([["ch-1"], ["fm-1"], []]);
    expect(danglingLinks(manifest)).toEqual([]);
    expect(manifest.references).toHaveLength(3);
  });
  it("removing a matter page drops its links", () => {
    const { manifest } = removeMatter(linked(), "fm-1");
    expect(manifest.references[1]!.chapters).toEqual(["ch-2"]);
  });
  it("unlinkEntry returns the same manifest when nothing is linked", () => {
    const m = linked();
    expect(unlinkEntry(m, "ch-3")).toBe(m);
  });
  it("linksOf and relink bring the links of a removed chapter back", () => {
    const before = linked();
    const links = linksOf(before, "ch-1");
    expect(links.length).toBeGreaterThan(0);
    const { manifest } = removeChapter(before, "ch-1");
    expect(referencesFor(manifest, "ch-1")).toEqual([]);
    const sorted = (m: Manifest) => m.references.map((r) => [r.id, [...r.chapters].sort()]);
    expect(sorted(relink(manifest, links))).toEqual(sorted(before));
    // already linked: not doubled; reference removed since: skipped; nothing to add: same objects
    expect(relink(before, links).references).toEqual(before.references);
    const first = before.references[0]!.id;
    expect(
      relink(removeReference(manifest, first).manifest, links).references.map((r) => r.id),
    ).not.toContain(first);
    expect(linksOf(before, "ch-3")).toEqual([]);
  });
  it("moveReference puts a reference at a position, clamped, and keeps the rest in order", () => {
    const m = linked();
    const ids = (x: Manifest) => x.references.map((r) => r.id);
    expect(ids(moveReference(m, "ref-1", 2))).toEqual(["ref-2", "ref-3", "ref-1"]);
    expect(ids(moveReference(m, "ref-3", 0))).toEqual(["ref-3", "ref-1", "ref-2"]);
    expect(ids(moveReference(m, "ref-1", 99))).toEqual(["ref-2", "ref-3", "ref-1"]);
    expect(ids(moveReference(m, "ref-2", -5))).toEqual(["ref-2", "ref-1", "ref-3"].slice(0, 3));
    expect(moveReference(m, "ref-2", 1)).toBe(m);
    expect(() => moveReference(m, "nope", 0)).toThrow("no reference nope");
  });
});

describe("links and text notes (formatVersion 12)", () => {
  it("accepts a link and a note beside a file and keeps their order", () => {
    const list = validateReferences([ref(), link({ id: "ref-2" }), note({ id: "ref-3" })]);
    expect(list.map((r) => r.kind)).toEqual(["file", "link", "note"]);
    expect(list[1]).toEqual(link({ id: "ref-2" }));
    expect(list[2]).toEqual(note({ id: "ref-3" }));
  });
  it("lets two links share an address and two notes share text, but not two files", () => {
    expect(validateReferences([link(), link({ id: "ref-2" })])).toHaveLength(2);
    expect(validateReferences([note(), note({ id: "ref-2" })])).toHaveLength(2);
  });
  it("adds a link and a note with fresh ids and nothing else set", () => {
    const a = addLinkReference(book(), { url: "https://example.org/a", title: "A", addedAt: AT });
    const b = addNoteReference(a.manifest, { text: "Body", title: "B", addedAt: AT });
    expect(a.reference).toEqual(link({ title: "A" }));
    expect(b.reference).toEqual(note({ id: "ref-2", title: "B", text: "Body" }));
    expect(validateManifest(b.manifest).references).toHaveLength(2);
  });
  it("refuses to add a bad address or a note over the limit", () => {
    expect(() =>
      addLinkReference(book(), { url: "ftp://a.org/", title: "A", addedAt: AT }),
    ).toThrow(FormatError);
    expect(() =>
      addNoteReference(book(), { text: "x".repeat(MAX_NOTE_CHARS + 1), title: "N", addedAt: AT }),
    ).toThrow(/at most/);
    const max = "x".repeat(MAX_NOTE_CHARS);
    expect(
      addNoteReference(book(), { text: max, title: "N", addedAt: AT }).reference,
    ).toMatchObject({
      text: max,
    });
  });
  it("edits a link's address and a note's text, and nothing on the wrong kind", () => {
    let m = addLinkReference(book(), {
      url: "https://example.org/a",
      title: "A",
      addedAt: AT,
    }).manifest;
    m = addNoteReference(m, { text: "Body", title: "B", addedAt: AT }).manifest;
    expect(
      updateReference(m, "ref-1", { url: "https://example.org/b" }).references[0],
    ).toMatchObject({
      url: "https://example.org/b",
    });
    expect(updateReference(m, "ref-2", { text: "New" }).references[1]).toMatchObject({
      text: "New",
    });
    expect(() => updateReference(m, "ref-1", { url: "javascript:alert(1)" })).toThrow(
      /cannot take/,
    );
    expect(() => updateReference(m, "ref-2", { url: "https://example.org/b" })).toThrow(
      /cannot take/,
    );
    expect(() => updateReference(m, "ref-1", { text: "x" })).toThrow(/cannot take that text/);
    expect(() => updateReference(m, "ref-2", { text: "x".repeat(MAX_NOTE_CHARS + 1) })).toThrow(
      /cannot take that text/,
    );
  });
  it("removes, moves and links them like files", () => {
    let m = addLinkReference(book(), {
      url: "https://example.org/a",
      title: "A",
      addedAt: AT,
    }).manifest;
    m = addNoteReference(m, { text: "Body", title: "B", addedAt: AT }).manifest;
    expect(moveReference(m, "ref-2", 0).references.map((r) => r.id)).toEqual(["ref-2", "ref-1"]);
    expect(referencesFor(updateReference(m, "ref-2", { chapters: ["ch-1"] }), "ch-1")).toHaveLength(
      1,
    );
    expect(removeReference(m, "ref-1").removed).toMatchObject({ kind: "link" });
  });
});

describe("normalizeWebUrl", () => {
  it.each([
    ["https://example.org", "https://example.org/"],
    ["  http://Example.org/a?b=1#c  ", "http://example.org/a?b=1#c"],
    ["HTTPS://example.org/path", "https://example.org/path"],
  ])("reads %s", (input, out) => expect(normalizeWebUrl(input)).toBe(out));
  it.each([
    "",
    "   ",
    "example.org",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "mailto:a@b.org",
    "data:text/html,x",
    "https://",
    "https://exa mple.org",
    "https://example.org/\u0007",
    "https://example.org/a\nb",
  ])("refuses %j", (input) => expect(normalizeWebUrl(input)).toBeNull());
  it("refuses an address over the limit and takes one at it", () => {
    const base = "https://example.org/";
    expect(normalizeWebUrl(base + "a".repeat(MAX_URL_CHARS - base.length + 1))).toBeNull();
    const ok = base + "a".repeat(MAX_URL_CHARS - base.length);
    expect(normalizeWebUrl(ok)).toBe(ok);
  });
});

describe("migration v11 -> v12", () => {
  it("gives every reference kind file and loses nothing", () => {
    const json = read("../../../../fixtures/contract/manifest-v11.json");
    const before = JSON.parse(json);
    const r = parseManifest(json);
    expect(r.migrated).toBe(true);
    expect(r.fromVersion).toBe(11);
    expect(r.manifest.formatVersion).toBe(12);
    expect(before.references.length).toBeGreaterThan(0);
    expect(r.manifest.references).toEqual(
      before.references.map((x: object) => ({ kind: "file", ...x })),
    );
    expect(r.manifest.chapters).toEqual(before.chapters);
    expect(r.manifest.editions).toEqual(before.editions);
    expect(parseManifest(serializeManifest(r.manifest)).migrated).toBe(false);
  });
  it("is a pure step that keeps a kind that is already there and tolerates no list", () => {
    const raw = { references: [{ id: "a", kind: "link" }, { id: "b" }] };
    expect(migrateV11ToV12(raw)).toEqual({
      references: [
        { id: "a", kind: "link" },
        { kind: "file", id: "b" },
      ],
    });
    expect(raw.references[1]).toEqual({ id: "b" });
    expect(migrateV11ToV12({ x: 1 })).toEqual({ x: 1, references: undefined });
  });
});
