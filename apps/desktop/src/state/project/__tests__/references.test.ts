import { beforeEach, describe, expect, it, vi } from "vitest";
import { disk, trashMethods } from "../../../test/fakeBridge";

const files = new Map<string, number>();
const trashed: string[] = [];
let pickResult: string[] = [];
let trashError: unknown = null;
let failWrite = false;
let trashList: null | { path: string; original: string; trashed_at: string }[] = [];
vi.mock("../../../lib/bridge", async () =>
  (await import("../../../test/fakeBridge")).fakeBridge({
    ...trashMethods,
    listTrash: async () => {
      if (!trashList) throw new Error("no trash");
      return trashList;
    },
    restoreTrash: async (r: string, p: string) =>
      p.includes("gone")
        ? Promise.reject({ kind: "not_found", path: p })
        : p.startsWith(".cadabra/trash/x-")
          ? p.slice(".cadabra/trash/x-".length)
          : trashMethods.restoreTrash(r, p),
    writeFile: async (_r: string, path: string, contents: string) => {
      if (failWrite) throw new Error("disk full");
      disk.set(path, contents);
      return { hash: `h${contents.length}`, conflict_copy: null };
    },
    pickReferenceFiles: async () => pickResult,
    importReference: async (_r: string, src: string) => {
      const name = src.split("/").pop()!;
      if (name.startsWith("bad")) throw { kind: "unsupported_reference", name };
      const file = `references/${name}`;
      const reused = files.has(file);
      files.set(file, 10);
      return { file, title: name.replace(/\.[^.]*$/, ""), size: 10, kind: "other", reused };
    },
    trashReference: async (_r: string, p: string) => {
      if (trashError) throw trashError;
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
  files.clear();
  trashed.length = 0;
  pickResult = [];
  trashError = null;
  failWrite = false;
  trashList = [];
  useProject.setState({
    root: null,
    manifest: null,
    referenceNotices: [],
    referenceImport: null,
    notice: "",
  });
  await a().createProject("/p", "Book", "Me");
});

describe("reference actions", () => {
  it("imports picked files, lists them in the manifest and saves", async () => {
    pickResult = ["/x/Map.png", "/x/notes.md"];
    await a().addReferences();
    expect(s().manifest!.references.map((r) => [r.id, r.file, r.title])).toEqual([
      ["ref-1", "references/Map.png", "Map"],
      ["ref-2", "references/notes.md", "notes"],
    ]);
    expect(onDisk().references).toHaveLength(2);
    expect(onDisk().references[0].addedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(s().referenceImport).toBeNull();
    expect(s().referenceNotices).toEqual([]);
  });

  it("does nothing when the picker is cancelled", async () => {
    await a().addReferences();
    expect(s().manifest!.references).toEqual([]);
    expect(s().referenceNotices).toEqual([]);
  });

  it("takes paths from a drop without asking", async () => {
    await a().addReferences(["/dropped/a.pdf"]);
    expect(s().manifest!.references.map((r) => r.file)).toEqual(["references/a.pdf"]);
  });

  it("warns about a file that is already listed and keeps one entry", async () => {
    await a().addReferences(["/x/a.pdf"]);
    await a().addReferences(["/y/a.pdf"]);
    expect(s().manifest!.references).toHaveLength(1);
    expect(s().referenceNotices).toEqual([
      { tone: "warn", text: "a.pdf is already in this book. Using the existing file." },
    ]);
  });

  it("reports a refused file and still adds the others", async () => {
    await a().addReferences(["/x/bad.exe", "/x/ok.pdf"]);
    expect(s().manifest!.references.map((r) => r.file)).toEqual(["references/ok.pdf"]);
    expect(s().referenceNotices).toHaveLength(1);
    expect(s().referenceNotices[0]).toMatchObject({ tone: "danger" });
    expect(s().referenceNotices[0]!.text).toMatch(/Could not add bad\.exe: .*cannot be added/);
    a().dismissReferenceNotices();
    expect(s().referenceNotices).toEqual([]);
    a().dismissReferenceNotices();
  });

  it("updates title, note, tags and links", async () => {
    await a().addReferences(["/x/a.pdf"]);
    await a().updateReference("ref-1", {
      title: "Lighthouse",
      note: "why",
      tags: ["a", " a ", "b"],
      chapters: ["ch-1"],
    });
    expect(onDisk().references[0]).toMatchObject({
      title: "Lighthouse",
      note: "why",
      tags: ["a", "b"],
      chapters: ["ch-1"],
    });
  });

  it("says so when an update cannot be saved", async () => {
    await a().updateReference("ref-9", { title: "x" });
    expect(s().notice).toMatch(/Could not save the reference: no reference ref-9/);
  });

  it("removes a reference from the list and moves its file to the trash", async () => {
    await a().addReferences(["/x/a.pdf", "/x/b.pdf"]);
    await a().removeReference("ref-1");
    expect(s().manifest!.references.map((r) => r.id)).toEqual(["ref-2"]);
    expect(onDisk().references).toHaveLength(1);
    expect(trashed).toEqual(["references/a.pdf"]);
    await a().removeReference("ref-1"); // already gone: nothing happens
    expect(trashed).toEqual(["references/a.pdf"]);
  });

  it("a file that is already gone is fine; another trash failure is reported", async () => {
    await a().addReferences(["/x/a.pdf", "/x/b.pdf"]);
    trashError = { kind: "not_found", path: "references/a.pdf" };
    await a().removeReference("ref-1");
    expect(s().notice).toBe("");
    trashError = { kind: "permission_denied", path: "references/b.pdf" };
    await a().removeReference("ref-2");
    expect(s().manifest!.references).toEqual([]);
    expect(s().notice).toMatch(/b was removed, but its file could not be moved to the trash/);
  });

  it("keeps the reference listed and says so when the manifest cannot be saved", async () => {
    await a().addReferences(["/x/a.pdf"]);
    failWrite = true;
    await a().removeReference("ref-1");
    expect(s().manifest!.references).toHaveLength(1);
    expect(s().notice).toMatch(/Could not remove a: disk full/);
    expect(trashed).toEqual([]);
    await a().addReferences(["/x/b.pdf"]);
    expect(s().referenceNotices[0]!.text).toMatch(/Could not add b.pdf: disk full/);
  });

  it("removing a chapter also drops its reference links", async () => {
    await a().addReferences(["/x/a.pdf"]);
    const ch = s().manifest!.chapters[0]!.id;
    await a().updateReference("ref-1", { chapters: [ch] });
    expect(s().manifest!.references[0]!.chapters).toEqual([ch]);
  });

  it("removing a chapter drops its links, undo puts them back and redo drops them again", async () => {
    await a().addReferences(["/x/a.pdf", "/x/b.pdf"]);
    await a().add("Two");
    const ch = s().manifest!.chapters[1]!.id;
    await a().updateReference("ref-1", { chapters: [ch] });
    await a().remove(ch);
    expect(s().manifest!.references[0]!.chapters).toEqual([]);
    await a().removeReference("ref-2"); // removed after the chapter: the first undo brings it back, the second the chapter and its link
    await a().undo(); // the reference first, then the chapter
    await a().undo();
    expect(s().manifest!.chapters.map((c) => c.id)).toContain(ch);
    expect(s().manifest!.references.map((r) => r.chapters)).toEqual([[ch], []]);
    await a().redo(); // the chapter again, without its link
    expect(s().manifest!.references[0]!.chapters).toEqual([]);
  });

  it("Book Undo puts a removed reference back at its place and redo removes it again", async () => {
    await a().addReferences(["/x/a.pdf", "/x/b.pdf", "/x/c.pdf"]);
    await a().updateReference("ref-2", { note: "keep" });
    await a().removeReference("ref-2");
    expect(s().manifest!.references.map((r) => r.id)).toEqual(["ref-1", "ref-3"]);
    await a().undo();
    expect(s().manifest!.references.map((r) => [r.id, r.note])).toEqual([
      ["ref-1", ""],
      ["ref-2", "keep"],
      ["ref-3", ""],
    ]);
    expect(s().notice).toMatch(/Undid: Remove b/);
    await a().redo();
    expect(s().manifest!.references.map((r) => r.id)).toEqual(["ref-1", "ref-3"]);
    expect(s().notice).toMatch(/Redid: Remove b/);
    await a().undo();
    expect(s().manifest!.references).toHaveLength(3);
  });

  it("an undone removal takes a fresh id when its id was reused meanwhile", async () => {
    await a().addReferences(["/x/a.pdf"]);
    await a().removeReference("ref-1");
    await a().addReferences(["/x/b.pdf"]); // takes ref-1 again
    await a().undo();
    expect(s().manifest!.references.map((r) => r.id)).toEqual(["ref-2", "ref-1"]);
  });

  it("lists removed reference files and restores one as a new reference", async () => {
    trashList = [
      {
        path: ".cadabra/trash/20261001-0900-manuscript__001.json",
        original: "manuscript/001.json",
        trashed_at: "20261001-0900",
      },
      {
        path: ".cadabra/trash/x-references/old-map.png",
        original: "references/old-map.png",
        trashed_at: "20261002-0900",
      },
      {
        path: ".cadabra/trash/x-references/gone.pdf",
        original: "references/gone.pdf",
        trashed_at: "20261003-0900",
      },
    ];
    await a().refreshRemovedReferences();
    expect(s().removedReferences.map((r) => r.original)).toEqual([
      "references/gone.pdf",
      "references/old-map.png",
    ]);
    expect(await a().restoreReference(".cadabra/trash/x-references/old-map.png")).toBeNull();
    expect(s().manifest!.references.map((r) => [r.file, r.title])).toEqual([
      ["references/old-map.png", "old-map"],
    ]);
    expect(s().removedReferences.map((r) => r.original)).toEqual(["references/gone.pdf"]);
    const text = await a().restoreReference(".cadabra/trash/x-references/gone.pdf");
    expect(text).toMatch(/^Could not restore gone: /);
    expect(s().removedReferences).toHaveLength(1);
    expect(s().manifest!.references).toHaveLength(1);
  });

  it("keeps the list when the trash cannot be read", async () => {
    useProject.setState({
      removedReferences: [{ path: "p", original: "references/a.pdf", stamp: "20261001-0900" }],
    });
    trashList = null;
    await a().refreshRemovedReferences();
    expect(s().removedReferences).toHaveLength(1);
  });
});
