import { describe, expect, it } from "vitest";
import { getSchema, type Editor, type JSONContent } from "@tiptap/core";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import {
  convertSelection,
  editorSchema,
  extensions,
  SmartTypography,
  type SmartTypographyOptions,
} from "../index";
import { typographyRules } from "../typography/rules";

const schema = editorSchema();
const text = (t: string, marks: JSONContent["marks"] = []): JSONContent => ({
  type: "text",
  text: t,
  ...(marks.length ? { marks } : {}),
});
const para = (...content: JSONContent[]): JSONContent => ({ type: "paragraph", content });
const docOf = (...blocks: JSONContent[]) => schema.nodeFromJSON({ type: "doc", content: blocks });

const on: SmartTypographyOptions = { enabled: () => true, language: () => "en" };

/**
 * Types `typed` after `before` the way TipTap does: the key is inserted first, then the first rule whose pattern
 * matches the text before the caret runs. Returns the paragraph text afterwards (null when no rule changed anything).
 */
function type(
  before: JSONContent[],
  typed: string,
  options: SmartTypographyOptions = on,
  extra: JSONContent[] = [],
  typedMarks: JSONContent["marks"] = [],
): string | null {
  const parts = before.filter((n) => n.text !== "");
  const beforeDoc = docOf(para(text("x"), ...parts));
  // The paragraph starts with a sentinel only so it is never empty; positions are counted without it.
  const at = beforeDoc.firstChild!.content.size;
  const doc = docOf(para(...parts, text(typed, typedMarks), ...extra));
  const textBefore = beforeDoc.firstChild!.textContent.slice(1) + typed;
  for (const rule of typographyRules(options)) {
    const match = (rule.find as RegExp).exec(textBefore);
    if (!match) continue;
    const state = EditorState.create({ doc });
    const tr = state.tr;
    const range = { from: at - (match[0].length - typed.length), to: at + typed.length };
    const result = rule.handler({
      state: { doc: tr.doc, tr } as never,
      range,
      match,
      commands: {} as never,
      chain: {} as never,
      can: {} as never,
    });
    if (result === null || !tr.steps.length) return null;
    return tr.doc.textContent;
  }
  return null;
}
const plain = (t: string, typed: string, options?: SmartTypographyOptions) =>
  type([text(t)], typed, options);

describe("typing rules", () => {
  it("opens and closes quotes", () => {
    expect(plain("", '"')).toBe("“");
    expect(plain("He said ", '"')).toBe("He said “");
    expect(plain("He said “hi,", '"')).toBe("He said “hi,”");
    expect(plain("a ", "'")).toBe("a ‘");
    expect(plain("it", "'")).toBe("it’");
  });
  it("keeps a prime after a digit", () => {
    expect(plain("5", "'")).toBe("5'");
    expect(plain("5'10", '"')).toBe("5'10\"");
  });
  it("makes the apostrophe of a leading elision", () => {
    expect(plain("a ‘tis", " ")).toBe("a ’tis ");
    expect(plain("a ‘Twas", ",")).toBe("a ’Twas,");
    expect(plain("in the ‘90", "s")).toBe("in the ’90s");
    expect(plain("a ‘tis", "t")).toBeNull();
  });
  it("turns -- into an en dash and a third hyphen into an em dash", () => {
    expect(plain("a-", "-")).toBe("a–");
    expect(plain("a–", "-")).toBe("a—");
    expect(plain("a", "-")).toBeNull();
  });
  it("turns three dots into an ellipsis", () => {
    expect(plain("wait..", ".")).toBe("wait…");
    expect(plain("wait.", ".")).toBeNull();
  });
  it("uses the language of the edition, and the lang mark at the caret over it", () => {
    const de: SmartTypographyOptions = { enabled: () => true, language: () => "de" };
    expect(plain("", '"', de)).toBe("„");
    const fr = { type: "lang", attrs: { lang: "fr" } };
    // Inside a passage in French the caret has the mark (the typed key joins it)...
    const inside = type([text("Say "), text("ça ", [fr])], '"', de, [text("fin", [fr])], [fr]);
    expect(inside).toBe("Say ça \u00ab\u202ffin");
    // ...but right after it the mark does not extend (it is not inclusive), so the edition language rules.
    expect(type([text("Say "), text("ça", [fr])], '"', de)).toBe("Say ça“");
  });
  it("opens after a hard break and closes after a footnote", () => {
    const hardBreak: JSONContent = { type: "hardBreak" };
    expect(type([text("a"), hardBreak], '"')).toBe("a“");
    const note: JSONContent = { type: "footnote", content: [text("n")] };
    expect(type([text("a"), note], '"')).toBe("an”");
  });
  it("leaves code alone, also the first key typed with the code mark switched on", () => {
    const code = [{ type: "code" }];
    expect(type([], '"', on, [], code)).toBeNull();
    expect(type([text("a-", code)], "-", on, [], code)).toBeNull();
    expect(type([text("wait..", code)], ".", on, [], code)).toBeNull();
    expect(type([text("a ")], '"', on, [], code)).toBeNull();
    // Text after code is converted again.
    expect(type([text("a", code), text(" ")], '"')).toBe("a “");
  });
  it("does nothing while the setting is off", () => {
    const off = { enabled: () => false, language: () => "en" };
    for (const [before, typed] of [
      ["", '"'],
      ["a-", "-"],
      ["a–", "-"],
      ["wait..", "."],
      ["a ‘tis", " "],
      ["in the ‘90", "s"],
    ] as const)
      expect(plain(before, typed, off)).toBeNull();
  });
  it("makes every rule undoable (Backspace restores the typed character)", () => {
    for (const rule of typographyRules(on)) expect(rule.undoable).not.toBe(false);
  });
});

describe("SmartTypography extension", () => {
  const config = SmartTypography as unknown as {
    config: {
      name: string;
      addOptions: () => SmartTypographyOptions;
      addInputRules: (this: { options: SmartTypographyOptions }) => unknown[];
    };
  };
  it("is off the shared extension list and adds no schema", () => {
    expect(extensions).not.toContain(SmartTypography);
    expect(Object.keys(getSchema([...extensions, SmartTypography]).nodes)).toEqual(
      Object.keys(schema.nodes),
    );
  });
  it("defaults to on and English, and builds the rules from its options", () => {
    expect(config.config.name).toBe("smartTypography");
    const options = config.config.addOptions();
    expect(options.enabled()).toBe(true);
    expect(options.language()).toBe("en");
    expect(config.config.addInputRules.call({ options })).toHaveLength(typographyRules(on).length);
  });
});

/** An editor with just what `convertSelection` uses: state, a dispatch that applies the transaction, the extension list. */
function fakeEditor(doc: ReturnType<typeof docOf>, from: number, to: number, language?: string) {
  let state = EditorState.create({ doc });
  state = state.apply(state.tr.setSelection(TextSelection.create(doc, from, to)));
  const editor = {
    get state() {
      return state;
    },
    view: { dispatch: (tr: typeof state.tr) => (state = state.apply(tr)) },
    extensionManager: {
      extensions: language
        ? [{ name: "other" }, { name: "smartTypography", options: { language: () => language } }]
        : [{ name: "other" }],
    },
  };
  return {
    editor: editor as unknown as Editor,
    get doc() {
      return state.doc;
    },
  };
}

describe("convertSelection", () => {
  it("converts the selected text only, in one transaction", () => {
    const d = docOf(para(text('"a" -- "b"')), para(text('"outside"')));
    const f = fakeEditor(d, 1, 11);
    expect(convertSelection(f.editor)).toBe(true);
    expect(f.doc.child(0).textContent).toBe("“a” – “b”");
    expect(f.doc.child(1).textContent).toBe('"outside"');
  });
  it("does nothing for an empty selection or text that is already typographic", () => {
    const d = docOf(para(text("“a”")));
    expect(convertSelection(fakeEditor(d, 2, 2).editor)).toBe(false);
    expect(convertSelection(fakeEditor(d, 1, 4).editor)).toBe(false);
  });
  it("skips code and passages in another language, and keeps the marks", () => {
    const code = { type: "code" };
    const lang = { type: "lang", attrs: { lang: "fr" } };
    const bold = { type: "bold" };
    const d = docOf(
      para(text('"a" '), text('"code"', [code]), text(' "x"', [lang]), text(' "b"', [bold])),
      { type: "codeBlock", content: [text('"block"')] },
    );
    const f = fakeEditor(d, 1, d.content.size - 1);
    expect(convertSelection(f.editor)).toBe(true);
    expect(f.doc.child(0).textContent).toBe('“a” "code" "x" “b”');
    expect(f.doc.child(0).lastChild!.marks.map((m) => m.type.name)).toEqual(["bold"]);
    expect(f.doc.child(1).textContent).toBe('"block"');
  });
  it("uses the typography extension's language, an explicit one, or English", () => {
    const d = docOf(para(text('"a"')));
    const viaExtension = fakeEditor(d, 1, 4, "de");
    convertSelection(viaExtension.editor);
    expect(viaExtension.doc.textContent).toBe("„a“");
    const explicit = fakeEditor(d, 1, 4, "de");
    convertSelection(explicit.editor, "fr");
    expect(explicit.doc.textContent).toBe("« a »");
    const none = fakeEditor(d, 1, 4);
    convertSelection(none.editor);
    expect(none.doc.textContent).toBe("“a”");
  });
  it("uses the text around a partial selection to decide", () => {
    const d = docOf(para(text('say "hi" now')));
    const f = fakeEditor(d, 5, 9);
    convertSelection(f.editor);
    expect(f.doc.textContent).toBe("say “hi” now");
  });
});
