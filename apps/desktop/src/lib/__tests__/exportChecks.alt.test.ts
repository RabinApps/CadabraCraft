import { describe, expect, it } from "vitest";
import { createManifest, type Manifest } from "@cadabracraft/format";
import { epubChecks } from "../exportChecks";

const book = (titles: string[]): Manifest => ({
  ...createManifest({ title: "Book", author: "", identifier: "id-1" }),
  chapters: titles.map((title, i) => ({
    id: `c${i}`,
    titles: { en: title },
    files: { en: `chapters/c${i}.json` },
  })),
});
const img = (alt?: string) => ({
  type: "image" as const,
  attrs: { src: "assets/a.png", ...(alt === undefined ? {} : { alt }) },
});
const page = (title: string, ...imgs: ReturnType<typeof img>[]) => ({
  title,
  file: "chapters/x.json",
  doc: { type: "doc" as const, content: [{ type: "paragraph" as const }, ...imgs] },
});

describe("epubChecks alt text", () => {
  it("warns per chapter with the count of images lacking alt text", () => {
    const out = epubChecks(book(["One", "Two"]), [
      page("One", img("ok")),
      page("Two", img(), img(" "), img("fine")),
    ]);
    expect(out).toEqual([{ tone: "warn", text: "“Two” has 2 images without alt text" }]);
  });
  it("uses the singular and falls back to the file for an untitled page", () => {
    expect(epubChecks(book(["One"]), [page("", img(""))])).toEqual([
      { tone: "warn", text: "“chapters/x.json” has 1 image without alt text" },
    ]);
  });
  it("stays ok when every image has alt text or there are none", () => {
    expect(epubChecks(book(["One"]), [page("One", img("a")), page("Two")])).toEqual([
      { tone: "ok", text: "No problems found" },
    ]);
  });
});

describe("epubChecks fallbacks", () => {
  it("uses the source title when a chapter has none in the requested language", () => {
    expect(epubChecks(book(["One"]), [], { language: "fr" })).toEqual([
      { tone: "ok", text: "No problems found" },
    ]);
    expect(epubChecks(book([" "]), [], { language: "fr" })[0]!.tone).toBe("warn");
  });
  it("names an untitled page without a file as empty quotes", () => {
    const { file: _file, ...noFile } = page("", img());
    expect(epubChecks(book(["One"]), [noFile])).toEqual([
      { tone: "warn", text: "“” has 1 image without alt text" },
    ]);
  });
});
