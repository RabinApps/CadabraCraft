import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listTemplates } from "@cadabracraft/templates";
import { buildEpub } from "./index";
import { matterBook } from "./matterBook";

const jar = new URL("../../../tools/epubcheck-5.4.0/epubcheck.jar", import.meta.url).pathname;
const doc = JSON.parse(readFileSync(new URL("../../../fixtures/manuscripts/sample-chapter.json", import.meta.url), "utf8"));

// Run scripts/fetch-epubcheck.sh first. CI always fetches it; set REQUIRE_EPUBCHECK=1 to fail instead of skip.
describe.skipIf(!existsSync(jar) && !process.env.REQUIRE_EPUBCHECK)("EPUBCheck", () => {
  it("validates the sample EPUB with zero messages", () => {
    const f = join(mkdtempSync(join(tmpdir(), "epub-")), "s.epub");
    writeFileSync(f, buildEpub({ title: "S", author: "A", language: "en", identifier: "urn:uuid:5b1d1d2c-6f0a-4c43-9a55-1f0d3c8d3a11", modified: new Date() }, [{ id: "ch1", title: "One", doc }]));
    const out = execFileSync("java", ["-jar", jar, f], { encoding: "utf8" });
    expect(out).toContain("No errors or warnings detected");
  });

  it("validates an EPUB containing images with zero messages", () => {
    const f = join(mkdtempSync(join(tmpdir(), "epub-")), "img.epub");
    const png = new Uint8Array(readFileSync(new URL("../../../fixtures/assets/pixel.png", import.meta.url)));
    const withImage = { ...doc, content: [...doc.content, { type: "image", attrs: { src: "assets/pixel.png", alt: "A single pixel", title: "A caption" } }] };
    writeFileSync(f, buildEpub({ title: "S", author: "A", language: "en", identifier: "urn:uuid:5b1d1d2c-6f0a-4c43-9a55-1f0d3c8d3a11", modified: new Date() }, [{ id: "ch1", title: "One", doc: withImage }], { assets: new Map([["assets/pixel.png", png]]) }));
    const out = execFileSync("java", ["-jar", jar, f], { encoding: "utf8" });
    expect(out).toContain("No errors or warnings detected");
  });

  const metaOf = (language: string) => ({ title: "S", author: "A", language, identifier: "urn:uuid:5b1d1d2c-6f0a-4c43-9a55-1f0d3c8d3a11", modified: new Date() });
  const check = (name: string, bytes: Uint8Array): string => {
    const f = join(mkdtempSync(join(tmpdir(), "epub-")), name);
    writeFileSync(f, bytes);
    return execFileSync("java", ["-jar", jar, f], { encoding: "utf8" });
  };

  it("validates a book with every kind of front and back matter, with every template stylesheet", () => {
    for (const t of listTemplates()) {
      const out = check(`matter-${t.id}.epub`, buildEpub(metaOf("en"), matterBook(), { css: t.epub.css }));
      expect(out, t.id).toContain("No errors or warnings detected");
    }
  }, 60_000);

  it("validates matter-only and right-to-left books", () => {
    expect(check("front-only.epub", buildEpub(metaOf("en"), matterBook().slice(0, 1)))).toContain("No errors or warnings detected");
    expect(check("he.epub", buildEpub(metaOf("he"), matterBook()))).toContain("No errors or warnings detected");
  }, 30_000);
});
