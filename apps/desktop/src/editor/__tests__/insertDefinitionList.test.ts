import { describe, expect, it, vi } from "vitest";
import { insertDefinitionList } from "../insertDefinitionList";

interface FakeNode {
  type: string;
  size: number;
  pos: number;
}

function fakeEditor(nodes: FakeNode[], head: number, ran = true) {
  const chains: Record<string, ReturnType<typeof vi.fn>>[] = [];
  const chain = vi.fn(() => {
    const c: Record<string, ReturnType<typeof vi.fn>> = { run: vi.fn(() => ran) };
    c.focus = vi.fn(() => c);
    c.insertContent = vi.fn(() => c);
    c.setTextSelection = vi.fn(() => c);
    chains.push(c);
    return c;
  });
  const doc = {
    descendants: (
      visit: (node: { type: { name: string }; content: { size: number } }, pos: number) => void,
    ) => {
      for (const n of nodes) visit({ type: { name: n.type }, content: { size: n.size } }, n.pos);
    },
  };
  return { chain, chains, editor: { chain, state: { doc, selection: { head } } } };
}

const term = (size: number, pos: number): FakeNode => ({ type: "definitionTerm", size, pos });
const other = (pos: number): FakeNode => ({ type: "paragraph", size: 4, pos });

describe("insertDefinitionList", () => {
  it("inserts an empty definition list and puts the caret in its term", () => {
    const { chains, editor } = fakeEditor([term(0, 5)], 20);
    expect(insertDefinitionList(editor as never)).toBe(true);
    expect(chains[0]!.insertContent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "definitionList" }),
    );
    expect(chains[1]!.setTextSelection).toHaveBeenCalledWith(6);
  });

  it("takes the term nearest the caret, skipping terms that already have text", () => {
    const { chains, editor } = fakeEditor(
      [term(0, 5), other(12), term(3, 25), term(0, 30), term(0, 40)],
      20,
    );
    insertDefinitionList(editor as never);
    expect(chains[1]!.setTextSelection).toHaveBeenCalledWith(31);
  });

  it("keeps the nearest term when a later one is farther away", () => {
    const { chains, editor } = fakeEditor([term(0, 5), term(0, 30), term(0, 60)], 10);
    insertDefinitionList(editor as never);
    expect(chains[1]!.setTextSelection).toHaveBeenCalledWith(6);
  });

  it("leaves the caret after the insert when there is no empty term to go to", () => {
    const { chain, chains, editor } = fakeEditor([term(2, 5), other(9)], 12);
    insertDefinitionList(editor as never);
    expect(chain).toHaveBeenCalledTimes(1);
    expect(chains[0]!.setTextSelection).not.toHaveBeenCalled();
  });

  it("reports what the insert did", () => {
    const { editor } = fakeEditor([term(0, 5)], 6, false);
    expect(insertDefinitionList(editor as never)).toBe(false);
  });
});
