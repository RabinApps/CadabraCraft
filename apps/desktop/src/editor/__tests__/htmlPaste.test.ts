import { describe, expect, it } from "vitest";
import { convertHtmlText, literalContent, pasteAction, truncate } from "../htmlPaste";

const base = { text: "<p>The gate was <b>old</b></p>", hasHtml: false, inCode: false, pref: "ask" as const };

describe("pasteAction", () => {
  it("asks, converts or leaves it by preference", () => {
    expect(pasteAction(base)).toBe("ask");
    expect(pasteAction({ ...base, pref: "convert" })).toBe("convert");
    expect(pasteAction({ ...base, pref: "text" })).toBe("default");
  });
  it("leaves real HTML clipboards, code, plain prose and empty text alone", () => {
    expect(pasteAction({ ...base, hasHtml: true })).toBe("default");
    expect(pasteAction({ ...base, inCode: true })).toBe("default");
    expect(pasteAction({ ...base, text: "a < b and c > d" })).toBe("default");
    expect(pasteAction({ ...base, text: "" })).toBe("default");
  });
});

describe("truncate", () => {
  it("flattens whitespace and cuts with an ellipsis", () => {
    expect(truncate("a\n  b")).toBe("a b");
    expect(truncate("x".repeat(130))).toBe(`${"x".repeat(120)}…`);
    expect(truncate("x".repeat(120))).toBe("x".repeat(120));
  });
});

describe("convertHtmlText", () => {
  it("returns inline content for a single paragraph", () => {
    const c = convertHtmlText("<p>The gate was <b>old</b></p>");
    expect(c.content.map((n) => n.type)).toEqual(["text", "text"]);
    expect((c.content[1] as { marks?: unknown }).marks).toEqual([{ type: "bold" }]);
    expect(c.preview).toBe("The gate was old");
    expect(c.warnings).toBe(0);
  });
  it("returns blocks for several", () => {
    const c = convertHtmlText("<h2>Title</h2><p>Body</p>");
    expect(c.content.map((n) => n.type)).toEqual(["heading", "paragraph"]);
    expect(c.preview).toBe("Title Body");
  });
  it("counts warnings", () => {
    expect(convertHtmlText('<p>x</p><img src="https://e.com/a.png">').warnings).toBeGreaterThan(0);
  });
});

describe("literalContent", () => {
  it("keeps tags as text, one paragraph per line", () => {
    expect(literalContent("<b>x</b>")).toEqual([{ type: "text", text: "<b>x</b>" }]);
    expect(literalContent("<p>a</p>\n\n<p>b</p>")).toHaveLength(2);
  });
});
