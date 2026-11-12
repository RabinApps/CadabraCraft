import { addChapter, addEdition, createManifest, markTranslated } from "@cadabracraft/format";
import { describe, expect, it, vi } from "vitest";
import { createPickChapters } from "../pick";

const manifest = () => {
  let m = createManifest({ title: "B", author: "A", identifier: "urn:x" });
  m = addChapter(addChapter(m, "One").manifest, "Two").manifest;
  m = addEdition(
    m,
    { language: "fr", title: "B", author: "A", identifier: "urn:x", isbn: null, cover: null },
    "empty",
  ).manifest;
  return markTranslated(m, m.chapters[0]!.id, "fr");
};
const page = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  section: "chapter",
  ...extra,
});
const pick = (m = manifest()) => {
  const pages = [
    page(m.chapters[0]!.id),
    page(m.chapters[1]!.id),
    page("blank", { kind: "blank" }),
    page("part", { kind: "part" }),
    { id: "front", section: "front" },
  ];
  return createPickChapters({
    need: () => ({ manifest: m }),
    loadChaptersIn: vi.fn(async () => pages),
  } as never);
};

describe("pick chapters for the audiobook", () => {
  it("reads the source edition's chapters only, without blank pages, parts or matter", async () => {
    const m = manifest();
    const r = await pick(m)({});
    expect(r.language).toBe("en");
    expect(r.pages.map((p) => p.id)).toEqual([m.chapters[0]!.id, m.chapters[1]!.id]);
  });
  it("refuses an edition that does not exist", async () => {
    await expect(pick()({ language: "de" })).rejects.toThrow(/no de edition/);
  });
  it("stops on untranslated chapters unless they are skipped", async () => {
    const m = manifest();
    await expect(pick(m)({ language: "fr" })).rejects.toThrow(/Not translated yet in fr: Two/);
    const r = await pick(m)({ language: "fr", skipUntranslated: true });
    expect(r.pages.map((p) => p.id)).toEqual([m.chapters[0]!.id]);
  });
  it("reads only the chapters asked for, and ignores untranslated ones that were not asked for", async () => {
    const m = manifest();
    const one = m.chapters[0]!.id;
    const r = await pick(m)({ language: "fr", chapterIds: [one] });
    expect(r.pages.map((p) => p.id)).toEqual([one]);
  });
});
