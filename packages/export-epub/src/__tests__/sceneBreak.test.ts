import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import type { ChapterDoc } from "@cadabracraft/shared";
import { SceneBreakOrnamentError } from "@cadabracraft/shared";
import { getTemplate } from "@cadabracraft/templates";
import { ALIGN_CSS } from "../epub";
import { buildEpub } from "../index";

const doc: ChapterDoc = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Before." }] },
    { type: "sceneBreak" },
    { type: "paragraph", content: [{ type: "text", text: "After." }] },
  ],
};
const meta = {
  title: "T",
  author: "A",
  language: "en",
  identifier: "urn:uuid:00000000-0000-4000-8000-000000000000",
  modified: new Date("2026-01-01T00:00:00Z"),
};
const chapters = [{ id: "ch1", title: "One", doc }];
const css = getTemplate("novel").epub.css;

function entries(bytes: Uint8Array): Record<string, string> {
  const files = unzipSync(bytes);
  return Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strFromU8(v)]));
}

describe("scene-break ornament in the EPUB", () => {
  it("keeps the template's stylesheet and the scene-break markup when no ornament is chosen", () => {
    const f = entries(buildEpub(meta, chapters, { css }));
    expect(f["OEBPS/style.css"]).toBe(`${css}\n${ALIGN_CSS}`);
    const body = Object.values(f).find((v) => v.includes("Before."))!;
    expect(body).toContain('<hr class="scene-break"/>');
  });

  it("writes the same chapter files for every ornament; only the stylesheet changes", () => {
    const plain = entries(buildEpub(meta, chapters, { css }));
    const chosen = entries(buildEpub(meta, chapters, { css, sceneBreak: "asterism" }));
    for (const k of Object.keys(plain))
      if (k !== "OEBPS/style.css") expect(chosen[k]).toBe(plain[k]);
    expect(chosen["OEBPS/style.css"]).toBe(
      `${css}\n${ALIGN_CSS}\nhr.scene-break:after{content:"⁂"}`,
    );
  });

  it("writes an empty mark for none", () => {
    const f = entries(buildEpub(meta, chapters, { css, sceneBreak: "none" }));
    expect(f["OEBPS/style.css"]).toContain('hr.scene-break:after{content:""}');
  });

  it("throws on an ornament id the library does not list", () => {
    expect(() => buildEpub(meta, chapters, { css, sceneBreak: "rule" as never })).toThrow(
      SceneBreakOrnamentError,
    );
  });
});
