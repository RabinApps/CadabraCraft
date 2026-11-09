import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { type Session, connect } from "./helpers";

let s: Session;
afterEach(() => s.close());

describe("scene-break ornament in exports", () => {
  it("draws the book's chosen sceneBreak in the EPUB stylesheet; absent keeps the template's own", async () => {
    s = await connect({ epubcheckJar: null });
    await s.ok("cadabra_project_create", { path: "d", title: "T", author: "A" });
    await s.ok("cadabra_chapter_add", { path: "d", title: "One" });
    const manifestPath = join(s.root, "d/cadabra.json");
    const stylesheet = async () => {
      await s.ok("cadabra_export_epub", { path: "d" });
      const zip = unzipSync(new Uint8Array(readFileSync(join(s.root, "d/exports/en/book.epub"))));
      return strFromU8(zip["OEBPS/style.css"]!);
    };
    expect(await stylesheet()).not.toContain('hr.scene-break:after{content:"⁂"}');

    const m = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    m.sceneBreak = "asterism";
    writeFileSync(manifestPath, JSON.stringify(m, null, 2) + "\n");
    expect(await stylesheet()).toMatch(/hr\.scene-break:after\{content:"⁂"\}$/);
  });
});
