import type { EditorView } from "@tiptap/pm/view";
import type { BlockCache } from "./cache";
import { PAGE_GAP, layoutPages, type PageLayoutResult } from "./core";
import { findSplitPos, measureFlow } from "./dom";
import { forcedBreaks } from "./forced";
import type { PageConfig } from "./plugin";

/** The layout of one pagination run, and what the decorations need from the DOM it was measured in. */
export interface LayoutRun {
  result: PageLayoutResult;
  /** Document position of each split inside a block, by `block:linesBefore`. */
  splits: Map<string, number | null>;
  hyphenate: boolean;
}

/**
 * Measures the flow (the caller has taken the spacers out of it) and lays the pages out from the measurements, with Typst's breaks
 * when its marks fit this text. Reads the DOM only.
 */
export function measureAndLayout(v: EditorView, c: PageConfig, cache: BlockCache): LayoutRun {
  const g = c.geometry;
  const splits = new Map<string, number | null>();
  const exactPos = new Map<string, number>();
  const blocks = measureFlow(v, c.zoom, g.margins.top, cache);
  const starts: number[] = [];
  v.state.doc.forEach((_n, offset) => starts.push(offset));
  // Typst's breaks, when its marks fit this text: pages are then the PDF's, to the word.
  const forced = c.exact ? forcedBreaks(v, c, blocks, exactPos) : undefined;
  const result = layoutPages({
    blocks,
    page: { h: g.page.h },
    margins: g.margins,
    // Typst's page may hold a line more or less than the webview's wrapping makes of it: a line of leeway before a card grows.
    textHeight:
      g.text.h +
      c.slackPx +
      (forced ? (blocks.find((b) => b.kind === "paragraph")?.lineHeight ?? 0) : 0),
    ...(forced ? { forced } : {}),
    gap: PAGE_GAP,
    firstPage: c.firstPage,
    startsOn: c.startsOn,
    opensChapter: c.opensChapter,
    blankBefore: c.blankBefore,
  });
  const hyphenate = getComputedStyle(v.dom).hyphens === "auto";
  for (const gap of result.gaps)
    if (gap.linesBefore > 0)
      splits.set(
        `${gap.block}:${gap.linesBefore}`,
        exactPos.get(`${gap.block}:${gap.linesBefore}`) ??
          findSplitPos(
            v,
            {
              blockPos: starts[gap.block]!,
              node: v.state.doc.child(gap.block),
              linesBefore: gap.linesBefore,
            },
            blocks[gap.block]!,
            c.zoom,
            g.margins.top,
          ),
      );
  return { result, splits, hyphenate };
}
