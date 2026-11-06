import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import { getSchema, type Editor } from "@tiptap/react";
import { extensions } from "@cadabracraft/editor-schema";
import {
  Search,
  getSearchInfo,
  goToMatch,
  searchCommands,
  searchKey,
  type SearchCommands,
} from "../plugin";

// A bare stand-in for the TipTap editor: the commands only need `state`, `view.dispatch` and `view.domAtPos`.
const schema = getSchema(extensions);
const plugins = Search.config.addProseMirrorPlugins!.call({} as never);
const doc = schema.nodeFromJSON({
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "cat dog cat" }] },
    { type: "paragraph", content: [{ type: "text", text: "cat" }] },
  ],
});

interface Fake {
  editor: Editor;
  state: () => EditorState;
  domAtPos: ReturnType<typeof vi.fn>;
}
function fakeEditor(domAtPos: (pos: number) => unknown): Fake {
  let state = EditorState.create({ doc, plugins });
  const dom = vi.fn(domAtPos);
  const editor = {
    get state() {
      return state;
    },
    view: {
      dispatch: (tr: Transaction) => {
        state = state.apply(tr);
      },
      domAtPos: dom,
    },
  } as unknown as Editor;
  return { editor, state: () => state, domAtPos: dom };
}

/** Builds the `editor.commands` object the way TipTap does, running each command against the fake's state. */
function commandsOf(f: Fake): SearchCommands {
  const built = Search.config.addCommands!.call({ editor: f.editor } as never) as unknown as Record<
    string,
    (...a: unknown[]) => (p: { state: EditorState; tr: Transaction }) => boolean
  >;
  const out: Record<string, (...a: unknown[]) => boolean> = {};
  for (const [name, make] of Object.entries(built))
    out[name] = (...a) => {
      const tr = f.state().tr;
      const ok = make(...a)({ state: f.state(), tr });
      // TipTap dispatches the shared transaction; step commands dispatch their own, so an untouched one is dropped.
      if (tr.docChanged || tr.getMeta(searchKey)) f.editor.view.dispatch(tr);
      return ok;
    };
  return out as unknown as SearchCommands;
}

afterEach(() => vi.unstubAllGlobals());

describe("search commands", () => {
  it("runs search, step, replace and clear through the command objects", () => {
    const f = fakeEditor(() => {
      throw new Error("no DOM");
    });
    const c = commandsOf(f);
    expect(c.setSearch({ query: "cat", replacement: "owl" })).toBe(true);
    expect(getSearchInfo(f.editor)).toEqual({ total: 3, index: 1 });
    expect(c.findNext()).toBe(true);
    expect(getSearchInfo(f.editor).index).toBe(2);
    expect(c.findPrevious(true)).toBe(true);
    expect(getSearchInfo(f.editor).index).toBe(1);
    expect(f.state().selection.empty).toBe(false);
    expect(c.replaceCurrent()).toBe(true);
    expect(f.state().doc.textContent).toContain("owl");
    expect(c.replaceAll()).toBe(true);
    expect(f.state().doc.textContent).not.toContain("cat");
    expect(c.replaceAll()).toBe(false);
    expect(c.findNext()).toBe(false); // nothing left to step to
    expect(c.clearSearch()).toBe(true);
    expect(searchKey.getState(f.state())!.query).toBe("");
  });

  it("scrolls the element of the match into view, or its parent for a text node", () => {
    class FakeElement {
      scrollIntoView = vi.fn();
    }
    vi.stubGlobal("Element", FakeElement);
    const el = new FakeElement();
    const parent = new FakeElement();
    let node: unknown = el;
    const f = fakeEditor(() => ({ node }));
    const c = commandsOf(f);
    c.setSearch({ query: "dog" });
    expect(c.findNext()).toBe(true);
    expect(el.scrollIntoView).toHaveBeenCalledWith({ block: "center", inline: "nearest" });
    node = { parentElement: parent };
    expect(c.findNext()).toBe(true);
    expect(parent.scrollIntoView).toHaveBeenCalledOnce();
    node = { parentElement: null };
    expect(c.findNext()).toBe(true); // a detached text node: nothing to scroll
  });

  it("makes a match current without selecting it, and refuses a match that is not there", () => {
    const f = fakeEditor(() => {
      throw new Error("no DOM");
    });
    commandsOf(f).setSearch({ query: "cat" });
    const selection = f.state().selection;
    expect(goToMatch(f.editor, 2)).toBe(true);
    expect(getSearchInfo(f.editor)).toEqual({ total: 3, index: 3 });
    expect(f.state().selection.eq(selection)).toBe(true);
    expect(goToMatch(f.editor, 3)).toBe(false);
    expect(goToMatch(f.editor, -1)).toBe(false);
    expect(getSearchInfo(f.editor).index).toBe(3);
  });

  it("exposes the commands through searchCommands", () => {
    const editor = { commands: { findNext: 1 } } as unknown as Editor;
    expect(searchCommands(editor)).toBe(editor.commands);
  });
});
