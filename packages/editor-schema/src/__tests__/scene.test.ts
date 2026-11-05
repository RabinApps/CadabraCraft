import { describe, expect, it } from "vitest";
import type { ChapterDoc, DocNode } from "@cadabracraft/shared";
import { Scene, chapterDocProblem } from "../index";

const p = (text: string): DocNode => ({ type: "paragraph", content: [{ type: "text", text }] });
const bare = (attrs: Record<string, unknown>): DocNode =>
  ({ type: "scene", attrs, content: [p("x")] }) as DocNode;
const scene = (attrs: Record<string, unknown>): ChapterDoc => ({
  type: "doc",
  content: [bare(attrs)],
});

describe("scene nodes", () => {
  it("accepts a scene with its notes, and one with every note left out", () => {
    expect(
      chapterDocProblem(
        scene({
          id: "sc-1",
          title: "Opening",
          synopsis: "Mara waits at the harbour.",
          pov: "Mara",
          status: "draft",
          label: "Act I",
          target: 800,
        }),
      ),
    ).toBeNull();
    expect(chapterDocProblem(scene({ id: "sc-2" }))).toBeNull();
  });

  it("refuses a scene without a usable id", () => {
    expect(chapterDocProblem(scene({ id: "1 bad" }))).toMatch(/scene id/);
    expect(chapterDocProblem(scene({}))).toMatch(/scene id/);
  });

  it("refuses notes that are too long, or not text", () => {
    expect(chapterDocProblem(scene({ id: "sc-1", title: "a".repeat(201) }))).toMatch(/title/);
    expect(chapterDocProblem(scene({ id: "sc-1", synopsis: "a".repeat(2001) }))).toMatch(
      /synopsis/,
    );
    expect(chapterDocProblem(scene({ id: "sc-1", pov: "a".repeat(121) }))).toMatch(/pov/);
    expect(chapterDocProblem(scene({ id: "sc-1", label: "a".repeat(61) }))).toMatch(/label/);
    expect(chapterDocProblem(scene({ id: "sc-1", title: 7 }))).toMatch(/title/);
  });

  it("refuses a status it does not know, and accepts every status it does", () => {
    expect(chapterDocProblem(scene({ id: "sc-1", status: "done" }))).toMatch(/status/);
    expect(chapterDocProblem(scene({ id: "sc-1", status: "" }))).toBeNull();
    for (const status of ["outline", "draft", "revised", "final"])
      expect(chapterDocProblem(scene({ id: "sc-1", status }))).toBeNull();
  });

  it("refuses a target that is not a whole number of words, and accepts 0 and null", () => {
    expect(chapterDocProblem(scene({ id: "sc-1", target: 1.5 }))).toMatch(/target/);
    expect(chapterDocProblem(scene({ id: "sc-1", target: -1 }))).toMatch(/target/);
    expect(chapterDocProblem(scene({ id: "sc-1", target: 1_000_001 }))).toMatch(/target/);
    expect(chapterDocProblem(scene({ id: "sc-1", target: "800" }))).toMatch(/target/);
    expect(chapterDocProblem(scene({ id: "sc-1", target: 0 }))).toBeNull();
    expect(chapterDocProblem(scene({ id: "sc-1", target: null }))).toBeNull();
  });

  it("refuses a scene with no notes object at all, and names the missing id", () => {
    expect(
      chapterDocProblem({ type: "doc", content: [{ type: "scene", content: [p("x")] }] }),
    ).toMatch(/scene id/);
  });

  it("is a block: it cannot sit inside a paragraph", () => {
    expect(
      chapterDocProblem({
        type: "doc",
        content: [{ type: "paragraph", content: [bare({ id: "sc-1" })] }],
      }),
    ).not.toBeNull();
  });
});

describe("the scene node's HTML", () => {
  it("renders as a marked section without the notes, and parses one back", () => {
    const render = Scene.config.renderHTML as unknown as (p: unknown) => unknown;
    expect(
      render({ node: { attrs: { id: "sc-1", title: "Secret" } }, HTMLAttributes: {} }),
    ).toEqual(["section", { "data-scene": "" }, 0]);
    const parse = Scene.config.parseHTML as unknown as () => { tag: string }[];
    expect(parse()).toEqual([{ tag: "section[data-scene]" }]);
  });
});
