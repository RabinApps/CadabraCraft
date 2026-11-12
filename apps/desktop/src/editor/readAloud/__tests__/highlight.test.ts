import { Schema } from "@tiptap/pm/model";
import { EditorState, type Plugin } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { ReadAloudHighlight, readAloudKey, setHighlight } from "../highlight";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*" },
    text: {},
  },
});
const doc = schema.node("doc", null, [
  schema.node("paragraph", null, [schema.text("Hello world")]),
]);
const plugins = () =>
  (ReadAloudHighlight.config.addProseMirrorPlugins as unknown as (this: unknown) => Plugin[]).call(
    {},
  );
const start = () => EditorState.create({ doc, plugins: plugins() });
const current = (state: EditorState) => readAloudKey.getState(state)!.find();

describe("read aloud highlight", () => {
  it("starts without a highlight", () => {
    const state = start();
    expect(current(state)).toEqual([]);
    expect(plugins()[0]!.props.decorations!.call(plugins()[0]!, state)).toBe(
      readAloudKey.getState(state),
    );
  });
  it("shows a span, moves it with edits and clears it", () => {
    let state = start();
    state = state.apply(state.tr.setMeta(readAloudKey, { from: 1, to: 6 }));
    expect(current(state).map((d) => [d.from, d.to])).toEqual([[1, 6]]);
    state = state.apply(state.tr.insertText("Oh ", 1));
    expect(current(state).map((d) => [d.from, d.to])).toEqual([[4, 9]]);
    state = state.apply(state.tr.setMeta(readAloudKey, null));
    expect(current(state)).toEqual([]);
  });
  it("shows nothing for an empty span", () => {
    let state = start();
    state = state.apply(state.tr.setMeta(readAloudKey, { from: 3, to: 3 }));
    expect(current(state)).toEqual([]);
  });
  it("setHighlight dispatches the span without recording history", () => {
    let state = start();
    const editor = {
      get state() {
        return state;
      },
      view: {
        dispatch: (tr: ReturnType<EditorState["tr"]["setMeta"]>) => {
          state = state.apply(tr);
        },
      },
    };
    setHighlight(editor as never, { from: 1, to: 3 });
    expect(current(state)).toHaveLength(1);
    setHighlight(editor as never, null);
    expect(current(state)).toEqual([]);
  });
});
