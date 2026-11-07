import { describe, expect, it } from "vitest";
import {
  ENTRY_ICONS,
  FormatError,
  addChapter,
  addFrontMatter,
  createManifest,
  entryRows,
  entryRowsIn,
  isEntryIcon,
  parseManifest,
  setEntryIcon,
} from "../index";

const book = () => {
  const base = createManifest({ title: "T", author: "A", identifier: "urn:uuid:1" });
  return addFrontMatter(addChapter(base, "One").manifest, "dedication", "For you").manifest;
};

describe("entry icons", () => {
  it("knows its allowlist", () => {
    expect(isEntryIcon("feather")).toBe(true);
    expect(isEntryIcon("not-an-icon")).toBe(false);
    expect(isEntryIcon(3)).toBe(false);
    expect(new Set(ENTRY_ICONS).size).toBe(ENTRY_ICONS.length);
  });
  it("sets, replaces and clears the icon of a chapter and of a matter page", () => {
    let m = setEntryIcon(book(), "ch-1", "moon");
    expect(m.chapters[0]!.icon).toBe("moon");
    m = setEntryIcon(m, "ch-1", "sun");
    expect(m.chapters[0]!.icon).toBe("sun");
    m = setEntryIcon(m, "ch-1", null);
    expect("icon" in m.chapters[0]!).toBe(false);
    m = setEntryIcon(m, "fm-1", "heart");
    expect(m.frontMatter[0]!.icon).toBe("heart");
    const b = setEntryIcon(m, "fm-1", null);
    expect("icon" in b.frontMatter[0]!).toBe(false);
  });
  it("reaches back matter and refuses an unknown page", () => {
    const back = createManifest({ title: "T", author: "A", identifier: "urn:uuid:1" });
    const withBack = {
      ...back,
      backMatter: [{ id: "bm-1", titles: { en: "End" }, files: { en: "back-matter/1.json" } }],
    };
    expect(setEntryIcon(withBack, "bm-1", "key").backMatter[0]!.icon).toBe("key");
    expect(() => setEntryIcon(book(), "nope", "key")).toThrow("no page nope");
  });
  it("shows the icon in list rows only when set", () => {
    const m = setEntryIcon(book(), "ch-1", "star");
    expect(entryRows(m.chapters, m.editions)[0]!.icon).toBe("star");
    expect(entryRowsIn(m.chapters, m.editions, "en")[0]!.icon).toBe("star");
    const none = book();
    expect("icon" in entryRows(none.chapters, none.editions)[0]!).toBe(false);
    expect("icon" in entryRowsIn(none.chapters, none.editions, "en")[0]!).toBe(false);
  });
  it("keeps a name it does not know through a load", () => {
    const m = setEntryIcon(book(), "ch-1", "future-icon");
    const back = parseManifest(JSON.stringify(m)).manifest;
    expect(back.chapters[0]!.icon).toBe("future-icon");
  });
  it("refuses a malformed icon", () => {
    for (const icon of [5, "", "Has Space", "x".repeat(41)]) {
      const m = book();
      const raw = { ...m, chapters: [{ ...m.chapters[0]!, icon }] };
      expect(() => parseManifest(JSON.stringify(raw))).toThrow(FormatError);
    }
  });
});
