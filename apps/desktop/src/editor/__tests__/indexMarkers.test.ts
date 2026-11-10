import { describe, expect, it } from "vitest";
import { EditorState } from "@tiptap/pm/state";
import type { Plugin } from "@tiptap/pm/state";
import type { GlossaryEntry } from "@cadabracraft/shared";
import { editorSchema } from "@cadabracraft/editor-schema";
import { IndexMarkers, markersKey, type MarkerLabels } from "../indexing/markers";

const labels: MarkerLabels = {
  index: (term, sub, see, seeAlso) => [term, sub, see, seeAlso].join("|"),
  glossary: (entry) => `G:${entry?.term ?? "gone"}`,
};

const orb: GlossaryEntry = { id: "g1", term: "Orb", definition: "A sphere" };

function stateWith(entries: GlossaryEntry[]) {
  const schema = editorSchema();
  const ext = IndexMarkers(() => new Map(entries.map((e) => [e.id, e])), labels);
  const plugins = (ext.config.addProseMirrorPlugins as () => Plugin[]).call({});
  const idx = schema.marks.indexEntry!.create({ id: "i1", term: "Magic", sub: "spells" });
  const idx2 = schema.marks.indexEntry!.create({
    id: "i2",
    term: "Orb",
    see: "Sphere",
    seeAlso: "Ball",
  });
  const gl = schema.marks.glossaryTerm!.create({ id: "g1" });
  const lost = schema.marks.glossaryTerm!.create({ id: "nope" });
  const bold = schema.marks.bold!.create();
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, [
      schema.text("plain "),
      schema.text("one", [idx, gl]),
      schema.text(" two", [idx2, bold]),
      schema.text(" three", [lost]),
    ]),
  ]);
  return EditorState.create({ doc, plugins });
}

const titles = (state: EditorState): string[] =>
  (markersKey.getState(state)!.find() as unknown as { type: { attrs: { title: string } } }[]).map(
    (d) => d.type.attrs.title,
  );

describe("IndexMarkers", () => {
  it("gives each marked text a tooltip and leaves plain text alone", () => {
    expect(titles(stateWith([orb]))).toEqual([
      "Magic|spells||\nG:Orb",
      "Orb||Sphere|Ball",
      "G:gone",
    ]);
  });

  it("redraws on a document change or a meta flag, and keeps the set otherwise", () => {
    const state = stateWith([orb]);
    const same = state.apply(state.tr.setMeta("other", true));
    expect(markersKey.getState(same)).toBe(markersKey.getState(state));
    const redrawn = state.apply(state.tr.setMeta(markersKey, true));
    expect(markersKey.getState(redrawn)).not.toBe(markersKey.getState(state));
    const edited = state.apply(state.tr.insertText("x", 1));
    expect(titles(edited).length).toBe(3);
  });
});

describe("appIndexMarkers", () => {
  it("words the tooltips from the open book's glossary", async () => {
    const { appIndexMarkers } = await import("../indexing/appMarkers");
    const { useProject } = await import("../../state/project/index");
    const schema = editorSchema();
    const make = (entries: GlossaryEntry[]) => {
      useProject.setState({
        manifest: { glossary: { entries } },
      } as unknown as ReturnType<typeof useProject.getState>);
      const plugins = (appIndexMarkers().config.addProseMirrorPlugins as () => Plugin[]).call({});
      const marks = [
        schema.marks.indexEntry!.create({
          id: "a",
          term: "Magic",
          sub: "spells",
          see: "S",
          seeAlso: "T",
        }),
        schema.marks.glossaryTerm!.create({ id: "g1" }),
        schema.marks.glossaryTerm!.create({ id: "zz" }),
      ];
      const doc = schema.node("doc", null, [
        schema.node(
          "paragraph",
          null,
          marks.map((m, i) => schema.text(`w${i}`, [m])),
        ),
      ]);
      return titles(EditorState.create({ doc, plugins }));
    };
    const withDef = make([orb]);
    expect(withDef[0]).toContain("Magic, spells");
    expect(withDef[1]).toContain("A sphere");
    expect(make([{ id: "g1", term: "Orb", definition: "" }])[1]).toContain("Orb");
    expect(withDef.length).toBe(3);
  });
});
