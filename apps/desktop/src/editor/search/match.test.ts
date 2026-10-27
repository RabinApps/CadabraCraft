import { describe, expect, it } from "vitest";
import { findInText } from "./match";

const base = { matchCase: false, wholeWord: false };
const find = (text: string, q: string, o: Partial<typeof base> = {}) => findInText(text, q, { ...base, ...o }).map((r) => text.slice(r.from, r.to));

describe("findInText", () => {
  it("finds nothing for an empty query", () => {
    expect(findInText("abc", "", base)).toEqual([]);
  });

  it("ignores case unless asked, and keeps offsets", () => {
    expect(findInText("Foo foo FOO", "foo", base)).toEqual([{ from: 0, to: 3 }, { from: 4, to: 7 }, { from: 8, to: 11 }]);
    expect(findInText("Foo foo FOO", "foo", { ...base, matchCase: true })).toEqual([{ from: 4, to: 7 }]);
  });

  it("treats accents and curly quotes literally", () => {
    expect(find("café cafe", "cafe")).toEqual(["cafe"]);
    expect(find("it’s it's", "it's")).toEqual(["it's"]);
    expect(find("ÉCOLE école", "école")).toEqual(["ÉCOLE", "école"]);
  });

  it("never interprets the query as a regex", () => {
    expect(find("a.c abc (x)", "a.c")).toEqual(["a.c"]);
    expect(find("(x) x", "(x)")).toEqual(["(x)"]);
  });

  it("finds non-overlapping matches left to right", () => {
    expect(findInText("aaa", "aa", base)).toEqual([{ from: 0, to: 2 }]);
    expect(findInText("aaaa", "aa", base)).toEqual([{ from: 0, to: 2 }, { from: 2, to: 4 }]);
  });

  it("matches whole words with Unicode boundaries", () => {
    const o = { wholeWord: true };
    expect(find("cat concat cat.", "cat", o)).toEqual(["cat", "cat"]);
    expect(find("écat cat é", "cat", o)).toEqual(["cat"]);
    expect(find("cat2 cat", "cat", o)).toEqual(["cat"]);
    expect(find("« cat »", "cat", o)).toEqual(["cat"]);
    expect(find("xaa aa", "aa", o)).toEqual(["aa"]);
  });

  it("skips a rejected whole-word candidate and still finds a later one", () => {
    expect(find("aaa aa", "aa", { wholeWord: true })).toEqual(["aa"]);
  });

  it("folds case without changing length for characters like İ", () => {
    expect(findInText("İx x", "x", base)).toEqual([{ from: 1, to: 2 }, { from: 3, to: 4 }]);
  });
});
