import { describe, expect, it } from "vitest";
import { buildBoard } from "../boardData";
import { sceneRows } from "../scenes";
import { unsortedWords } from "../sceneMoves";

const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const scene = (id: string, text: string) => ({
  type: "scene",
  attrs: { id, title: id },
  content: [para(text)],
});
const read = (...blocks: unknown[]) => {
  const doc = { type: "doc", content: blocks };
  return { rows: sceneRows(doc), unsorted: unsortedWords(doc) };
};

describe("buildBoard", () => {
  const titles = new Map([
    ["c1", "One"],
    ["c2", "Two"],
  ]);

  it("lists every chapter in order with its scenes and loose words", () => {
    const board = buildBoard([{ id: "c1" }, { id: "c2" }], titles, {
      c1: read(scene("a", "alpha beta"), para("loose words here")),
      c2: read(scene("b", "gamma")),
    });
    expect(board.duplicates).toEqual([]);
    expect(board.chapters.map((c) => [c.id, c.title, c.loaded, c.unsortedWords])).toEqual([
      ["c1", "One", true, 3],
      ["c2", "Two", true, 0],
    ]);
    expect(board.chapters[0]!.rows.map((r) => [r.id, r.words])).toEqual([["a", 2]]);
  });

  it("marks a chapter that has not been read and keeps an empty title for an unknown one", () => {
    const board = buildBoard([{ id: "c1" }, { id: "zz" }], titles, { c1: read() });
    expect(board.chapters.map((c) => c.loaded)).toEqual([true, false]);
    expect(board.chapters[1]).toMatchObject({ title: "", rows: [], unsortedWords: 0 });
  });

  it("shows a scene id that sits in two chapters once, and reports it", () => {
    const board = buildBoard([{ id: "c1" }, { id: "c2" }], titles, {
      c1: read(scene("a", "x"), scene("a", "again")),
      c2: read(scene("a", "x"), scene("b", "y")),
    });
    expect(board.chapters.map((c) => c.rows.map((r) => r.id))).toEqual([["a"], ["b"]]);
    expect(board.duplicates).toEqual(["a", "a"]);
  });
});
