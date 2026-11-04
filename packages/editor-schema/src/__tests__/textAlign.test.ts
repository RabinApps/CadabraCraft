import { describe, expect, it } from "vitest";
import { getSchema, type Editor } from "@tiptap/core";
import {
  alignOfElement,
  chapterDocProblem,
  chapterJson,
  EDITOR_KEY_COMMANDS,
  extensions,
  TextAlignment,
  textAlignAt,
} from "../index";

type Attr = {
  default: null;
  parseHTML: (el: HTMLElement) => string | null;
  renderHTML: (a: Record<string, unknown>) => Record<string, string>;
};
const config = TextAlignment as unknown as {
  config: {
    addGlobalAttributes: () => { types: string[]; attributes: { textAlign: Attr } }[];
    addCommands: () => {
      setTextAlign: (a: string | null) => (p: { commands: unknown }) => boolean;
    };
    addKeyboardShortcuts: (this: unknown) => Record<string, () => boolean>;
  };
};

const el = (attrs: Record<string, string>, textAlign = ""): HTMLElement =>
  ({
    getAttribute: (n: string) => attrs[n] ?? null,
    style: { textAlign },
  }) as unknown as HTMLElement;

const doc = (attrs?: Record<string, unknown>) => ({
  type: "doc",
  content: [
    { type: "paragraph", ...(attrs ? { attrs } : {}), content: [{ type: "text", text: "x" }] },
  ],
});

describe("textAlign attribute", () => {
  it("is on paragraphs and headings, absent by default, and nowhere else", () => {
    const schema = getSchema(extensions);
    expect(schema.nodes.paragraph!.spec.attrs).toHaveProperty("textAlign");
    expect(schema.nodes.heading!.spec.attrs).toHaveProperty("textAlign");
    expect(schema.nodes.codeBlock!.spec.attrs).not.toHaveProperty("textAlign");
    expect(schema.nodes.definitionTerm!.spec.attrs).toBeUndefined();
    expect(schema.nodes.paragraph!.create().attrs.textAlign).toBeNull();
  });

  it("is written as data-text-align and read back", () => {
    const { types, attributes } = config.config.addGlobalAttributes()[0]!;
    expect(types).toEqual(["paragraph", "heading"]);
    const a = attributes.textAlign;
    expect(a.default).toBeNull();
    expect(a.renderHTML({ textAlign: "center" })).toEqual({ "data-text-align": "center" });
    expect(a.renderHTML({ textAlign: null })).toEqual({});
    expect(a.parseHTML(el({ "data-text-align": "end" }))).toBe("end");
  });

  it("reads the alignment other editors write: text-align, the align attribute, left and right as start and end", () => {
    expect(alignOfElement(el({}, "center"))).toBe("center");
    expect(alignOfElement(el({}, "left"))).toBe("start");
    expect(alignOfElement(el({}, "START"))).toBe("start");
    expect(alignOfElement(el({}, "right"))).toBe("end");
    expect(alignOfElement(el({}, "end"))).toBe("end");
    expect(alignOfElement(el({ align: "Center" }))).toBe("center");
    expect(alignOfElement(el({ align: "right" }))).toBe("end");
    expect(alignOfElement(el({}, "justify"))).toBeNull();
    expect(alignOfElement(el({ "data-text-align": "justify" }))).toBeNull();
    expect(alignOfElement(el({}))).toBeNull();
    expect(alignOfElement({ getAttribute: () => null } as unknown as HTMLElement)).toBeNull();
  });

  it("is a valid chapter and refuses any other value", () => {
    for (const v of ["start", "center", "end"])
      expect(chapterDocProblem(doc({ textAlign: v }))).toBeNull();
    expect(chapterDocProblem(doc({ textAlign: null }))).toBeNull();
    expect(chapterDocProblem(doc())).toBeNull();
    expect(chapterDocProblem(doc({ textAlign: "justify" }))).toMatch(/not allowed/);
    const heading = {
      type: "doc",
      content: [{ type: "heading", attrs: { level: 1, textAlign: "left" }, content: [] }],
    };
    expect(chapterDocProblem(heading)).toMatch(/"left" is not allowed/);
  });

  it("sets the alignment on paragraphs and headings through updateAttributes", () => {
    const calls: unknown[] = [];
    const commands = {
      updateAttributes: (type: string, attrs: unknown) => {
        calls.push([type, attrs]);
        return type !== "refuse";
      },
    };
    const run = config.config.addCommands().setTextAlign("center");
    expect(run({ commands })).toBe(true);
    expect(calls).toEqual([
      ["paragraph", { textAlign: "center" }],
      ["heading", { textAlign: "center" }],
    ]);
    expect(config.config.addCommands().setTextAlign(null)({ commands })).toBe(true);
    expect(calls.at(-1)).toEqual(["heading", { textAlign: null }]);
  });

  // Mod-Shift-E is Print PDF in the menu, and a menu accelerator wins the key. Mod-Shift-C is free (Cmd/Ctrl+Shift+C).
  it("answers Mod-Shift-L, C and R (and their Caps Lock twins) with start, center and end", () => {
    const calls: string[] = [];
    const editor = {
      commands: { setTextAlign: (a: string) => (calls.push(a), true) },
    };
    const keys = config.config.addKeyboardShortcuts.call({ editor });
    expect(Object.keys(keys).sort()).toEqual(
      [
        "Mod-Shift-C",
        "Mod-Shift-L",
        "Mod-Shift-R",
        "Mod-Shift-c",
        "Mod-Shift-l",
        "Mod-Shift-r",
      ].sort(),
    );
    keys["Mod-Shift-l"]!();
    keys["Mod-Shift-C"]!();
    keys["Mod-Shift-r"]!();
    expect(calls).toEqual(["start", "center", "end"]);
    expect(EDITOR_KEY_COMMANDS["editor.alignLeft"]!.key).toBe("Mod-Shift-l");
  });

  it("tells the alignment of the block the selection starts in", () => {
    const at = (textAlign: unknown) =>
      textAlignAt({
        state: { selection: { $from: { parent: { attrs: { textAlign } } } } },
      } as unknown as Editor);
    expect(at("center")).toBe("center");
    expect(at(null)).toBeNull();
    expect(at(undefined)).toBeNull();
    expect(at("justify")).toBeNull();
  });

  it("keeps null alignments and empty attrs out of the JSON that goes to disk", () => {
    const json = {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "a" }] },
        { type: "paragraph", attrs: { textAlign: "end" }, content: [{ type: "text", text: "b" }] },
        { type: "heading", attrs: { level: 2, textAlign: null }, content: [] },
        { type: "paragraph" },
        { type: "sceneBreak" },
      ],
    };
    expect(chapterJson({ getJSON: () => json } as unknown as Editor)).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a" }] },
        { type: "paragraph", attrs: { textAlign: "end" }, content: [{ type: "text", text: "b" }] },
        { type: "heading", attrs: { level: 2 }, content: [] },
        { type: "paragraph" },
        { type: "sceneBreak" },
      ],
    });
  });
});
