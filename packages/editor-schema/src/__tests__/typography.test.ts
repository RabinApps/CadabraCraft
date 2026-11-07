import { describe, expect, it } from "vitest";
import { APOSTROPHE, convertText, decide, quoteStyle, type QuoteKey } from "../typography";
import { ELISION_WORDS, startsWithElision } from "../typography/elision";

const en = quoteStyle("en");

describe("quoteStyle", () => {
  it("has the English curly pairs", () => {
    expect(en).toEqual({ open: "“", close: "”", openSingle: "‘", closeSingle: "’" });
    expect(APOSTROPHE).toBe("’");
  });
  it("knows German, French, Spanish and Italian", () => {
    expect(quoteStyle("de")).toMatchObject({
      open: "„",
      close: "“",
      openSingle: "‚",
      closeSingle: "‘",
    });
    expect(quoteStyle("fr")).toMatchObject({ open: "« ", close: " »" });
    expect(quoteStyle("es")).toMatchObject({
      open: "«",
      close: "»",
      openSingle: "“",
      closeSingle: "”",
    });
    expect(quoteStyle("it")).toMatchObject({ open: "«", close: "»" });
  });
  it("uses the English pair for Hebrew, Arabic and languages without an entry", () => {
    for (const tag of ["he", "ar", "ar-EG", "ja", "xx", "", "123"])
      expect(quoteStyle(tag)).toEqual(en);
  });
  it("reads the tag case-insensitively and falls back to the language for an unknown region", () => {
    expect(quoteStyle("DE-at")).toEqual(quoteStyle("de"));
    expect(quoteStyle("fr_CA")).toEqual(quoteStyle("fr"));
  });
  it("has Swiss variants of German and French: guillemets without spaces", () => {
    for (const tag of ["de-CH", "fr-CH", "de-ch"]) {
      expect(quoteStyle(tag)).toEqual({ open: "«", close: "»", openSingle: "‹", closeSingle: "›" });
    }
  });
});

describe("decide", () => {
  const d = (prev: string, q: QuoteKey, rest?: string) => decide(prev, q, en, rest);
  it("opens at the start of a block, after whitespace, brackets, dashes and opening quotes", () => {
    for (const prev of ["", " ", "\n", " ", "(", "[", "{", "–", "—", "“", "‘", '"', "'"]) {
      expect(d(prev, '"')).toBe("“");
      expect(d(prev, "'")).toBe("‘");
    }
  });
  it("closes after letters and punctuation", () => {
    for (const prev of [".", ",", "!", "?", ")", "”", "…", "￼"]) {
      expect(d(prev, '"')).toBe("”");
      expect(d(prev, "'")).toBe("’");
    }
    expect(d("o", '"')).toBe("”");
  });
  it("keeps primes after a digit", () => {
    expect(d("5", "'")).toBe("'");
    expect(d("0", '"')).toBe('"');
    expect(d("٣", "'")).toBe("'");
  });
  it("makes an apostrophe after a letter while typing", () => {
    expect(d("n", "'")).toBe("’");
    expect(d("é", "'")).toBe("’");
  });
  it("tells a closing single quote from an apostrophe when the text after is known", () => {
    const de = quoteStyle("de");
    expect(decide("o", "'", de, " said")).toBe("‘");
    expect(decide("o", "'", de, "")).toBe("‘");
    expect(decide("n", "'", de, "t")).toBe("’");
    expect(decide("s", "'", en, " bones")).toBe("’");
  });
  it("opens with an apostrophe for a leading elision", () => {
    expect(d(" ", "'", "tis the season")).toBe("’");
    expect(d("", "'", "90s were")).toBe("’");
    expect(d(" ", "'", "Twas")).toBe("’");
    expect(d(" ", "'", "tisk")).toBe("‘");
    expect(d(" ", "'", "90 people")).toBe("‘");
    expect(d(" ", "'", "905s")).toBe("‘");
    expect(d(" ", "'")).toBe("‘");
  });
  it("lists the elision words", () => {
    for (const w of ELISION_WORDS) expect(startsWithElision(`${w} `)).toBe(true);
    expect(startsWithElision("hello")).toBe(false);
  });
  it("uses the style's own glyphs, also nested", () => {
    const fr = quoteStyle("fr");
    expect(decide("", '"', fr)).toBe("« ");
    expect(decide("a", '"', fr)).toBe(" »");
    expect(decide(" ", "'", fr)).toBe("“");
    const de = quoteStyle("de");
    expect(decide("‚", '"', de)).toBe("„");
    expect(decide("‘", '"', de)).toBe("“");
    expect(decide("", "'", de)).toBe("‚");
  });
});

describe("convertText", () => {
  const c = (s: string, tag = "en", ctx = {}) => convertText(s, quoteStyle(tag), ctx);
  it("converts quotes, apostrophes, dashes and ellipses", () => {
    expect(c("He said \"hello\" -- and left... It's 'fine'.")).toBe(
      "He said “hello” – and left… It’s ‘fine’.",
    );
    expect(c("a---b")).toBe("a—b");
    expect(c('"Hi," she said.')).toBe("“Hi,” she said.");
  });
  it("keeps primes, elisions and nested quotes", () => {
    expect(c("He is 5'10\" tall")).toBe("He is 5'10\" tall");
    expect(c("in the '90s, 'tis so")).toBe("in the ’90s, ’tis so");
    expect(c("\"She said 'go'.\"")).toBe("“She said ‘go’.”");
    expect(c("\"'a'\"")).toBe("“‘a’”");
  });
  it("is idempotent and leaves empty text alone", () => {
    const once = c("\"a\" -- 'b'...");
    expect(c(once)).toBe(once);
    expect(c("")).toBe("");
    expect(c("plain")).toBe("plain");
  });
  it("uses the language's marks", () => {
    expect(c("\"x\" 'y'", "de")).toBe("„x“ ‚y‘");
    expect(c('"x"', "fr")).toBe("« x »");
    expect(c("\"quoted 'in'\"", "es")).toBe("«quoted “in”»");
  });
  it("reads the character before and the text after from the context", () => {
    expect(c('"x"', "en", { before: "a" })).toBe("”x”");
    expect(c('"x"', "en", { before: " " })).toBe("“x”");
    expect(c("'", "en", { after: "tis" })).toBe("’");
    expect(c("'", "en", { before: "" })).toBe("‘");
  });
  it("looks at the whole previous character after an astral letter", () => {
    expect(c("𝒜's")).toBe("𝒜’s");
  });
});
