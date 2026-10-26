import { describe, expect, it } from "vitest";
import { addRecent, parseRecents, removeRecent, type Recent } from "./recents";

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
    expect(parseRecents(JSON.stringify([r("/a"), { root: 3 }, null, r("/a", 2), r("/b")])).map((x) => x.root)).toEqual(["/a", "/b"]);
  });
});
