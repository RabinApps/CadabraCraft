import { afterEach, describe, expect, it, vi } from "vitest";
import { addRecent, parseRecents, removeRecent, type Recent } from "../recents";

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
});
