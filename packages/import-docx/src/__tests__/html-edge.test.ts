import { describe, expect, it } from "vitest";
import { ImportError, htmlToBlocks, importHtml } from "..";
import { guarded } from "../html/guards";

const errorOf = (fn: () => unknown): ImportError => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ImportError);
    return e as ImportError;
  }
  throw new Error("expected an ImportError");
};

describe("guarded import steps", () => {
  it("returns the step's value and rethrows an ImportError unchanged", () => {
    expect(guarded(() => 42)).toBe(42);
    const original = new ImportError("input-too-large", "big");
    expect(
      errorOf(() =>
        guarded(() => {
          throw original;
        }),
      ),
    ).toBe(original);
  });

  it("maps a stack overflow to too-deeply-nested and anything else to invalid-xml", () => {
    expect(
      errorOf(() =>
        guarded(() => {
          throw new RangeError("Maximum call stack size exceeded");
        }),
      ).code,
    ).toBe("too-deeply-nested");
    const failed = errorOf(() =>
      guarded(() => {
        throw new Error("x".repeat(500));
      }),
    );
    expect(failed.code).toBe("invalid-xml");
    expect(failed.message.length).toBeLessThan(260);
    expect(
      errorOf(() =>
        guarded(() => {
          throw "just a string";
        }),
      ).message,
    ).toContain("unknown error");
  });
});

describe("html conversion edge cases", () => {
  it("drops text that is empty once control characters are removed", () => {
    const { blocks } = htmlToBlocks("<p>a<b>\u0001</b>b</p>");
    expect(JSON.stringify(blocks)).toContain('"text":"ab"');
  });

  it("flattens lists beyond the nesting limit, with or without text", () => {
    const r = htmlToBlocks("<ul><li>deep text</li></ul><ol></ol><ul></ul>", {
      maxNestingDepth: 0,
    });
    expect(r.warnings.map((w) => w.code)).toContain("nesting-too-deep");
    expect(JSON.stringify(r.blocks)).toContain("deep text");
    expect(r.blocks).toHaveLength(1);
  });

  it("keeps the start of ordered lists only when it is a real number other than 1", () => {
    const start = (html: string) =>
      (htmlToBlocks(html).blocks[0] as { attrs?: { start?: number } }).attrs?.start;
    expect(start("<ol><li>a</li></ol>")).toBeUndefined();
    expect(start('<ol start="1"><li>a</li></ol>')).toBeUndefined();
    expect(start('<ol start="x"><li>a</li></ol>')).toBeUndefined();
    expect(start('<ol start="4"><li>a</li></ol>')).toBe(4);
  });

  it("reads table rows from the table body and ignores text between them", () => {
    const r = htmlToBlocks("<table>stray<tr><td>a</td></tr></table>");
    expect(JSON.stringify(r.blocks)).toContain('"text":"a"');
  });

  it("imports a document whose body is empty", () => {
    expect(importHtml("").chapters).toEqual([]);
  });
});
