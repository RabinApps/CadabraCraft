import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { LOCALES, PSEUDO_LOCALE } from "../locales";

const dir = new URL("../locales/", import.meta.url);
const read = (code: string) => readFileSync(new URL(`${code}/messages.po`, dir), "utf8");
const ids = (code: string) =>
  [...read(code).matchAll(/^msgid "(.*)"$/gm)]
    .map((m) => m[1]!)
    .filter(Boolean)
    .sort();
// Placeholder names only: `{name}` and the argument of a plural, not the text that starts a plural branch (`one {Imported # page}`).
const placeholders = (s: string) =>
  [
    ...new Set(
      [...s.matchAll(/(?<!\b(?:zero|one|two|few|many|other) )\{(\w+)\s*[,}]/g)].map((m) => m[1]!),
    ),
  ].sort();

describe("message catalogs", () => {
  const codes = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const known = new Set([...LOCALES.map((l) => l.code), PSEUDO_LOCALE]);
  const source = ids("en");

  it("only contains locales we know about", () => {
    for (const c of codes) expect(known.has(c), `unknown locale folder "${c}"`).toBe(true);
  });
  it("has a non-empty source catalog", () => {
    expect(source.length).toBeGreaterThan(30);
  });
  for (const code of codes.filter((c) => c !== "en")) {
    it(`${code} has exactly the source message ids`, () => {
      expect(ids(code)).toEqual(source);
    });
    it(`${code} keeps every placeholder`, () => {
      for (const block of read(code).split(/\n\n+/)) {
        const id = /^msgid "(.*)"$/m.exec(block)?.[1];
        const str = /^msgstr "(.*)"$/m.exec(block)?.[1];
        if (!id || !str) continue; // untranslated entries fall back to English
        expect(placeholders(str), `placeholders of "${id}"`).toEqual(placeholders(id));
      }
    });
  }
});
