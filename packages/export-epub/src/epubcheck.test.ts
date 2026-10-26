import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEpub } from "./index";

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
});
