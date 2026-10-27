import { describe, expect, it } from "vitest";
import { compileRegex, expandReplacement, findInText, isInvalidRegex, MAX_MATCHES } from "./match";

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

describe("findInText with regex", () => {
  const rx = { matchCase: false, wholeWord: false, regex: true };
  const found = (text: string, q: string, o: Partial<typeof rx> = {}) => findInText(text, q, { ...rx, ...o });
  const words = (text: string, q: string, o: Partial<typeof rx> = {}) => found(text, q, o).map((r) => text.slice(r.from, r.to));

  it("matches a pattern, case-insensitively unless Match case is on", () => {
    expect(words("Cat cot CUT", "c[ao]t")).toEqual(["Cat", "cot"]);
    expect(words("Cat cat", "cat", { matchCase: true })).toEqual(["cat"]);
  });

  it("captures the match and its groups", () => {
    const [m] = found("say hello world", "(\\w+) (\\w+)$");
    expect(m!.captures).toEqual(["hello world", "hello", "world"]);
    expect(found("ab", "(a)|(b)").map((r) => r.captures)).toEqual([["a", "a", ""], ["b", "", "b"]]);
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
    expect(words("ab|cd abcd", "ab|abcd", { wholeWord: true })).toEqual(["ab", "abcd"]);
  });

  it("treats invalid patterns as no match, without throwing", () => {
    for (const q of ["(", "[a", "a)(b", "*", "\\p{Nope}"]) {
      expect(found("a(b", q)).toEqual([]);
      expect(isInvalidRegex(q, false, false)).toBe(true);
    }
    expect(isInvalidRegex("", false, false)).toBe(false);
    expect(isInvalidRegex("a+", false, false)).toBe(false);
  });

  it("refuses nested quantifiers and caps the match count", () => {
    for (const q of ["(a+)+$", "(.*)*", "(\\w+\\s?)*", "(a{1,3})+", "(?:a*)+"]) expect(compileRegex(q, false, false)).toBeNull();
    expect(compileRegex("(ab)+", false, false)).not.toBeNull();
    expect(compileRegex("a+b*", false, false)).not.toBeNull();
    expect(found("a".repeat(MAX_MATCHES + 50), "a")).toHaveLength(MAX_MATCHES);
    const start = performance.now();
    expect(found("a".repeat(40) + "!", "(a+)+$")).toEqual([]);
    expect(performance.now() - start).toBeLessThan(100);
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
