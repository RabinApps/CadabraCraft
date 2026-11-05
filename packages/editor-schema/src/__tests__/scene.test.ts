import { describe, expect, it } from "vitest";
import type { ChapterDoc, DocNode } from "@cadabracraft/shared";
import { MAX_SCENE_CAST, Scene, chapterDocProblem, isStoryDate } from "../index";

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

  it("accepts a cast of codex ids, and refuses a cast that is not a list of them", () => {
    expect(chapterDocProblem(scene({ id: "sc-1", cast: ["mara", "quay"] }))).toBeNull();
    expect(chapterDocProblem(scene({ id: "sc-1", cast: [] }))).toBeNull();
    expect(chapterDocProblem(scene({ id: "sc-1", cast: "mara" }))).toMatch(/cast/);
    expect(chapterDocProblem(scene({ id: "sc-1", cast: ["1 bad"] }))).toMatch(/cast/);
    expect(chapterDocProblem(scene({ id: "sc-1", cast: ["mara", "mara"] }))).toMatch(/repeats/);
    expect(
      chapterDocProblem(
        scene({ id: "sc-1", cast: Array.from({ length: MAX_SCENE_CAST + 1 }, (_, i) => `e${i}`) }),
      ),
    ).toMatch(/the most is/);
  });

  it("accepts a story date as a real day with an optional time, and refuses anything else", () => {
    for (const date of ["", "2031-04-09", "2031-04-09T07:30", "2032-02-29", "0001-01-01"])
      expect(chapterDocProblem(scene({ id: "sc-1", date }))).toBeNull();
    for (const date of [
      "2031-4-9",
      "2031-02-30",
      "2031-13-01",
      "2031-04-09T24:00",
      "2031-04-09T07:60",
      "2031-04-09T07:30:00",
      "2031-04-09 07:30",
      "in spring",
      "2031-04-09T07:30Z",
    ])
      expect(chapterDocProblem(scene({ id: "sc-1", date }))).toMatch(/date/);
    expect(chapterDocProblem(scene({ id: "sc-1", date: 20310409 }))).toMatch(/date/);
    expect(chapterDocProblem(scene({ id: "sc-1", date: "2031-04-09".padEnd(17, "0") }))).toMatch(
      /date/,
    );
    expect(isStoryDate("2031-02-29")).toBe(false);
  });

  it("opens a chapter saved before the date existed, and keeps every attribute it had", () => {
    const before = scene({
      id: "sc-1",
      title: "Opening",
      synopsis: "s",
      pov: "Mara",
      status: "draft",
      label: "Act I",
      target: 800,
      cast: ["mara"],
    });
    expect(chapterDocProblem(before)).toBeNull();
    const kept = JSON.parse(JSON.stringify(before)) as ChapterDoc;
    expect(kept).toEqual(before);
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
