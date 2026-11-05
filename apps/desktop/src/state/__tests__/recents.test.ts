import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addRecent,
  addScanned,
  MAX_KNOWN,
  MAX_RECENTS,
  newest,
  parseRecents,
  removeRecent,
  updateStats,
  type BookStats,
  type Recent,
} from "../recents";

const r = (root: string, openedAt = 1, title = root): Recent => ({ root, title, openedAt });

describe("recent projects list", () => {
  it("puts the newest first and dedupes by folder, updating the title", () => {
    const list = addRecent(addRecent([], r("/a")), r("/b"));
    const next = addRecent(list, r("/a", 5, "Renamed"));
    expect(next.map((x) => x.root)).toEqual(["/a", "/b"]);
    expect(next[0]).toMatchObject({ title: "Renamed", openedAt: 5 });
  });
  it("caps the list, dropping the oldest", () => {
    const list = ["/1", "/2", "/3"].reduce((l, p) => addRecent(l, r(p), 2), [] as Recent[]);
    expect(list.map((x) => x.root)).toEqual(["/3", "/2"]);
  });
  it("removes one entry", () => {
    expect(removeRecent([r("/a"), r("/b")], "/a").map((x) => x.root)).toEqual(["/b"]);
  });
  it("parses tolerant of corrupt or missing storage", () => {
    expect(parseRecents(null)).toEqual([]);
    expect(parseRecents("not json")).toEqual([]);
    expect(parseRecents('{"a":1}')).toEqual([]);
    expect(
      parseRecents(JSON.stringify([r("/a"), { root: 3 }, null, r("/a", 2), r("/b")])).map(
        (x) => x.root,
      ),
    ).toEqual(["/a", "/b"]);
  });
});

const stats = (words: number, over: Partial<BookStats> = {}): BookStats => ({
  author: "Mara",
  chapters: 12,
  words,
  chapterNo: 7,
  chapterTitle: "The Orchard Wall",
  ...over,
});

describe("recent book stats", () => {
  it("keeps what is known about a book when it is opened again", () => {
    const withStats = updateStats([r("/a")], "/a", stats(100), 9);
    const next = addRecent(withStats, r("/a", 5, "Renamed"));
    expect(next[0]).toMatchObject({ title: "Renamed", openedAt: 5, stats: stats(100) });
  });
  it("updates one book without touching the others", () => {
    const list = [r("/a"), r("/b"), r("/c")];
    const next = updateStats(list, "/b", stats(5), 9);
    expect(next.map((x) => x.root)).toEqual(["/a", "/b", "/c"]);
    expect(next[1]).toMatchObject({ stats: stats(5) });
    expect(next[0]).toBe(list[0]);
    expect(next[2]).toBe(list[2]);
  });
  it("records the first stats without calling the book edited", () => {
    const [first] = updateStats([r("/a")], "/a", stats(100), 9);
    expect(first).toMatchObject({ stats: stats(100) });
    expect(first?.editedAt).toBeUndefined();
  });
  it("marks the book edited when the word count changes, not when only the chapter does", () => {
    const base = updateStats([r("/a")], "/a", stats(100), 9);
    expect(updateStats(base, "/a", stats(120), 50)[0]?.editedAt).toBe(50);
    const moved = updateStats(base, "/a", stats(100, { chapterNo: 8 }), 50);
    expect(moved[0]).toMatchObject({ stats: stats(100, { chapterNo: 8 }) });
    expect(moved[0]?.editedAt).toBeUndefined();
  });
  it("returns the same list when nothing changed or the book is not listed", () => {
    const base = updateStats([r("/a")], "/a", stats(100), 9);
    expect(updateStats(base, "/a", stats(100), 99)).toBe(base);
    expect(updateStats(base, "/zzz", stats(1), 99)).toBe(base);
  });
  it("parses stored stats and drops malformed ones", () => {
    const good = { ...r("/a"), editedAt: 4, stats: stats(10) };
    const bad = { ...r("/b"), stats: { author: 1 } };
    const parsed = parseRecents(JSON.stringify([good, bad]));
    expect(parsed[0]).toEqual(good);
    expect(parsed[1]).toEqual(r("/b"));
  });
});

describe("useRecents store", () => {
  async function fresh(stored?: string) {
    const data = new Map<string, string>(
      stored === undefined ? [] : [["cadabracraft.recents", stored]],
    );
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    });
    vi.resetModules();
    const { useRecents } = await import("../recents");
    return { useRecents, data };
  }
  afterEach(() => vi.unstubAllGlobals());

  it("starts from the stored list", async () => {
    const { useRecents } = await fresh(JSON.stringify([r("/a")]));
    expect(useRecents.getState().recents).toEqual([r("/a")]);
  });
  it("adds, removes and clears, storing each change", async () => {
    vi.spyOn(Date, "now").mockReturnValue(42);
    const { useRecents, data } = await fresh();
    useRecents.getState().add("/a", "A");
    useRecents.getState().add("/b", "B");
    expect(JSON.parse(data.get("cadabracraft.recents")!)).toEqual([
      { root: "/b", title: "B", openedAt: 42 },
      { root: "/a", title: "A", openedAt: 42 },
    ]);
    useRecents.getState().remove("/b");
    expect(useRecents.getState().recents.map((x) => x.root)).toEqual(["/a"]);
    expect(JSON.parse(data.get("cadabracraft.recents")!)).toHaveLength(1);
    useRecents.getState().clear();
    expect(useRecents.getState().recents).toEqual([]);
    expect(data.get("cadabracraft.recents")).toBe("[]");
    vi.restoreAllMocks();
  });
  it("stores new stats once and ignores repeats", async () => {
    const { useRecents, data } = await fresh(JSON.stringify([r("/a")]));
    useRecents.getState().setStats("/a", stats(100));
    const first = useRecents.getState().recents;
    expect(JSON.parse(data.get("cadabracraft.recents")!)[0].stats).toEqual(stats(100));
    useRecents.getState().setStats("/a", stats(100));
    expect(useRecents.getState().recents).toBe(first);
  });
});

describe("the known-books list", () => {
  it("is not capped at the recent few; Home takes the newest of it", () => {
    const many = Array.from({ length: 25 }, (_, i) => r(`/b${i}`, i));
    const list = many.reduce((l, e) => addRecent(l, e), [] as Recent[]);
    expect(list).toHaveLength(25);
    expect(newest(list)).toHaveLength(MAX_RECENTS);
    expect(newest(list)[0]?.root).toBe("/b24");
    expect(newest(list, 2).map((x) => x.root)).toEqual(["/b24", "/b23"]);
  });
  it("is only bounded against a runaway list", () => {
    const raw = JSON.stringify(Array.from({ length: MAX_KNOWN + 5 }, (_, i) => r(`/b${i}`)));
    expect(parseRecents(raw)).toHaveLength(MAX_KNOWN);
    expect(parseRecents(raw, 3)).toHaveLength(3);
  });
  it("caches the cover and series with the stats, and a change of either is a change", () => {
    const extra = { cover: "assets/c.png", series: "Tides", seriesNumber: "2" };
    const base = updateStats([r("/a")], "/a", stats(100), 9);
    const next = updateStats(base, "/a", stats(100, extra), 20);
    expect(next).not.toBe(base);
    expect(next[0]?.stats).toMatchObject(extra);
    expect(next[0]?.editedAt).toBeUndefined();
    expect(updateStats(next, "/a", stats(100, extra), 30)).toBe(next);
    const gone = updateStats(next, "/a", stats(100), 40);
    expect(gone[0]?.stats).toEqual(stats(100));
  });
  it("parses the cached fields and drops empty or mistyped ones", () => {
    const withExtra = {
      ...r("/a"),
      stats: stats(1, { cover: "assets/c.png", series: "S", seriesNumber: "1.5" }),
    };
    const odd = { ...r("/b"), stats: { ...stats(1), cover: 3, series: "", seriesNumber: null } };
    const [a, b] = parseRecents(JSON.stringify([withExtra, odd]));
    expect(a?.stats).toEqual(withExtra.stats);
    expect(b?.stats).toEqual(stats(1));
  });
});

describe("books found by a folder scan", () => {
  const found = (root: string, over = {}) => ({ root, title: root, author: "Mara", ...over });
  it("are added after the opened books, never opened, and known ones are left alone", () => {
    const list = updateStats([r("/a", 5)], "/a", stats(100), 9);
    const next = addScanned(list, [
      found("/a", { author: "Other" }),
      found("/b", { series: "S", seriesNumber: "1" }),
      found("/b"),
      found("/c"),
    ]);
    expect(next.map((x) => x.root)).toEqual(["/a", "/b", "/c"]);
    expect(next[0]).toBe(list[0]);
    expect(next[1]).toEqual({
      root: "/b",
      title: "/b",
      openedAt: 0,
      scanned: { author: "Mara", series: "S", seriesNumber: "1" },
    });
  });
  it("return the same list when nothing is new", () => {
    const list = [r("/a")];
    expect(addScanned(list, [found("/a")])).toBe(list);
    expect(addScanned(list, [])).toBe(list);
  });
  it("respect the cap", () => {
    expect(addScanned([r("/a")], [found("/b"), found("/c")], 2).map((x) => x.root)).toEqual([
      "/a",
      "/b",
    ]);
  });
  it("are stored, parsed tolerantly, and keep their info when the book is opened", () => {
    const raw = JSON.stringify([
      {
        root: "/b",
        title: "B",
        openedAt: 0,
        scanned: { author: "M", cover: "assets/c.png", series: 4 },
      },
      { root: "/c", title: "C", openedAt: 0, scanned: { author: 3 } },
    ]);
    const [b, c] = parseRecents(raw);
    expect(b?.scanned).toEqual({ author: "M", cover: "assets/c.png" });
    expect(c?.scanned).toBeUndefined();
    expect(addRecent([b!], r("/b", 7))[0]).toMatchObject({ openedAt: 7, scanned: { author: "M" } });
  });
  it("go through the store", async () => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    });
    vi.resetModules();
    const { useRecents } = await import("../recents");
    expect(useRecents.getState().addScanned([found("/x"), found("/y")])).toBe(2);
    expect(useRecents.getState().addScanned([found("/x")])).toBe(0);
    expect(JSON.parse(data.get("cadabracraft.recents")!)).toHaveLength(2);
    vi.unstubAllGlobals();
  });
});
