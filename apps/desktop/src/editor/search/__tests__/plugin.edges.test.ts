import { EditorState, type Transaction } from "@tiptap/pm/state";
import { getSchema, type Editor } from "@tiptap/react";
import { extensions } from "@cadabracraft/editor-schema";
import { describe, expect, it } from "vitest";
import {
  Search,
  getSearchInfo,
  replaceCurrentTransaction,
  searchKey,
  setSearchTransaction,
} from "../plugin";

const schema = getSchema(extensions);
const plugins = Search.config.addProseMirrorPlugins!.call({} as never);
const make = (text: string) =>
  EditorState.create({
    doc: schema.nodeFromJSON({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    }),
    plugins,
  });
const searched = (text: string, query: string) => {
  const s = make(text);
  return s.apply(setSearchTransaction(s, { query }));
};
const get = (s: EditorState) => searchKey.getState(s)!;

describe("search plugin edge cases", () => {
  it("keeps the current index when an edit destroys only the current match", () => {
    let s = searched("ab ab ab", "ab");
    expect(get(s).current).toBe(0);
    s = s.apply(s.tr.insertText("X", 1, 2));
    expect(get(s).matches).toHaveLength(2);
    expect(get(s).current).toBe(0);
  });
  it("rescans without moving the current match when no index is given", () => {
    let s = searched("ab ab ab", "ab");
    s = s.apply(s.tr.setMeta(searchKey, { current: 2 }));
    s = s.apply(s.tr.setMeta(searchKey, { rescan: true }));
    expect(get(s).current).toBe(2);
  });
  it("reports no matches for an editor without the search plugin", () => {
    const bare = { state: EditorState.create({ schema }) } as unknown as Editor;
    expect(getSearchInfo(bare)).toEqual({ total: 0, index: 0 });
  });
  it("has nothing to replace with no search, or when the match was edited away", () => {
    expect(replaceCurrentTransaction(make("ab"))).toBeNull();
    let s = searched("ab", "ab");
    s = s.apply(s.tr.insertText("X", 1, 2) as Transaction);
    expect(replaceCurrentTransaction(s)).toBeNull();
  });
});
