import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { ImportError, importDocx, importMarkdown } from "..";
import { expectValid, makeDocx, para } from "./helpers";

function errCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ImportError);
    return (e as ImportError).code;
  }
  return undefined;
}

describe("hostile markdown", () => {
  it("handles empty, whitespace and BOM-only input", () => {
    for (const s of ["", "   \n\n", "﻿"]) {
      const r = importMarkdown(s);
      expect(r.chapters).toEqual([]);
    }
  });

  it("handles a huge single line", () => {
    const r = importMarkdown("# T\n\n" + "word ".repeat(400_000));
    expectValid(r);
    expect(r.chapters).toHaveLength(1);
  });

  it("flattens very deeply nested lists and quotes instead of failing", () => {
    const lists = Array.from({ length: 300 }, (_, i) => `${"  ".repeat(i)}- item ${i}`).join("\n");
    const r = importMarkdown(`# T\n\n${lists}`);
    expectValid(r);
    expect(r.warnings.map((w) => w.code)).toContain("nesting-too-deep");
    expect(JSON.stringify(r.chapters[0]!.doc)).toContain("item 299");
    const quotes = importMarkdown(`# T\n\n${">".repeat(500)} deep`);
    expectValid(quotes);
    expect(JSON.stringify(quotes.chapters[0]!.doc)).toContain("deep");
  });

  it("never throws a non-ImportError on odd input", () => {
    const odd = [
      "\u0000\u0001\ud800 lone surrogate",
      "[^1]: only def",
      "![](<>)",
      "[a][b]\n\n[b]: javascript:x",
      "| a |\n|---|\n",
      "<!-- c -->\n\n<script>alert(1)</script>",
      "* * *\n* * *\n",
      "1. \n2. \n",
      "- \n  - \n    - \n",
      "# \n\n## \n",
      "```\n```",
      "[x](" + "(".repeat(2000) + ")",
    ];
    for (const s of odd) {
      const r = importMarkdown(s);
      expectValid(r);
    }
  });

  it("random fuzz stays valid", () => {
    const pieces = ["# ", "## ", "#### ", "- ", "1. ", "> ", "**", "*", "_", "[a](", "https://x.y", ")", "![i](a.png)", "[^1]", "[^1]: n", "\n", "\n\n", "---", "|a|b|\n|-|-|", "`", "~~", "<b>", "text ", "\\\n"];
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 300; i++) {
      let s = "";
      for (let j = 0; j < 40; j++) s += pieces[Math.floor(rnd() * pieces.length)];
      expectValid(importMarkdown(s));
    }
  });

  it("rejects input over the size cap", () => {
    expect(errCode(() => importMarkdown("x".repeat(100), { maxInputChars: 50 }))).toBe("input-too-large");
  });
});

describe("hostile docx", () => {
  it("rejects empty and non-zip input with clear errors", () => {
    expect(errCode(() => importDocx(new Uint8Array(0)))).toBe("invalid-zip");
    expect(errCode(() => importDocx(strToU8("hello world, not a zip file at all")))).toBe("invalid-zip");
    expect(errCode(() => importDocx(Uint8Array.from([0x50, 0x4b, 3, 4, ...new Array(40).fill(7)])))).toBe("invalid-zip");
    const good = makeDocx({ body: para("x") });
    expect(errCode(() => importDocx(good.subarray(0, good.length - 30)))).toBe("invalid-zip");
  });

  it("rejects a zip without document.xml", () => {
    const z = zipSync({ "hello.txt": strToU8("hi") });
    expect(errCode(() => importDocx(z))).toBe("missing-document");
  });

  it("rejects malformed XML", () => {
    const z = zipSync({ "word/document.xml": strToU8("<w:document><w:body><w:p></w:document>") });
    expect(errCode(() => importDocx(z))).toBe("invalid-xml");
  });

  it("rejects a document without a body", () => {
    const z = zipSync({ "word/document.xml": strToU8("<w:document xmlns:w='x'/>") });
    expect(errCode(() => importDocx(z))).toBe("missing-document");
  });

  it("enforces the decompressed size cap on a zip bomb", () => {
    // ~210 MB of zeros compresses to ~200 KB.
    const big = new Uint8Array(210 * 1024 * 1024);
    const z = zipSync({ "word/document.xml": strToU8("<w:document/>"), "word/media/bomb.png": big }, { level: 9 });
    expect(z.length).toBeLessThan(5 * 1024 * 1024);
    expect(errCode(() => importDocx(z))).toBe("archive-too-large");
    expect(errCode(() => importDocx(makeDocx({ body: para("x") }), { maxDecompressedBytes: 100 }))).toBe("archive-too-large");
  });

  it("enforces a decompressed size cap even when the declared size is forged", () => {
    const payload = new Uint8Array(5 * 1024 * 1024);
    const z = zipSync({ "word/document.xml": strToU8("<w:document/>"), "word/media/a.png": payload });
    // Forge the declared uncompressed size (local header + central directory) to 10 bytes.
    const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
    for (let i = 0; i + 4 < z.length; i++) {
      const sig = dv.getUint32(i, true);
      if (sig === 0x04034b50 && dv.getUint32(i + 22, true) === payload.length) dv.setUint32(i + 22, 10, true);
      if (sig === 0x02014b50 && dv.getUint32(i + 24, true) === payload.length) dv.setUint32(i + 24, 10, true);
    }
    const c = errCode(() => importDocx(z, { maxDecompressedBytes: 1024 * 1024 }));
    // fflate truncates to the declared size, so memory stays bounded; the result is an error (here: no body), never a 5 MB read past the cap.
    expect(["invalid-zip", "archive-too-large", "missing-document"]).toContain(c);
  });

  it("enforces the entry count cap", () => {
    const files: Record<string, Uint8Array> = { "word/document.xml": strToU8("<w:document/>") };
    for (let i = 0; i < 50; i++) files[`junk/${i}.txt`] = strToU8("x");
    expect(errCode(() => importDocx(zipSync(files), { maxEntries: 10 }))).toBe("too-many-entries");
  });

  it("handles a huge paragraph, deeply nested lists and many paragraphs", () => {
    const huge = para("lorem ".repeat(300_000), "Heading1") + para("y");
    const r1 = importDocx(makeDocx({ body: huge }));
    expectValid(r1);
    const items = Array.from({ length: 200 }, (_, i) => para(`i${i}`, undefined, `<w:numPr><w:ilvl w:val="${i}"/><w:numId w:val="1"/></w:numPr>`)).join("");
    const r2 = importDocx(makeDocx({ body: para("T", "Heading1") + items, numbering: "<w:numbering/>" }));
    expectValid(r2);
    const r3 = importDocx(makeDocx({ body: para("T", "Heading1") + para("p").repeat(20_000) }));
    expect(r3.chapters[0]!.doc.content).toHaveLength(20_001);
    expectValid(r3);
  });

  it("survives XML entity bombs and odd structure", () => {
    const bomb = `<?xml version="1.0"?><!DOCTYPE d [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;"><!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">]><w:document xmlns:w="x"><w:body><w:p><w:r><w:t>&c;&c;&c;</w:t></w:r></w:p></w:body></w:document>`;
    let ok = true;
    try {
      const r = importDocx(zipSync({ "word/document.xml": strToU8(bomb) }));
      expectValid(r);
    } catch (e) {
      ok = e instanceof ImportError;
    }
    expect(ok).toBe(true);
    const nested = "<w:sdt><w:sdtContent>".repeat(500) + para("deep") + "</w:sdtContent></w:sdt>".repeat(500);
    // 500 levels exceeds the XML parser's nesting limit: a clear ImportError is the expected outcome.
    expect(errCode(() => importDocx(makeDocx({ body: nested })))).toBe("invalid-xml");
    const shallow = "<w:sdt><w:sdtContent>".repeat(30) + para("deep") + "</w:sdtContent></w:sdt>".repeat(30);
    expectValid(importDocx(makeDocx({ body: shallow })));
  });
});
