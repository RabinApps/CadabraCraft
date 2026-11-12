import { addChapter, addEdition, createManifest, markTranslated } from "@cadabracraft/format";
import { describe, expect, it } from "vitest";
import { translationState } from "../audioTranslation";

const source = () => {
  let m = createManifest({ title: "B", author: "A", identifier: "urn:x" });
  m = addChapter(m, "One").manifest;
  m = addChapter(m, "Two").manifest;
  return m;
};
const french = () => {
  const m = addEdition(
    source(),
    { language: "fr", title: "B", author: "A", identifier: "urn:x", isbn: null, cover: null },
    "empty",
  ).manifest;
  return markTranslated(m, m.chapters[0]!.id, "fr");
};

describe("translationState", () => {
  it("has nothing to say without a book", () => {
    expect(translationState(null, "en", false)).toEqual({
      untranslated: [],
      blocked: false,
      rows: [],
    });
  });
  it("reads every chapter of the source edition", () => {
    const s = translationState(source(), "en", false);
    expect(s.untranslated).toEqual([]);
    expect(s.blocked).toBe(false);
    expect(s.rows).toHaveLength(2);
  });
  it("blocks on chapters the edition has not translated, unless they are skipped", () => {
    const m = french();
    const stop = translationState(m, "fr", false);
    expect(stop.untranslated.map((e) => e.id)).toEqual([m.chapters[1]!.id]);
    expect(stop.blocked).toBe(true);
    expect(stop.rows).toHaveLength(2);
    const skip = translationState(m, "fr", true);
    expect(skip.blocked).toBe(false);
    expect(skip.rows).toHaveLength(1);
  });
});
