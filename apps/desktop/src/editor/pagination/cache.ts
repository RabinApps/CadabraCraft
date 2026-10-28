/** What reading a block's computed style costs, kept per ProseMirror node (nodes are immutable, so a node that has not changed has the same style). */
export interface BlockStyle {
  marginTop: number;
  marginBottom: number;
  /** CSS line height of the block's text, in px. */
  lineHeight: number;
  /** Text blocks inside the block (1 for a paragraph). */
  textBlocks: number;
}

/**
 * Block style cache keyed by node identity. Typing replaces one paragraph's node, so only that block's style is read again; the cache
 * is dropped whenever the layout key changes (template, trim size, font, anything the CSS depends on).
 */
export function createBlockCache() {
  let key = "";
  let map = new WeakMap<object, BlockStyle>();
  const stats = { hits: 0, misses: 0 };
  return {
    stats,
    /** Drops everything when `layoutKey` differs from the last call; returns whether it did. */
    sync(layoutKey: string): boolean {
      if (layoutKey === key) return false;
      key = layoutKey;
      map = new WeakMap();
      return true;
    },
    get(node: object): BlockStyle | undefined {
      const hit = map.get(node);
      if (hit) stats.hits++;
      else stats.misses++;
      return hit;
    },
    set(node: object, style: BlockStyle): void {
      map.set(node, style);
    },
  };
}
export type BlockCache = ReturnType<typeof createBlockCache>;
