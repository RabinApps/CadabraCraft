import { describe, expect, it } from "vitest";
import { createManifest, type Manifest } from "@cadabracraft/format";
import { epubChecks } from "../exportChecks";

const book = (titles: string[]): Manifest => ({
  ...createManifest({ title: "Book", author: "", identifier: "id-1" }),
  chapters: titles.map((title, i) => ({ id: `c${i}`, file: `chapters/c${i}.json`, title })),
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
