import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ImportError, htmlToBlocks, htmlToInline, importHtml, importMarkdown, looksLikeHtml } from "..";
import { expectValid } from "./helpers";

/**
 * enwik8: the first 100,000,000 bytes of an English Wikipedia XML dump (Matt Mahoney's Large Text Compression
 * Benchmark; Wikipedia text, CC BY-SA). Not in git: `scripts/fetch-enwik8.sh` downloads and checksums it into
 * tools/enwik8/. These tests skip without it, and fail when REQUIRE_ENWIK8=1 (as CI should set).
 */
const ENWIK8 = fileURLToPath(new URL("../../../../tools/enwik8/enwik8", import.meta.url));
const have = existsSync(ENWIK8);
if (!have && process.env.REQUIRE_ENWIK8 === "1") throw new Error("tools/enwik8/enwik8 is missing; run scripts/fetch-enwik8.sh");
const real = have ? it : it.skip;

const code = (f: () => unknown): string | undefined => {
  try { f(); } catch (e) { return e instanceof ImportError ? e.code : `other:${String(e)}`; }
  return undefined;
};

describe("the 50,000,000 character limit (generated input, always runs)", () => {
  const over = "a".repeat(50_000_001);
  it("refuses one character over the limit before parsing, in every entry point, fast", () => {
    const t = Date.now();
    expect(code(() => importMarkdown(over))).toBe("input-too-large");
    expect(code(() => importHtml(over))).toBe("input-too-large");
    expect(code(() => htmlToBlocks(over))).toBe("input-too-large");
    expect(code(() => htmlToInline(over))).toBe("input-too-large");
    expect(Date.now() - t).toBeLessThan(2000);
  });
  it("looksLikeHtml answers false instead of throwing on over-limit text", () => {
    expect(() => looksLikeHtml(over)).not.toThrow();
  });
  it("accepts input exactly at a lowered limit and refuses one over it", () => {
    expect(code(() => importMarkdown("x".repeat(1000), { maxInputChars: 1000 }))).toBeUndefined();
    expect(code(() => importMarkdown("x".repeat(1001), { maxInputChars: 1000 }))).toBe("input-too-large");
    expect(code(() => importHtml("<p>" + "x".repeat(993) + "</p>", { maxInputChars: 1000 }))).toBeUndefined();
    expect(code(() => importHtml("<p>" + "x".repeat(994) + "</p>", { maxInputChars: 1000 }))).toBe("input-too-large");
  });
});

describe("enwik8, 100 MB of real Wikipedia markup (needs tools/enwik8)", () => {
  const text = have ? readFileSync(ENWIK8, "utf8") : "";

  real("is the file we think it is", () => {
    expect(text.length).toBeGreaterThan(50_000_000);
    expect(text.length).toBeLessThanOrEqual(100_000_000);
  });

  real("is refused whole as Markdown and as HTML with input-too-large, quickly", () => {
    const t = Date.now();
    expect(code(() => importMarkdown(text))).toBe("input-too-large");
    expect(code(() => importHtml(text))).toBe("input-too-large");
    expect(Date.now() - t).toBeLessThan(2000);
  });

  real("a 5,000,000 character slice imports as Markdown into valid chapters with capped warnings", () => {
    const r = importMarkdown(text.slice(0, 5_000_000));
    expect(r.chapters.length).toBeGreaterThan(0);
    expectValid(r);
    const perCode = new Map<string, number>();
    for (const w of r.warnings) perCode.set(w.code, (perCode.get(w.code) ?? 0) + 1);
    expect(Math.max(...perCode.values())).toBeLessThanOrEqual(26);
  }, 120_000);

  real("a 5,000,000 character slice imports as HTML (XML read as unknown elements) into valid chapters", () => {
    const r = importHtml(text.slice(0, 5_000_000));
    expect(r.chapters.length).toBeGreaterThan(0);
    expectValid(r);
    expect(JSON.stringify(r.chapters)).toContain("Anarchism");
  }, 120_000);

  real("looksLikeHtml and the paste converter stay fast and never throw on a 1,000,000 character slice", () => {
    const slice = text.slice(0, 1_000_000);
    const t = Date.now();
    expect(() => looksLikeHtml(slice)).not.toThrow();
    expect(() => htmlToBlocks(slice)).not.toThrow();
    expect(Date.now() - t).toBeLessThan(30_000);
  }, 60_000);
});
