import { describe, expect, it } from "vitest";
import { createBlockCache } from "../cache";

const style = { marginTop: 0, marginBottom: 8, lineHeight: 20, textBlocks: 1 };

describe("block style cache", () => {
  it("returns what was stored for the same node and counts hits and misses", () => {
    const cache = createBlockCache();
    cache.sync("a");
    const node = {};
    expect(cache.get(node)).toBeUndefined();
    cache.set(node, style);
    expect(cache.get(node)).toBe(style);
    expect(cache.stats).toEqual({ hits: 1, misses: 1 });
  });

  it("does not know a replaced node, so typing re-reads one block only", () => {
    const cache = createBlockCache();
    cache.sync("a");
    const nodes = Array.from({ length: 1000 }, () => ({}));
    for (const n of nodes) cache.set(n, style);
    nodes[500] = {}; // the edited paragraph is a new node
    cache.stats.hits = cache.stats.misses = 0;
    for (const n of nodes) if (!cache.get(n)) cache.set(n, style);
    expect(cache.stats).toEqual({ hits: 999, misses: 1 });
  });

  it("is dropped when the layout key changes (font, template, trim)", () => {
    const cache = createBlockCache();
    expect(cache.sync("a")).toBe(true);
    const node = {};
    cache.set(node, style);
    expect(cache.sync("a")).toBe(false);
    expect(cache.get(node)).toBe(style);
    expect(cache.sync("b")).toBe(true);
    expect(cache.get(node)).toBeUndefined();
  });
});
