import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildGlossary,
  buildIndex,
  collectGlossaryUses,
  collectIndexMarks,
  type ChapterDoc,
  type Mark,
} from "@cadabracraft/shared";
import { accessibilityMetadata, buildEpub, type A11yFacts } from "../index";
import { matterBook } from "./matterBook";

const win = process.platform === "win32";
const ace = fileURLToPath(
  new URL(`../../../../tools/ace/node_modules/.bin/${win ? "ace.cmd" : "ace"}`, import.meta.url),
);
// Ace starts headless Chromium; a cold run takes several seconds, more when `pnpm test` runs every package at once.
const ACE_TIMEOUT = 180_000;
const fixture = (p: string) => new URL(`../../../../fixtures/${p}`, import.meta.url);
const doc = JSON.parse(readFileSync(fixture("manuscripts/sample-chapter.json"), "utf8"));
const png = new Uint8Array(readFileSync(fixture("assets/pixel.png")));
const meta = {
  title: "S",
  author: "A",
  language: "en",
  identifier: "urn:uuid:5b1d1d2c-6f0a-4c43-9a55-1f0d3c8d3a11",
  modified: new Date(),
};

interface Assertion {
  "earl:test": { "dct:title": string; "earl:impact": string };
  "earl:result": { html?: string };
}
interface Report {
  assertions: { assertions?: Assertion[] }[];
  "earl:testSubject": { metadata: Record<string, string | string[]> };
}

/** Runs Ace on the bytes and returns its JSON report. Needs a Chrome: set PUPPETEER_EXECUTABLE_PATH, or let Puppeteer's own download be used. */
function runAce(name: string, bytes: Uint8Array): Report {
  const dir = mkdtempSync(join(tmpdir(), "ace-"));
  const f = join(dir, name);
  writeFileSync(f, bytes);
  execFileSync(ace, ["--force", "--outdir", join(dir, "report"), f], {
    encoding: "utf8",
    stdio: "pipe",
    shell: win,
  });
  return JSON.parse(readFileSync(join(dir, "report", "report.json"), "utf8"));
}

const findings = (r: Report) =>
  r.assertions.flatMap((a) =>
    (a.assertions ?? []).map((x) => ({
      rule: x["earl:test"]["dct:title"],
      impact: x["earl:test"]["earl:impact"],
      html: x["earl:result"].html ?? "",
    })),
  );

/** The one finding we accept (docs/testing.md): `epub:type="bodymatter chapter"` on <body> makes Ace ask for role=doc-chapter, which ARIA does not allow on <body>. */
const accepted = (f: { rule: string; html: string }) =>
  f.rule === "epub-type-has-matching-role" && f.html.startsWith("<body ");

const prop = (opf: string, name: string): string[] =>
  [...opf.matchAll(new RegExp(`<meta property="schema:${name}"[^>]*>([^<]*)</meta>`, "g"))].map(
    (m) => m[1] ?? "",
  );

// Run scripts/fetch-ace.sh first. CI always fetches it; set REQUIRE_ACE=1 to fail instead of skip.
describe.skipIf(!existsSync(ace) && !process.env.REQUIRE_ACE)("Ace by DAISY", () => {
  const check = (name: string, bytes: Uint8Array, facts: A11yFacts) => {
    const r = runAce(name, bytes);
    const all = findings(r);
    expect(
      all.filter((f) => f.impact === "serious" || f.impact === "critical"),
      "serious or critical violations",
    ).toEqual([]);
    expect(all.filter((f) => !accepted(f))).toEqual([]);
    // Ace reads the discovery metadata back from the package: it must be what accessibilityMetadata promises.
    const ours = accessibilityMetadata(facts, meta.language);
    const m = r["earl:testSubject"].metadata;
    expect([m["schema:accessibilityFeature"]].flat()).toEqual(prop(ours, "accessibilityFeature"));
    expect([m["schema:accessMode"]].flat()).toEqual(prop(ours, "accessMode"));
    expect(m["schema:accessModeSufficient"]).toBe(prop(ours, "accessModeSufficient")[0]);
    expect(m["schema:accessibilityHazard"]).toBe(prop(ours, "accessibilityHazard")[0]);
    expect(m["schema:accessibilitySummary"]).toBe(prop(ours, "accessibilitySummary")[0]);
  };

  it(
    "finds no serious or critical issue in the sample EPUB and reads our conformance metadata back",
    () => {
      check(
        "sample.epub",
        buildEpub(meta, [{ id: "ch1", title: "One", doc }], {
          cover: { path: "assets/cover.png", bytes: png },
        }),
        { images: 0, imagesMissingAlt: 0, hasCover: true, hasGif: false, hasSvg: false },
      );
    },
    ACE_TIMEOUT,
  );

  it(
    "finds no serious or critical issue in a book with vertically centred matter pages",
    () => {
      const pages = matterBook().map((c) =>
        c.kind === "foreword" ? { ...c, verticalCenter: true } : c,
      );
      check(
        "vcenter.epub",
        buildEpub(meta, pages, { centerKinds: ["title-page", "dedication", "epigraph"] }),
        { images: 0, imagesMissingAlt: 0, hasCover: false, hasGif: false, hasSvg: false },
      );
    },
    ACE_TIMEOUT,
  );

  it(
    "finds none with an image with alt text, a decorative image, a footnote, a passage in another language and a task list",
    () => {
      const t = (text: string, marks?: unknown[]) => ({
        type: "text",
        text,
        ...(marks ? { marks } : {}),
      });
      const p = (...content: unknown[]) => ({ type: "paragraph", content });
      const rich = {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 1 }, content: [t("Rich")] },
          p(
            t("Das ist "),
            t("Guten Tag", [{ type: "lang", attrs: { lang: "de" } }]),
            t(" and a note"),
            { type: "footnote", content: [t("The note.")] },
          ),
          {
            type: "image",
            attrs: { src: "assets/a.png", alt: "A single pixel", title: "Caption" },
          },
          { type: "image", attrs: { src: "assets/b.png", alt: "", decorative: true } },
          {
            type: "taskList",
            content: [
              { type: "taskItem", attrs: { checked: true }, content: [p(t("done"))] },
              { type: "taskItem", attrs: { checked: false }, content: [p()] },
            ],
          },
        ],
      };
      check(
        "rich.epub",
        buildEpub(meta, [{ id: "ch1", title: "One", doc: rich as ChapterDoc }], {
          assets: new Map([
            ["assets/a.png", png],
            ["assets/b.png", png],
          ]),
        }),
        { images: 2, imagesMissingAlt: 0, hasCover: false, hasGif: false, hasSvg: false },
      );
    },
    ACE_TIMEOUT,
  );

  it(
    "finds none in a book with an index and a glossary page (links must not rely on colour alone)",
    () => {
      const t = (text: string, ...marks: Mark[]) => ({ type: "text", text, marks });
      const ix = (id: string, term: string, extra: Record<string, string> = {}): Mark => ({
        type: "indexEntry",
        attrs: { id, term, ...extra },
      });
      const gl = (id: string): Mark => ({ type: "glossaryTerm", attrs: { id } });
      const p = (...content: unknown[]) => ({ type: "paragraph", content });
      const chapter = (id: string, title: string, ...content: unknown[]) => ({
        id,
        title,
        doc: { type: "doc", content: [p(...content)] } as ChapterDoc,
      });
      const chapters = [
        chapter(
          "ch-1",
          "One",
          t("The orchard wall", ix("a", "Orchard", { sub: "wall" })),
          t(" and the "),
          t("grafting knife", gl("knife")),
        ),
        chapter(
          "ch-2",
          "Two",
          t("the cider press", ix("b", "Cider press", { seeAlso: "Orchard" })),
          t(" "),
          t("ledger", ix("c", "Ledger")),
        ),
      ];
      const ids = chapters.map((c) => ({ id: c.id, doc: c.doc }));
      check(
        "index.epub",
        buildEpub(meta, chapters, {
          index: {
            heading: "Index",
            letterHeadings: true,
            ranges: true,
            columns: 2,
            tree: buildIndex(collectIndexMarks(ids)),
          },
          glossary: {
            heading: "Glossary",
            markFirstUse: true,
            items: buildGlossary(
              [{ id: "knife", term: "Grafting knife", definition: "A short curved blade." }],
              collectGlossaryUses(ids),
            ).items,
          },
        }),
        { images: 0, imagesMissingAlt: 0, hasCover: false, hasGif: false, hasSvg: false },
      );
    },
    ACE_TIMEOUT,
  );
});
