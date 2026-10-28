import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type Session, connect, gradientPng, seedBook } from "./helpers";

let s: Session;
afterEach(() => s.close());

const put = (name: string, bytes: Uint8Array | string): string => {
  mkdirSync(join(s.root, "inbox"), { recursive: true });
  writeFileSync(join(s.root, "inbox", name), bytes);
  return `inbox/${name}`;
};
const manifest = (): { references: { id: string; file: string }[] } =>
  JSON.parse(readFileSync(join(s.root, "book/cadabra.json"), "utf8"));
const refs = () => readdirSync(join(s.root, "book/references")).sort();

describe("reference tools", () => {
  it("lists nothing in a new book", async () => {
    s = await connect();
    await seedBook(s);
    const r = await s.ok("cadabra_reference_list", { path: "book" });
    expect(r.references).toEqual([]);
    const text = (await s.call("cadabra_reference_list", { path: "book" })).texts[0];
    expect(text).toBe("0 reference(s)");
  });

  it("adds a file, copies it into references/ and lists it", async () => {
    s = await connect();
    await seedBook(s);
    const source = put("Lighthouse Plans.png", gradientPng());
    const added = await s.ok("cadabra_reference_add", { path: "book", source });
    expect(added).toMatchObject({
      reused: false,
      size: gradientPng().length,
      reference: {
        id: "ref-1",
        title: "Lighthouse Plans",
        file: "references/Lighthouse-Plans.png",
        kind: "image",
        note: "",
        tags: [],
        chapters: [],
        exists: true,
      },
    });
    expect(Date.parse(added.reference.addedAt)).not.toBeNaN();
    expect(refs()).toEqual(["Lighthouse-Plans.png"]);
    expect(readFileSync(join(s.root, "book/references/Lighthouse-Plans.png"))).toEqual(
      gradientPng(),
    );
    expect(readFileSync(join(s.root, source))).toEqual(gradientPng()); // the source is untouched
    expect(JSON.stringify(manifest())).not.toContain(s.root);
    const list = await s.ok("cadabra_reference_list", { path: "book" });
    expect(list.references).toHaveLength(1);
    expect(list.references[0].id).toBe("ref-1");
  });

  it("takes a title, and an absolute path inside the workspace", async () => {
    s = await connect();
    await seedBook(s);
    put("notes.md", "# Notes\n");
    const r = await s.ok("cadabra_reference_add", {
      path: "book",
      source: join(s.root, "inbox/notes.md"),
      title: "  Research notes ",
    });
    expect(r.reference).toMatchObject({
      title: "Research notes",
      kind: "text",
      file: "references/notes.md",
    });
  });

  it("returns the existing entry for identical content and suffixes different content", async () => {
    s = await connect();
    await seedBook(s);
    const a = await s.ok("cadabra_reference_add", { path: "book", source: put("a.txt", "one") });
    const again = await s.ok("cadabra_reference_add", {
      path: "book",
      source: put("a.txt", "one"),
    });
    expect(again.reused).toBe(true);
    expect(again.reference.id).toBe(a.reference.id);
    expect(manifest().references).toHaveLength(1);
    const renamed = await s.ok("cadabra_reference_add", {
      path: "book",
      source: put("a.txt", "one"),
      title: "Better title",
    });
    expect(renamed.reference).toMatchObject({ id: a.reference.id, title: "Better title" });
    expect(manifest().references).toHaveLength(1);
    const other = await s.ok("cadabra_reference_add", {
      path: "book",
      source: put("a.txt", "two"),
    });
    expect(other).toMatchObject({
      reused: false,
      fileReused: false,
      reference: { id: "ref-2", file: "references/a-2.txt" },
    });
    expect(refs()).toEqual(["a-2.txt", "a.txt"]);
  });

  it("lists an unlisted file that is already in references/ instead of copying it again", async () => {
    s = await connect();
    await seedBook(s);
    writeFileSync(join(s.root, "book/references/a.txt"), "one");
    const r = await s.ok("cadabra_reference_add", { path: "book", source: put("a.txt", "one") });
    expect(r).toMatchObject({
      reused: false,
      fileReused: true,
      reference: { file: "references/a.txt" },
    });
    expect(refs()).toEqual(["a.txt"]);
  });

  it("refuses blocked, mismatching and oversized files with stable codes and writes nothing", async () => {
    s = await connect();
    await seedBook(s);
    const code = async (source: string) =>
      (await s.call("cadabra_reference_add", { path: "book", source })).data.error.code;
    expect(await code(put("run.sh", "echo hi"))).toBe("unsupported_reference");
    expect(await code(put("page.html", "<p>"))).toBe("unsupported_reference");
    expect(await code(put("fake.png", "text"))).toBe("invalid_reference");
    expect(await code(put("fake.pdf", "text"))).toBe("invalid_reference");
    const big = join(s.root, "inbox/big.txt");
    writeFileSync(big, Buffer.alloc(5 * 1024 * 1024 + 1, 97));
    expect(await code("inbox/big.txt")).toBe("too_large");
    expect(await code("inbox/missing.png")).toBe("not_found");
    expect(await code("inbox")).toBe("not_a_file");
    expect(await code("../outside.png")).toBe("path_escape");
    expect(readdirSync(join(s.root, "book/references"))).toEqual([]);
    expect(manifest().references).toEqual([]);
  });

  it("refuses a folder that is not a project", async () => {
    s = await connect();
    const r = await s.call("cadabra_reference_add", { path: "nope", source: put("a.txt", "x") });
    expect(r.data.error.code).toBe("not_a_project");
  });

  it("updates title, note, tags and chapter links, and reports linked chapter titles", async () => {
    s = await connect();
    const { ids } = await seedBook(s);
    await s.ok("cadabra_reference_add", { path: "book", source: put("a.txt", "one") });
    const r = await s.ok("cadabra_reference_update", {
      path: "book",
      referenceId: "ref-1",
      title: "Sea charts",
      note: "check tides",
      tags: [" sea ", "sea", "", "maps"],
      chapters: [ids[0], ids[0], ids[1]],
    });
    expect(r.reference).toMatchObject({
      title: "Sea charts",
      note: "check tides",
      tags: ["sea", "maps"],
    });
    expect(r.reference.chapters.map((c: { id: string }) => c.id)).toEqual([ids[0], ids[1]]);
    expect(r.reference.chapters.every((c: { title: unknown }) => typeof c.title === "string")).toBe(
      true,
    );
    // Only the given fields change.
    const only = await s.ok("cadabra_reference_update", {
      path: "book",
      referenceId: "ref-1",
      note: "",
    });
    expect(only.reference).toMatchObject({ title: "Sea charts", note: "", tags: ["sea", "maps"] });
    expect(only.reference.chapters).toHaveLength(2);
    const cleared = await s.ok("cadabra_reference_update", {
      path: "book",
      referenceId: "ref-1",
      tags: [],
      chapters: [],
    });
    expect(cleared.reference).toMatchObject({ tags: [], chapters: [] });
    const info = await s.ok("cadabra_project_validate", { path: "book" });
    expect(info.valid).toBe(true);
  });

  it("refuses an unknown reference or chapter and an empty title", async () => {
    s = await connect();
    await seedBook(s);
    await s.ok("cadabra_reference_add", { path: "book", source: put("a.txt", "one") });
    const before = readFileSync(join(s.root, "book/cadabra.json"), "utf8");
    const err = async (args: Record<string, unknown>) =>
      (await s.call("cadabra_reference_update", { path: "book", ...args })).data.error.code;
    expect(await err({ referenceId: "ref-9", note: "x" })).toBe("reference_not_found");
    expect(await err({ referenceId: "ref-1", chapters: ["nope"] })).toBe("chapter_not_found");
    expect(
      (
        await s.call("cadabra_reference_update", {
          path: "book",
          referenceId: "ref-1",
          title: "  ",
        })
      ).isError,
    ).toBe(true);
    expect(readFileSync(join(s.root, "book/cadabra.json"), "utf8")).toBe(before);
  });

  it("flags a missing file and a link to a page the book no longer has", async () => {
    s = await connect();
    const { ids } = await seedBook(s);
    await s.ok("cadabra_reference_add", { path: "book", source: put("a.txt", "one") });
    await s.ok("cadabra_reference_update", {
      path: "book",
      referenceId: "ref-1",
      chapters: [ids[0]],
    });
    rmSync(join(s.root, "book/references/a.txt"));
    const m = JSON.parse(readFileSync(join(s.root, "book/cadabra.json"), "utf8"));
    m.references[0].chapters.push("ghost");
    m.references.push({ ...m.references[0], id: "ref-5", file: "references/noext", chapters: [] });
    writeFileSync(join(s.root, "book/cadabra.json"), JSON.stringify(m));
    const r = await s.call("cadabra_reference_list", { path: "book" });
    expect(r.texts[0]).toBe("2 reference(s), 2 with a missing file");
    expect(r.data.references[0]).toMatchObject({ exists: false, kind: "text" });
    expect(r.data.references[0].chapters[1]).toEqual({ id: "ghost", title: null });
    expect(r.data.references[1]).toMatchObject({ kind: "other", exists: false });
  });

  it("serialises parallel adds so no entry is lost", async () => {
    s = await connect();
    await seedBook(s);
    await Promise.all(
      ["a", "b", "c"].map((n) =>
        s.ok("cadabra_reference_add", { path: "book", source: put(`${n}.txt`, n) }),
      ),
    );
    expect(
      manifest()
        .references.map((r) => r.id)
        .sort(),
    ).toEqual(["ref-1", "ref-2", "ref-3"]);
  });
});
