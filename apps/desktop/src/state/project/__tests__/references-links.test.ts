import { beforeEach, describe, expect, it, vi } from "vitest";
import { disk, trashMethods } from "../../../test/fakeBridge";

let failWrite = false;
const trashed: string[] = [];
vi.mock("../../../lib/bridge", async () =>
  (await import("../../../test/fakeBridge")).fakeBridge({
    ...trashMethods,
    writeFile: async (_r: string, path: string, contents: string) => {
      if (failWrite) throw new Error("disk full");
      disk.set(path, contents);
      return { hash: `h${contents.length}`, conflict_copy: null };
    },
    trashReference: async (_r: string, p: string) => {
      trashed.push(p);
      return `.cadabra/trash/x-${p}`;
    },
  }),
);

import { useProject } from "../index";

const a = () => useProject.getState().actions;
const s = () => useProject.getState();
const onDisk = () => JSON.parse(disk.get("cadabra.json")!);

beforeEach(async () => {
  disk.clear();
  trashed.length = 0;
  failWrite = false;
  useProject.setState({ root: null, manifest: null, referenceNotices: [], notice: "" });
  await a().createProject("/p", "Book", "Me");
});

describe("link references", () => {
  it("adds a link titled by its host, normalizing the address, and saves", async () => {
    expect(await a().addLink("  https://www.Example.org/a?b=1  ")).toBeNull();
    expect(onDisk().references).toEqual([
      expect.objectContaining({
        id: "ref-1",
        kind: "link",
        url: "https://www.example.org/a?b=1",
        title: "example.org",
      }),
    ]);
    expect(await a().addLink("https://b.example.org/", "  My title ")).toBeNull();
    expect(s().manifest!.references[1]).toMatchObject({ title: "My title" });
  });

  it("refuses an address that is not http or https, and one that is already there", async () => {
    for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "example.org", ""])
      expect(await a().addLink(bad)).toMatch(/http:\/\/ or https:\/\//);
    expect(await a().addLink("https://a.org/")).toBeNull();
    expect(await a().addLink("https://a.org")).toBe("This address is already in this book.");
    expect(s().manifest!.references).toHaveLength(1);
  });

  it("says so when the list cannot be saved", async () => {
    failWrite = true;
    expect(await a().addLink("https://a.org/")).toMatch(/^Could not add the link: disk full/);
    expect(s().manifest!.references).toEqual([]);
  });

  it("changes a link's address and refuses a bad one", async () => {
    await a().addLink("https://a.org/");
    expect(await a().updateLink("ref-1", "https://b.org/x")).toBeNull();
    expect(onDisk().references[0].url).toBe("https://b.org/x");
    expect(await a().updateLink("ref-1", "ftp://b.org/")).toMatch(/http:\/\/ or https:\/\//);
    expect(onDisk().references[0].url).toBe("https://b.org/x");
    failWrite = true;
    expect(await a().updateLink("ref-1", "https://c.org/")).toMatch(/^Could not save the address/);
    failWrite = false;
    expect(await a().updateLink("ref-9", "https://c.org/")).toMatch(/no reference ref-9/);
  });
});

describe("note references", () => {
  it("adds a note titled by its first line, or by the title given", async () => {
    expect(await a().addNote("The wall is older than the gate.\nMore.")).toBeNull();
    expect(await a().addNote("Body", " Mine ")).toBeNull();
    expect(onDisk().references).toEqual([
      expect.objectContaining({
        kind: "note",
        title: "The wall is older than the gate.",
        text: "The wall is older than the gate.\nMore.",
      }),
      expect.objectContaining({ kind: "note", title: "Mine", text: "Body" }),
    ]);
  });

  it("refuses an empty note and one over the limit, and reports a failed save", async () => {
    expect(await a().addNote("  \n ")).toBe("Write something in the note first.");
    expect(await a().addNote("x".repeat(20_001))).toMatch(
      /^Could not add the note: .*at most 20000/,
    );
    failWrite = true;
    expect(await a().addNote("ok")).toMatch(/^Could not add the note: disk full/);
    expect(s().manifest!.references).toEqual([]);
  });

  it("edits the text of a note", async () => {
    await a().addNote("one");
    await a().updateReference("ref-1", { text: "two" });
    expect(onDisk().references[0]).toMatchObject({ kind: "note", text: "two" });
  });
});

describe("dropped links and text", () => {
  it("adds a mix of links and a note and reports each problem as a notice", async () => {
    await a().addLink("https://a.org/");
    await a().addDropped([
      { type: "link", url: "https://a.org/" },
      { type: "link", url: "https://b.org/" },
      { type: "note", text: "A thought" },
    ]);
    expect(s().manifest!.references.map((r) => r.kind)).toEqual(["link", "link", "note"]);
    expect(s().referenceNotices).toEqual([
      { tone: "warn", text: "This address is already in this book." },
    ]);
  });

  it("says so when the dropped text was too long, and clears old notices", async () => {
    useProject.setState({ referenceNotices: [{ tone: "warn", text: "old" }] });
    await a().addDropped([], true);
    expect(s().manifest!.references).toEqual([]);
    expect(s().referenceNotices).toEqual([
      { tone: "danger", text: "That text is too long for a note, so it was not added." },
    ]);
    await a().addDropped([{ type: "note", text: "ok" }]);
    expect(s().referenceNotices).toEqual([]);
  });
});

describe("removing a link or a note", () => {
  it("takes only the list entry, never touches the trash, and Undo and Redo bring it back and away", async () => {
    await a().addLink("https://a.org/");
    await a().addNote("Body");
    await a().removeReference("ref-1");
    expect(s().manifest!.references.map((r) => r.id)).toEqual(["ref-2"]);
    expect(trashed).toEqual([]);
    await a().undo();
    expect(s().manifest!.references.map((r) => [r.id, r.kind])).toEqual([
      ["ref-1", "link"],
      ["ref-2", "note"],
    ]);
    expect(trashed).toEqual([]);
    await a().redo();
    expect(s().manifest!.references.map((r) => r.id)).toEqual(["ref-2"]);
    expect(trashed).toEqual([]);
    await a().undo();
    expect(onDisk().references[0]).toMatchObject({ id: "ref-1", url: "https://a.org/" });
  });
});
