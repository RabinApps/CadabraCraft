import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type Session, connect, seedBook } from "./helpers";

let s: Session;
afterEach(() => s.close());

const manifest = (): { references: Record<string, unknown>[] } =>
  JSON.parse(readFileSync(join(s.root, "book/cadabra.json"), "utf8"));
const manifestText = () => readFileSync(join(s.root, "book/cadabra.json"), "utf8");
const code = async (name: string, args: Record<string, unknown>) =>
  (await s.call(name, { path: "book", ...args })).data.error.code;

describe("link and note references", () => {
  it("adds a link with the host as its title and lists it without a file", async () => {
    s = await connect();
    await seedBook(s);
    const r = await s.ok("cadabra_reference_add", {
      path: "book",
      url: "  https://Saltmarsh.example.org/guide  ",
    });
    expect(r).toMatchObject({
      reused: false,
      reference: {
        id: "ref-1",
        type: "link",
        kind: "link",
        title: "saltmarsh.example.org",
        url: "https://saltmarsh.example.org/guide",
      },
    });
    expect(r.reference).not.toHaveProperty("file");
    expect(r.reference).not.toHaveProperty("exists");
    expect(manifest().references[0]).toMatchObject({ kind: "link", url: r.reference.url });
    const list = await s.ok("cadabra_reference_list", { path: "book" });
    expect(list.references).toHaveLength(1);
    expect((await s.call("cadabra_reference_list", { path: "book" })).texts[0]).toBe(
      "1 reference(s)",
    );
  });

  it("adds a note titled by its first line, or by the title given", async () => {
    s = await connect();
    await seedBook(s);
    const a = await s.ok("cadabra_reference_add", {
      path: "book",
      text: "The wall is older than the gate.\nSecond line.",
    });
    expect(a.reference).toMatchObject({
      type: "note",
      kind: "note",
      title: "The wall is older than the gate.",
      text: "The wall is older than the gate.\nSecond line.",
    });
    const b = await s.ok("cadabra_reference_add", { path: "book", text: "Body", title: " Mine " });
    expect(b.reference.title).toBe("Mine");
    const blank = await s.ok("cadabra_reference_add", { path: "book", text: "   " });
    expect(blank.reference.title).toBe("Note");
    expect(manifest().references.map((x) => x.id)).toEqual(["ref-1", "ref-2", "ref-3"]);
  });

  it("refuses a bad address, a long note and anything but exactly one source", async () => {
    s = await connect();
    await seedBook(s);
    const before = manifestText();
    for (const url of ["javascript:alert(1)", "file:///etc/passwd", "example.org", "mailto:a@b.c"])
      expect(await code("cadabra_reference_add", { url })).toBe("invalid_input");
    expect(await code("cadabra_reference_add", { text: "x".repeat(20_001) })).toBe("invalid_input");
    expect(await code("cadabra_reference_add", {})).toBe("invalid_input");
    expect(await code("cadabra_reference_add", { url: "https://a.org/", text: "x" })).toBe(
      "invalid_input",
    );
    expect(await code("cadabra_reference_add", { source: "a.txt", url: "https://a.org/" })).toBe(
      "invalid_input",
    );
    expect(manifestText()).toBe(before);
  });

  it("updates a link's address and a note's text, and refuses the wrong kind", async () => {
    s = await connect();
    await seedBook(s);
    await s.ok("cadabra_reference_add", { path: "book", url: "https://a.org/" });
    await s.ok("cadabra_reference_add", { path: "book", text: "one" });
    const u = await s.ok("cadabra_reference_update", {
      path: "book",
      referenceId: "ref-1",
      url: "https://b.org/x",
      tags: ["map"],
    });
    expect(u.reference).toMatchObject({ url: "https://b.org/x", tags: ["map"] });
    const t = await s.ok("cadabra_reference_update", {
      path: "book",
      referenceId: "ref-2",
      text: "two",
    });
    expect(t.reference.text).toBe("two");
    const before = manifestText();
    const bad = (args: Record<string, unknown>) => code("cadabra_reference_update", args);
    expect(await bad({ referenceId: "ref-1", url: "javascript:alert(1)" })).toBe("invalid_input");
    expect(await bad({ referenceId: "ref-1", url: "https://B.org" })).toBe("invalid_input");
    expect(await bad({ referenceId: "ref-2", url: "https://b.org/" })).toBe("invalid_input");
    expect(await bad({ referenceId: "ref-1", text: "x" })).toBe("invalid_input");
    expect(await bad({ referenceId: "ref-2", text: "x".repeat(20_001) })).toBe("invalid_input");
    expect(manifestText()).toBe(before);
  });

  it("keeps links and notes beside files and validates the book", async () => {
    s = await connect();
    await seedBook(s);
    await s.ok("cadabra_reference_add", { path: "book", url: "https://a.org/" });
    await s.ok("cadabra_reference_add", { path: "book", text: "n" });
    const v = await s.ok("cadabra_project_validate", { path: "book" });
    expect(v).toMatchObject({ valid: true, errors: 0 });
    expect(v.issues).toEqual([]);
  });
});
