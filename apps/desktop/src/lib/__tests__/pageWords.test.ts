import { describe, expect, it } from "vitest";
import { alignWord } from "../pageWords";

const w = (s: string) => s.split(" ");

describe("alignWord", () => {
  const doc = w("The quiet harbour was grey and the tide came in slow over the quay again");

  it("is the word of the text under the click when page and text spell the same, after the running head", () => {
    const page = w("QUIET HARBOUR The quiet harbour was grey and the tide came in slow 12");
    // The page's word 4 is "harbour", the text's word 2.
    expect(alignWord(page, 4, doc)).toBe(2);
    expect(alignWord(page, 2, doc)).toBe(0);
    expect(alignWord(page, 12, doc)).toBe(10);
  });

  it("ignores punctuation, case, quotes and what only the PDF shows", () => {
    const page = w("“The quiet, harbour” — was GREY and the tide");
    expect(alignWord(page, 2, doc)).toBe(2);
    expect(alignWord(page, 5, doc)).toBe(4);
    expect(alignWord(page, 6, doc)).toBe(5);
    // A dash is no word.
    expect(alignWord(page, 3, doc)).toBeNull();
  });

  it("matches a word the PDF broke at a line end, or whose first letter is a drop cap, with its pieces", () => {
    const text = w("Once upon an international night");
    const page = w("O nce upon an interna- tional night");
    expect(alignWord(page, 0, text)).toBe(0);
    expect(alignWord(page, 1, text)).toBe(0);
    expect(alignWord(page, 4, text)).toBe(3);
    expect(alignWord(page, 5, text)).toBe(3);
    expect(alignWord(page, 6, text)).toBe(4);
  });

  it("skips words that only one side has: a table header repeated on the page, a footnote's text", () => {
    const page = w("one two three Name Age four five");
    expect(alignWord(page, 6, w("one two three four five six"))).toBe(4);
    // A click on what is not the text's gives no word.
    expect(alignWord(page, 3, w("one two three four five six"))).toBeNull();
    // Words of the text the page has no room for (before the next ones it does have).
    expect(alignWord(w("one two three four five"), 4, w("one two three skipped four five"))).toBe(
      5,
    );
  });

  it("is null when the page and the text do not line up", () => {
    expect(alignWord(w("a b c d"), 1, w("x y z"))).toBeNull();
    expect(alignWord(w("a b c"), 1, [])).toBeNull();
    // The click is before the text (the running head), past the end of the text, or in a place nothing lines up after.
    expect(alignWord(w("HEAD one two three"), 0, w("one two three"))).toBeNull();
    expect(alignWord(w("one two three four"), 3, w("one two three"))).toBeNull();
    expect(
      alignWord(
        w("one two three zzz1 zzz2 zzz3 zzz4 zzz5 zzz6 zzz7 zzz8 zzz9 end"),
        12,
        w("one two three end"),
      ),
    ).toBeNull();
    // A word that is only punctuation is no word.
    expect(alignWord(w("— ! ?"), 1, w("a"))).toBeNull();
  });

  it("does not run off the end of the page looking for the rest of a word", () => {
    expect(alignWord(w("one two thr"), 2, w("one two three"))).toBeNull();
  });

  it("matches the words of a right-to-left page, the letters of an Arabic ligature in the order pdf.js gives them, and a drop cap's pieces", () => {
    const text = w("الملف في الكلمات لاختبار أخرى");
    // pdf.js: lam-alef glyphs come out with their letters in another order.
    const page = w("امللف يف الكلمات الختبار أخرى");
    expect(alignWord(page, 3, text)).toBe(3);
    expect(alignWord(page, 1, text)).toBe(1);
    // The drop cap is the first letter of the first word, in a run of its own.
    expect(alignWord(w("ש לום עולם זהו"), 1, w("שלום עולם זהו"))).toBe(0);
    expect(alignWord(w("ש לום עולם זהו"), 3, w("שלום עולם זהו"))).toBe(2);
    // A word that is not a start of the text's word is not its piece.
    expect(alignWord(w("ת לום עולם זהו"), 1, w("שלום עולם זהו"))).toBeNull();
  });
});
