import { describe, expect, it } from "vitest";
import { compileRegex, expandReplacement, findInText, isInvalidRegex, MAX_MATCHES } from "../match";

const base = { matchCase: false, wholeWord: false };
const find = (text: string, q: string, o: Partial<typeof base> = {}) =>
  findInText(text, q, { ...base, ...o }).map((r) => text.slice(r.from, r.to));

describe("findInText", () => {
  it("finds nothing for an empty query", () => {
    expect(findInText("abc", "", base)).toEqual([]);
  });

  it("ignores case unless asked, and keeps offsets", () => {
    expect(findInText("Foo foo FOO", "foo", base)).toEqual([
      { from: 0, to: 3 },
      { from: 4, to: 7 },
      { from: 8, to: 11 },
    ]);
    expect(findInText("Foo foo FOO", "foo", { ...base, matchCase: true })).toEqual([
      { from: 4, to: 7 },
    ]);
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
    expect(findInText("aaaa", "aa", base)).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 4 },
    ]);
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
    expect(findInText("İx x", "x", base)).toEqual([
      { from: 1, to: 2 },
      { from: 3, to: 4 },
    ]);
  });
});

describe("findInText with regex", () => {
  const rx = { matchCase: false, wholeWord: false, regex: true };
  const found = (text: string, q: string, o: Partial<typeof rx> = {}) =>
    findInText(text, q, { ...rx, ...o });
  const words = (text: string, q: string, o: Partial<typeof rx> = {}) =>
    found(text, q, o).map((r) => text.slice(r.from, r.to));

  it("matches a pattern, case-insensitively unless Match case is on", () => {
    expect(words("Cat cot CUT", "c[ao]t")).toEqual(["Cat", "cot"]);
    expect(words("Cat cat", "cat", { matchCase: true })).toEqual(["cat"]);
  });

  it("captures the match and its groups", () => {
    const [m] = found("say hello world", "(\\w+) (\\w+)$");
    expect(m!.captures).toEqual(["hello world", "hello", "world"]);
    expect(found("ab", "(a)|(b)").map((r) => r.captures)).toEqual([
      ["a", "a", ""],
      ["b", "", "b"],
    ]);
  });

  it("skips zero-length matches and does not loop", () => {
    expect(words("baaac", "a*")).toEqual(["aaa"]);
    expect(found("xyz", "a*")).toEqual([]);
    expect(found("😀😀", "^")).toEqual([]);
    expect(found("😀", "\\b")).toEqual([]);
  });

  it("is Unicode aware", () => {
    expect(words("naïve 😀 x", "\\p{L}+")).toEqual(["naïve", "x"]);
    expect(words("a😀b", ".")).toEqual(["a", "😀", "b"]);
    expect(words("ÉCOLE école", "école")).toEqual(["ÉCOLE", "école"]);
  });

  it("applies whole word with Unicode boundaries", () => {
    expect(words("cat concat cats cat", "cat", { wholeWord: true })).toEqual(["cat", "cat"]);
    expect(words("café cafés", "caf.", { wholeWord: true })).toEqual(["café"]);
    expect(words("ab|cd abcd", "abcd|ab", { wholeWord: true })).toEqual(["ab", "abcd"]);
    // A rejected candidate does not hide an overlapping one that starts later.
    expect(words("aa aaa a", "a+", { wholeWord: true })).toEqual(["aa", "aaa", "a"]);
    expect(words("xab ab", "ab", { wholeWord: true })).toEqual(["ab"]);
    expect(words("e\u0301a e", "a", { wholeWord: true })).toEqual([]);
    expect(words("😀cat😀 cat", "cat", { wholeWord: true })).toEqual(["cat", "cat"]);
  });

  it("treats invalid patterns as no match, without throwing", () => {
    for (const q of [
      "(",
      "[a",
      "a)(b",
      "*",
      "\\p{Nope}",
      "(?=a)a",
      "(?<=a)b",
      "(?<!a)b",
      "(?!a)b",
      "(a)\\1",
      "a{1001}",
    ]) {
      expect(found("a(b", q)).toEqual([]);
      expect(isInvalidRegex(q, false)).toBe(true);
    }
    expect(isInvalidRegex("", false)).toBe(false);
    expect(isInvalidRegex("a+", false)).toBe(false);
  });

  it("accepts nested quantifiers and stays linear on catastrophic patterns", () => {
    for (const q of ["(a+)+$", "(.*)*", "(\\w+\\s?)*", "(a{1,3})+", "(?:a*)+", "(a|aa)+$"])
      expect(compileRegex(q, false)).not.toBeNull();
    for (const q of ["(a+)+$", "(a|aa)+$", "(a*)*b", "(\\w+\\s?)*$"]) {
      const start = performance.now();
      expect(
        findInText("a".repeat(5000) + "!", q, { matchCase: false, wholeWord: false, regex: true })
          .length,
      ).toBeLessThanOrEqual(1);
      expect(performance.now() - start).toBeLessThan(1000);
    }
  });

  it("caps the match count as a UI guard", () => {
    expect(found("a".repeat(MAX_MATCHES + 50), "a")).toHaveLength(MAX_MATCHES);
  });

  it("honours Match case through the engine flag", () => {
    expect(words("Foo foo FOO", "foo")).toEqual(["Foo", "foo", "FOO"]);
    expect(words("Foo foo FOO", "foo", { matchCase: true })).toEqual(["foo"]);
    expect(words("ÉCOLE école", "école")).toEqual(["ÉCOLE", "école"]);
    expect(words("ÉCOLE école", "école", { matchCase: true })).toEqual(["école"]);
  });

  it("returns UTF-16 offsets after emoji and combining marks", () => {
    const text = "😀😀 e\u0301t 😀 end";
    const ranges = findInText(text, "(e)\\x{301}?t|end", {
      matchCase: false,
      wholeWord: false,
      regex: true,
    });
    expect(ranges.map((r) => text.slice(r.from, r.to))).toEqual(["e\u0301t", "end"]);
    expect(ranges[0]).toMatchObject({ from: 5, to: 8, captures: ["e\u0301t", "e"] });
    expect(findInText("😀b", "b", { matchCase: false, wholeWord: false, regex: true })).toEqual([
      { from: 2, to: 3, captures: ["b"] },
    ]);
    expect(
      findInText("a😀b😀", "😀", { matchCase: false, wholeWord: false, regex: true }).map((r) => [
        r.from,
        r.to,
      ]),
    ).toEqual([
      [1, 3],
      [4, 6],
    ]);
  });

  it("leaves the literal path alone: regex characters are plain text without the option", () => {
    expect(find("a.c abc", "a.c")).toEqual(["a.c"]);
  });
});

describe("expandReplacement", () => {
  const r = { from: 0, to: 5, captures: ["hello", "he", "llo", ""] };
  it("expands $1..$9, $& and $$ like String.replace", () => {
    expect(expandReplacement(r, "$2-$1", true)).toBe("llo-he");
    expect(expandReplacement(r, "[$&]", true)).toBe("[hello]");
    expect(expandReplacement(r, "$$1 costs $$", true)).toBe("$1 costs $");
    expect(expandReplacement(r, "$3|$9|$0|$x|$", true)).toBe("|$9|$0|$x|$");
  });
  it("stays literal with Regex off", () => {
    expect(expandReplacement({ from: 0, to: 1 }, "$1 $& $$", false)).toBe("$1 $& $$");
  });
});
