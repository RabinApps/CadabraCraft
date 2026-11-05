import { describe, expect, it } from "vitest";
import {
  appendScenes,
  insertScene,
  patchScene,
  reorderScenes,
  removeScene,
  sceneIdsOf,
  unsortedRuns,
  unsortedWords,
  wrapUnsorted,
  type SceneNodeJson,
} from "../sceneMoves";

type Doc = { type: "doc"; content: unknown[] };
const para = (text: string) => ({
  type: "paragraph",
  content: text ? [{ type: "text", text }] : [],
});
const scene = (id: string, text = `words of ${id}`, attrs: Record<string, unknown> = {}) => ({
  type: "scene",
  attrs: { id, title: "", synopsis: "", pov: "", status: "", label: "", target: null, ...attrs },
  content: [para(text)],
});
const doc = (...content: unknown[]): Doc => ({ type: "doc", content });
const title = { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "One" }] };

/** The doc's blocks in order with each scene replaced by its children: what a reader sees, whatever the scene structure. */
const flat = (d: unknown): string[] =>
  ((d as Doc).content as { type: string; content?: unknown[] }[]).flatMap((b) =>
    b.type === "scene" ? (b.content ?? []).map((x) => JSON.stringify(x)) : [JSON.stringify(b)],
  );

describe("patchScene", () => {
  it("changes the notes of one scene and nothing else", () => {
    const d = doc(title, scene("a"), scene("b"));
    const next = patchScene(d, "b", { synopsis: "Mara waits.", target: 500, date: "2031-04-09" })!;
    expect((next.content[2] as SceneNodeJson).attrs).toMatchObject({
      id: "b",
      synopsis: "Mara waits.",
      target: 500,
      date: "2031-04-09",
    });
    expect(next.content[1]).toBe(d.content[1]);
    expect((d.content[2] as SceneNodeJson).attrs.synopsis).toBe("");
  });

  it("never changes the id, and says so with null when the scene is not there", () => {
    const d = doc(scene("a"));
    expect(
      (patchScene(d, "a", { id: "zz", title: "T" } as never)!.content[0] as SceneNodeJson).attrs.id,
    ).toBe("a");
    expect(patchScene(d, "missing", { title: "T" })).toBeNull();
  });

  it("finds a scene inside another block", () => {
    const d = doc({ type: "blockquote", content: [scene("deep")] });
    const next = patchScene(d, "deep", { title: "Deep" })!;
    expect(JSON.stringify(next)).toContain('"title":"Deep"');
  });
});

describe("removeScene", () => {
  it("lifts a scene out with its children", () => {
    const d = doc(title, scene("a"), scene("b"));
    const r = removeScene(d, "a")!;
    expect(r.scene.attrs.id).toBe("a");
    expect(r.scene.content).toEqual(
      d.content.slice(1, 2).map((s) => (s as SceneNodeJson).content[0]),
    );
    expect(sceneIdsOf(r.doc)).toEqual(["b"]);
  });

  it("keeps a valid chapter when the last block goes, and a container that held only the scene", () => {
    expect(removeScene(doc(scene("a")), "a")!.doc.content).toEqual([{ type: "paragraph" }]);
    const nested = removeScene(doc({ type: "blockquote", content: [scene("a")] }), "a")!;
    expect(nested.doc.content).toEqual([{ type: "blockquote", content: [{ type: "paragraph" }] }]);
  });

  it("is null for a scene that is not there", () => {
    expect(removeScene(doc(scene("a")), "b")).toBeNull();
  });
});

describe("insertScene", () => {
  const d = doc(title, scene("a"), para("loose"), scene("b"));
  const s = scene("n") as SceneNodeJson;

  it("puts the scene before the one now at that place", () => {
    expect(sceneIdsOf(insertScene(d, s, 0))).toEqual(["n", "a", "b"]);
    expect(sceneIdsOf(insertScene(d, s, 1))).toEqual(["a", "n", "b"]);
  });

  it("puts it at the end of the chapter when the place is past the last scene or below zero", () => {
    expect(sceneIdsOf(insertScene(d, s, 2))).toEqual(["a", "b", "n"]);
    expect(sceneIdsOf(insertScene(d, s, 99))).toEqual(["a", "b", "n"]);
    expect(insertScene(d, s, -1).content.at(-1)).toBe(s);
    expect(sceneIdsOf(insertScene(doc(title), s, 0))).toEqual(["n"]);
  });

  it("refuses a second scene with the same id", () => {
    expect(() => insertScene(d, scene("a") as SceneNodeJson, 0)).toThrow(/already has a scene a/);
  });
});

describe("appendScenes", () => {
  const d = doc(title, scene("a"), para("loose"));
  const n1 = scene("n1") as SceneNodeJson;
  const n2 = scene("n2") as SceneNodeJson;

  it("adds the scenes after everything, in order, and leaves what was there alone", () => {
    const out = appendScenes(d, [n1, n2]);
    expect(out.content.slice(0, 3)).toEqual(d.content);
    expect(out.content.slice(3)).toEqual([n1, n2]);
    expect(d.content).toHaveLength(3);
  });

  it("changes nothing for an empty list, and refuses an id that is already there or repeated", () => {
    expect(appendScenes(d, [])).toEqual(d);
    expect(() => appendScenes(d, [scene("a") as SceneNodeJson])).toThrow(/already has a scene a/);
    expect(() => appendScenes(d, [n1, n1])).toThrow(/already has a scene n1/);
  });
});

describe("reorderScenes", () => {
  it("moves a scene to its place among the others", () => {
    const d = doc(scene("a"), scene("b"), scene("c"));
    expect(sceneIdsOf(reorderScenes(d, "a", 2)!)).toEqual(["b", "c", "a"]);
    expect(sceneIdsOf(reorderScenes(d, "c", 0)!)).toEqual(["c", "a", "b"]);
    expect(sceneIdsOf(reorderScenes(d, "b", 1)!)).toEqual(["a", "b", "c"]);
    expect(reorderScenes(d, "zz", 0)).toBeNull();
  });
});

describe("unsorted blocks", () => {
  it("ignores the chapter title, empty paragraphs and the scenes themselves", () => {
    expect(unsortedRuns(doc(title, para(""), scene("a")))).toEqual([]);
    expect(unsortedRuns(doc(title))).toEqual([]);
    expect(unsortedWords(doc(scene("a")))).toBe(0);
  });

  it("finds each run of loose text with its words", () => {
    const d = doc(
      title,
      para("one two"),
      para(""),
      scene("a"),
      para("three"),
      scene("b"),
      para("four five six"),
    );
    expect(unsortedRuns(d)).toEqual([
      { start: 1, end: 3, words: 2 },
      { start: 4, end: 5, words: 1 },
      { start: 6, end: 7, words: 3 },
    ]);
    expect(unsortedWords(d)).toBe(6);
  });

  it("counts a chapter with no title heading from its first block", () => {
    expect(unsortedRuns(doc(para("hello there")))).toEqual([{ start: 0, end: 1, words: 2 }]);
  });

  it("wraps each run into a scene with empty notes and loses no block", () => {
    const d = doc(title, para("one"), scene("a"), para("two"), para(""));
    let n = 0;
    const r = wrapUnsorted(d, () => `sc-new${++n}`);
    expect(r.ids).toEqual(["sc-new1", "sc-new2"]);
    expect(sceneIdsOf(r.doc)).toEqual(["sc-new1", "a", "sc-new2"]);
    expect(flat(r.doc)).toEqual(flat(d));
    expect(unsortedRuns(r.doc)).toEqual([]);
    expect((r.doc.content[1] as SceneNodeJson).attrs).toMatchObject({
      title: "",
      status: "",
      target: null,
      date: "",
    });
  });

  it("returns the same doc when nothing is loose", () => {
    const d = doc(title, scene("a"));
    expect(wrapUnsorted(d, () => "x")).toEqual({ doc: d, ids: [] });
  });
});

describe("moves never lose a block or repeat an id", () => {
  // A small seeded generator keeps the run repeatable without adding a dependency.
  const rng = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  it("holds over many random moves between chapters", () => {
    const random = rng(7);
    const pick = (n: number) => Math.floor(random() * n);
    let counter = 0;
    const chapter = (): Doc => {
      const parts: unknown[] = [title];
      for (let i = 0, n = pick(5); i < n; i++)
        parts.push(
          random() < 0.3 ? para(`loose ${++counter}`) : scene(`s${++counter}`, `text ${counter}`),
        );
      return doc(...parts);
    };
    for (let round = 0; round < 200; round++) {
      let chapters = [chapter(), chapter(), chapter()];
      const everything = () => chapters.flatMap(flat).sort();
      const before = everything();
      for (let step = 0; step < 12; step++) {
        const from = pick(3);
        const ids = sceneIdsOf(chapters[from]);
        if (!ids.length) continue;
        const id = ids[pick(ids.length)]!;
        const to = pick(3);
        const index = pick(5);
        const taken = removeScene(chapters[from]!, id)!;
        chapters = chapters.map((c, i) => (i === from ? taken.doc : c));
        chapters[to] = insertScene(chapters[to]!, taken.scene, index);
        const all = chapters.flatMap(sceneIdsOf);
        expect(new Set(all).size).toBe(all.length);
      }
      // A chapter that lost its last block gains an empty paragraph; every real block is still somewhere.
      const after = everything().filter((x) => x !== JSON.stringify({ type: "paragraph" }));
      expect(after).toEqual(before.filter((x) => x !== JSON.stringify({ type: "paragraph" })));
    }
  });
});
