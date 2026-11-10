import { sourceFile } from "@cadabracraft/format";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { disk, readFile, writeFileWithConflictCopy } from "../../../test/fakeBridge";

/** Fails chapter writes from the Nth (1-based) on when `failFrom` is set, and reads of `failRead` always. */
let writes = 0;
let failFrom: number | null = null;
let failManifest = false;
let failRead: string | null = null;
/** Runs once at the next page read (typing that arrives while the book is being read). */
let onRead: (() => void) | null = null;
vi.mock("../../../lib/bridge", async () =>
  (await import("../../../test/fakeBridge")).fakeBridge({
    readFile: async (r: string, p: string) => {
      if (failRead === p) throw new Error("disk read error");
      if (onRead && p.startsWith("manuscript/")) {
        const run = onRead;
        onRead = null;
        run();
      }
      return readFile(r, p);
    },
    writeFile: async (r: string, p: string, c: string, base: string | null) => {
      if (p === "cadabra.json" && failManifest) throw new Error("manifest locked");
      if (p !== "cadabra.json") {
        writes++;
        if (failFrom !== null && writes >= failFrom) throw new Error("No space left on device");
      }
      return writeFileWithConflictCopy(r, p, c, base);
    },
  }),
);

import { useProject } from "../index";

const a = () => useProject.getState().actions;
const s = () => useProject.getState();
const text = (t: string) => ({
  type: "doc" as const,
  content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: t }] }],
});
const file = (i: number) => sourceFile(s().manifest!.chapters[i]!, s().manifest!.editions);
const onDisk = (i: number): string => disk.get(file(i))!;
const marksOf = (i: number, type: string) =>
  [...onDisk(i).matchAll(new RegExp(`"type": "${type}"`, "g"))].length;

/** Two chapters: "magic and Magic" and "no spells but magic". */
async function twoChapters() {
  a().setDraft(text("magic and Magic"));
  await a().add("Two");
  a().setDraft(text("no spells but magic"));
  await a().selectChapter("ch-1");
}

beforeEach(async () => {
  disk.clear();
  writes = 0;
  failFrom = null;
  failManifest = false;
  failRead = null;
  onRead = null;
  useProject.setState({
    root: null,
    manifest: null,
    currentId: null,
    currentDoc: null,
    draft: null,
    hashes: {},
    notice: "",
    alertNotice: "",
    reloadCount: 0,
  });
  await a().createProject("/p", "Book", "Me");
});

describe("index and glossary settings", () => {
  it("saves the index settings into the manifest and keeps what was not changed", async () => {
    await a().setIndexSettings({ enabled: true, columns: 1 });
    expect(s().manifest!.index).toMatchObject({
      enabled: true,
      columns: 1,
      heading: "Index",
      ranges: true,
    });
    expect(JSON.parse(disk.get("cadabra.json")!).index.columns).toBe(1);
    await a().setIndexSettings({ heading: "Names" });
    expect(s().manifest!.index).toMatchObject({ enabled: true, columns: 1, heading: "Names" });
  });

  it("hides a term and lists it again, whatever its case", async () => {
    await a().setIndexTermHidden("Magic", true);
    expect(s().manifest!.index!.hidden).toEqual(["Magic"]);
    await a().setIndexTermHidden("magic", false);
    expect(s().manifest!.index!.hidden).toEqual([]);
  });

  it("refuses settings that cannot be saved and says so", async () => {
    await a().setIndexSettings({ heading: " " });
    expect(s().alertNotice).toMatch(/Could not save the index settings/);
    useProject.setState({ notice: "", alertNotice: "" });
    failManifest = true;
    await a().setGlossarySettings({ enabled: true });
    expect(s().alertNotice).toMatch(/manifest locked/);
  });

  it("saves the glossary settings without touching the entries", async () => {
    const id = await a().addGlossaryEntry({ term: "Orb", definition: "A sphere." });
    await a().setGlossarySettings({ enabled: true, order: "added", inIndex: true });
    expect(s().manifest!.glossary).toMatchObject({ enabled: true, order: "added", inIndex: true });
    expect(s().manifest!.glossary!.entries.map((e) => e.id)).toEqual([id]);
  });
});

describe("glossary entries", () => {
  it("adds, changes and refuses entries", async () => {
    const id = await a().addGlossaryEntry({
      term: " Orb ",
      aliases: ["orbs"],
      definition: "A sphere.",
    });
    expect(id).toMatch(/^gl-/);
    expect(s().manifest!.glossary!.entries[0]).toEqual({
      id,
      term: "Orb",
      aliases: ["orbs"],
      definition: "A sphere.",
    });
    expect(await a().addGlossaryEntry({ term: "orb", definition: "" })).toBeNull();
    expect(s().alertNotice).toMatch(/already has this term/);
    expect(await a().updateGlossaryEntry(id!, { definition: "A round thing." })).toBe(true);
    expect(s().manifest!.glossary!.entries[0]!.definition).toBe("A round thing.");
    expect(await a().updateGlossaryEntry(id!, { term: "" })).toBe(false);
    expect(await a().updateGlossaryEntry("nope", { term: "X" })).toBe(false);
    failManifest = true;
    expect(await a().addGlossaryEntry({ term: "Other", definition: "" })).toBeNull();
  });

  it("refuses an entry when the glossary is full", async () => {
    const entries = Array.from({ length: 2000 }, (_, i) => ({
      id: `e${i}`,
      term: `T${i}`,
      definition: "",
    }));
    useProject.setState({
      manifest: {
        ...s().manifest!,
        glossary: {
          enabled: false,
          heading: "Glossary",
          order: "alpha",
          inIndex: false,
          markFirstUse: true,
          showUndefined: false,
          entries,
        },
      },
    });
    expect(await a().addGlossaryEntry({ term: "One more", definition: "" })).toBeNull();
    expect(s().alertNotice).toMatch(/full/);
  });

  it("marks the first use of a term in each chapter once, and removes an entry with its uses", async () => {
    await twoChapters();
    const id = (await a().addGlossaryEntry({ term: "magic", definition: "Power." }))!;
    expect(await a().markGlossaryOccurrences(id, true)).toBe(2);
    expect(marksOf(0, "glossaryTerm")).toBe(1);
    expect(marksOf(1, "glossaryTerm")).toBe(1);
    // A chapter that already has a use keeps just that one.
    expect(await a().markGlossaryOccurrences(id, true)).toBe(0);
    expect(await a().markGlossaryOccurrences(id, false)).toBe(1);
    expect(marksOf(0, "glossaryTerm")).toBe(2);
    expect(await a().markGlossaryOccurrences("nope", false)).toBe(0);
    await a().removeGlossaryEntry(id);
    expect(s().manifest!.glossary!.entries).toEqual([]);
    expect(marksOf(0, "glossaryTerm") + marksOf(1, "glossaryTerm")).toBe(0);
    expect(onDisk(0)).toContain("magic and ");
  });

  it("keeps the entry when its uses could not be removed", async () => {
    await twoChapters();
    const id = (await a().addGlossaryEntry({ term: "magic", definition: "Power." }))!;
    await a().markGlossaryOccurrences(id, false);
    failFrom = writes + 1;
    await a().removeGlossaryEntry(id);
    expect(s().alertNotice).toMatch(/stopped|space/i);
    expect(s().manifest!.glossary!.entries).toHaveLength(1);
  });

  it("reports a failure to save the manifest after the uses are gone", async () => {
    const id = (await a().addGlossaryEntry({ term: "magic", definition: "x" }))!;
    failManifest = true;
    await a().removeGlossaryEntry(id);
    expect(s().alertNotice).toMatch(/Could not remove the glossary term/);
    useProject.setState({ manifest: { ...s().manifest!, glossary: undefined } });
    failManifest = false;
    await a().removeGlossaryEntry(id);
  });
});

describe("index marks across the book", () => {
  it("marks every occurrence once, as one undo step, and the open page shows it", async () => {
    await twoChapters();
    const before = s().history.undo.length;
    expect(await a().markIndexOccurrences({ term: "Magic" }, "magic")).toBe(3);
    expect(marksOf(0, "indexEntry")).toBe(2);
    expect(marksOf(1, "indexEntry")).toBe(1);
    expect(s().history.undo.length).toBe(before + 1);
    expect(s().notice).toMatch(/more places marked/);
    expect(await a().markIndexOccurrences({ term: "Magic" }, "magic")).toBe(0);
    await a().undo();
    expect(marksOf(0, "indexEntry") + marksOf(1, "indexEntry")).toBe(0);
  });

  it("renames, merges, moves, and deletes terms, and takes single places out", async () => {
    await twoChapters();
    await a().markIndexOccurrences({ term: "Magic" }, "magic");
    expect(await a().renameIndexTerm("Magic", " Sorcery ")).toBe(3);
    expect(onDisk(0)).toContain('"term": "Sorcery"');
    expect(await a().moveIndexTerm("Sorcery", "Craft")).toBe(3);
    expect(onDisk(0)).toContain('"sub": "Sorcery"');
    const id = /"id": "(ix-[^"]+)"/.exec(onDisk(1))![1]!;
    expect(await a().removeIndexPlace(id)).toBe(1);
    expect(marksOf(1, "indexEntry")).toBe(0);
    expect(await a().deleteIndexTerm("craft")).toBe(2);
    expect(marksOf(0, "indexEntry")).toBe(0);
    expect(await a().deleteIndexTerm("craft")).toBe(0);
  });

  it("shows why an edit stopped, and puts back what it had written", async () => {
    await twoChapters();
    failFrom = 2;
    expect(await a().markIndexOccurrences({ term: "Magic" }, "magic")).toBe(0);
    expect(s().alertNotice).toMatch(/Nothing was changed/);
    expect(marksOf(0, "indexEntry") + marksOf(1, "indexEntry")).toBe(0);
  });

  it("says so when pages kept the change because they could not be put back", async () => {
    await twoChapters();
    failFrom = 2; // the second write fails and so does the write that puts the first back
    useProject.setState({ notice: "", alertNotice: "" });
    await a().markIndexOccurrences({ term: "Magic" }, "magic");
    expect(s().alertNotice).toMatch(/Nothing was changed|Undo restores/);
  });

  it("keeps one undo step for the pages that could not be put back", async () => {
    await twoChapters();
    const before = s().history.undo.length;
    // The second page fails to write, and so does putting the first back.
    failFrom = writes + 2;
    expect(await a().markIndexOccurrences({ term: "Magic" }, "magic")).toBe(0);
    expect(s().alertNotice).toMatch(/Undo restores them/);
    expect(s().history.undo.length).toBe(before + 1);
    expect(marksOf(0, "indexEntry")).toBeGreaterThan(0);
    failFrom = null;
    await a().undo();
    expect(marksOf(0, "indexEntry")).toBe(0);
  });

  it("runs edits one after another, even when the first one stops", async () => {
    await twoChapters();
    failRead = file(1);
    const first = a().deleteIndexTerm("x");
    failRead = null;
    const second = a().markIndexOccurrences({ term: "Magic" }, "magic");
    expect(await first).toBe(0);
    expect(await second).toBe(3);
  });

  it("changes nothing when typing arrives while the book is being read", async () => {
    await twoChapters();
    onRead = () => a().setDraft(text("typed meanwhile"));
    expect(await a().markIndexOccurrences({ term: "Magic" }, "magic")).toBe(0);
    expect(s().alertNotice).toMatch(/changed while the book was being read/);
  });

  it("stops when typing arrives while the book is read, and when a page cannot be read", async () => {
    await twoChapters();
    failRead = file(1);
    expect(await a().deleteIndexTerm("x")).toBe(0);
    expect(s().alertNotice).toBeTruthy();
    failRead = null;
    useProject.setState({ alertNotice: "", notice: "" });
    a().setDraft(text("magic typed"));
    // flush saves the draft first, so the edit goes through with the typed words.
    expect(await a().markIndexOccurrences({ term: "Magic" }, "magic")).toBe(2);
  });
});

describe("indexSources", () => {
  it("reads the pages of the shown edition with the open page as it is on screen", async () => {
    await twoChapters();
    a().setDraft(text("unsaved words"));
    const pages = await a().indexSources();
    expect(pages.map((p) => p.id)).toEqual(["ch-1", "ch-2"]);
    expect(JSON.stringify(pages[0]!.doc)).toContain("unsaved words");
    expect(JSON.stringify(pages[1]!.doc)).toContain("no spells");
  });

  it("answers no pages and shows why when the book cannot be read", async () => {
    await twoChapters();
    failRead = file(1);
    expect(await a().indexSources()).toEqual([]);
    expect(s().alertNotice).toMatch(/could not read the book/);
  });
});
