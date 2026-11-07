import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BookSnapshotEntry } from "../../../../lib/bridge";
import { compareWithCurrent, parseDoc, readCurrentParagraphs } from "../chapterCompare";
import { loadBookCompare } from "../compareBookPage";

const doc = (...paragraphs: string[]) =>
  JSON.stringify({
    type: "doc",
    content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
  });

const files = new Map<string, string>();
const snapshotPages = new Map<string, string>();
let readError: unknown = null;
vi.mock("../../../../lib/bridge", () => ({
  bridge: {
    readFile: async (_r: string, p: string) => {
      const contents = files.get(p);
      return contents === undefined ? null : { contents, hash: "h" };
    },
    readBookSnapshotPage: async (_r: string, _s: string, p: string) => {
      if (readError) throw readError;
      const contents = snapshotPages.get(p);
      if (contents === undefined) throw { kind: "not_found", path: p };
      return { contents, hash: "h" };
    },
  },
}));

const snap = (pages: string[]): BookSnapshotEntry => ({
  path: ".cadabra/snapshots/s.json",
  at: "20261028-1000",
  name: "s",
  automatic: false,
  pinned: false,
  pages,
  assets: 0,
  bytes: 10,
});

beforeEach(() => {
  files.clear();
  snapshotPages.clear();
  readError = null;
});

describe("parseDoc and compareWithCurrent", () => {
  it("returns null for missing, broken or non-chapter text", () => {
    expect(parseDoc(undefined)).toBeNull();
    expect(parseDoc("{")).toBeNull();
    expect(parseDoc('{"type":"nope"}')).toBeNull();
    expect(parseDoc(doc("a"))).not.toBeNull();
  });
  it("counts words and added or removed words against the current paragraphs", () => {
    const c = compareWithCurrent(["one two"], doc("one three"));
    expect(c.words).toBe(2);
    expect(c.added).toBe(1);
    expect(c.removed).toBe(1);
    expect(compareWithCurrent(["x"], "{").words).toBeNull();
  });
});

describe("readCurrentParagraphs", () => {
  it("is null when the file is not in the book", async () => {
    expect(await readCurrentParagraphs("/r", "manuscript/a.json")).toBeNull();
    files.set("manuscript/a.json", doc("hello"));
    expect(await readCurrentParagraphs("/r", "manuscript/a.json")).toEqual(["hello"]);
  });
});

describe("loadBookCompare", () => {
  const file = "manuscript/a.json";
  it("compares the snapshot's page with the current text", async () => {
    files.set(file, doc("new words"));
    snapshotPages.set(file, doc("old words"));
    const r = await loadBookCompare("/r", snap([file]), file);
    expect(r.status).toBe("ready");
    if (r.status === "ready") {
      expect(r.gone).toBe(false);
      expect(r.compared.added).toBe(1);
      expect(r.compared.removed).toBe(1);
    }
  });
  it("shows everything as 'in this version only' when the chapter is gone from the book", async () => {
    snapshotPages.set(file, doc("old words"));
    const r = await loadBookCompare("/r", snap([file]), file);
    expect(r.status === "ready" && r.gone).toBe(true);
    expect(r.status === "ready" && r.compared.removed).toBe(0);
    expect(r.status === "ready" && r.compared.added).toBe(2);
  });
  it("says missing when the snapshot has no copy, listed or not", async () => {
    expect((await loadBookCompare("/r", snap([]), file)).status).toBe("missing");
    expect((await loadBookCompare("/r", snap([file]), file)).status).toBe("missing"); // listed, gone: not_found
  });
  it("says unreadable when the page is not a chapter", async () => {
    snapshotPages.set(file, "not json");
    expect((await loadBookCompare("/r", snap([file]), file)).status).toBe("unreadable");
  });
  it("reports any other failure without throwing", async () => {
    snapshotPages.set(file, doc("a"));
    readError = { kind: "io", message: "boom" };
    const r = await loadBookCompare("/r", snap([file]), file);
    expect(r.status).toBe("error");
  });
});
