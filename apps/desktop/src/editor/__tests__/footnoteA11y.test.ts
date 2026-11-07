import { describe, expect, it, vi } from "vitest";
import { getSchema } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Plugin } from "@tiptap/pm/state";
import { extensions } from "@cadabracraft/editor-schema";
import { FootnoteA11y, footnoteDecorations } from "../footnoteA11y";

const schema = getSchema(extensions);

const note = (text?: string) => ({
  type: "footnote",
  ...(text === undefined ? {} : { content: [{ type: "text", text }] }),
});
const p = (...content: unknown[]) => ({ type: "paragraph", content });
const t = (text: string) => ({ type: "text", text });

const docOf = (...content: unknown[]): PMNode => schema.nodeFromJSON({ type: "doc", content });

const label = (n: number) => `Footnote ${n}`;

// Decoration.node keeps its DOM attributes on the decoration's (internal) type; that is where the role and name end up.
const attrs = (set: { find: () => unknown[] }) =>
  (set.find() as { type: { attrs: Record<string, string> } }[]).map((d) => d.type.attrs);

describe("footnoteDecorations", () => {
  it("numbers the footnotes from the start of the chapter and names each one", () => {
    const doc = docOf(
      p(t("one"), note("a note"), t(" two")),
      { type: "heading", attrs: { level: 2 }, content: [t("head")] },
      p(note(), note("another")),
    );
    const set = footnoteDecorations(doc, label);
    expect(attrs(set)).toEqual([
      { role: "note", "aria-label": "Footnote 1" },
      { role: "note", "aria-label": "Footnote 2" },
      { role: "note", "aria-label": "Footnote 3" },
    ]);
    expect(set.find().every((d) => d.from < d.to)).toBe(true);
  });

  it("adds nothing when the chapter has no footnotes", () => {
    expect(footnoteDecorations(docOf(p(t("plain"))), label).find()).toEqual([]);
  });

  it("takes the label from the caller's function, one call per footnote", () => {
    const called = vi.fn((n: number) => `Note ${n}`);
    footnoteDecorations(docOf(p(note(), note())), called).find();
    expect(called.mock.calls.map(([n]) => n)).toEqual([1, 2]);
  });
});

describe("FootnoteA11y", () => {
  it("decorates the live document through its plugin", () => {
    const called = vi.fn((n: number) => `Footnote ${n}`);
    const build = FootnoteA11y(called).config.addProseMirrorPlugins as unknown as (this: {
      editor: unknown;
    }) => Plugin[];
    const plugin = build.call({ editor: {} })[0]!;
    const doc = docOf(p(t("one"), note("a note")));
    const set = plugin.props.decorations!.call(plugin, { doc } as never) as unknown as {
      find: () => unknown[];
    };
    expect(attrs(set)).toEqual([{ role: "note", "aria-label": "Footnote 1" }]);
    expect(called).toHaveBeenCalledWith(1);
  });
});
