import { describe, expect, it } from "vitest";
import { cleanPastedHtml, cleanPastedText } from "../pasteClean";

describe("cleanPastedText", () => {
  it("turns Word's vertical tab and form feed into a line break and drops other control characters", () => {
    expect(cleanPastedText("a\u000bb\u000cc")).toBe("a\nb\nc");
    expect(cleanPastedText("a\u0000b\u0001c\u007fd﻿e")).toBe("abcde");
  });
  it("keeps tab, line feed, carriage return, NBSP, zero-width characters and emoji", () => {
    const s = "a\tb\nc\rd e​f‍g\u{1F600}";
    expect(cleanPastedText(s)).toBe(s);
  });
});

describe("cleanPastedHtml", () => {
  it("drops pictures from the web and inline data, and counts them", () => {
    const r = cleanPastedHtml(
      '<p>a<img src="https://x.test/p.png" alt="p">b<IMG SRC=\'data:image/png;base64,AAAA\'>c<img alt="n" src=pic.png></p>',
    );
    expect(r.html).toBe("<p>abc</p>");
    expect(r.droppedImages).toBe(3);
  });
  it("keeps the book's own pictures", () => {
    const html = '<p><img src="assets/one.png"><img src="./assets/two.png" alt="2"></p>';
    expect(cleanPastedHtml(html)).toEqual({ html, droppedImages: 0 });
  });
  it("drops a picture without a source, and cleans control characters in the rest", () => {
    const r = cleanPastedHtml("<p>a\u000bb<img></p>");
    expect(r).toEqual({ html: "<p>a\nb</p>", droppedImages: 1 });
  });
});
