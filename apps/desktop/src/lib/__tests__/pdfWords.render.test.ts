// @vitest-environment node
// Integration: real Typst and real pdf.js. A click on every word of a right-to-left page (Hebrew and Arabic, with a number and a Latin
// word in the line) finds that word of the chapter, the way the print preview's jump to the word under the click does.
import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderPdf, type PdfChapter } from "@cadabracraft/export-pdf";
import { createNodeRunner } from "@cadabracraft/export-pdf/node";
import { alignWord } from "../page/pageWords";
import { wordAtPoint, type TextRun } from "../export/pdfWords";

const has = (cmd: string, args: string[]): boolean =>
  spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
const suite = has("typst", ["--version"]) && has("pdftotext", ["-v"]) ? describe : describe.skip;
const T = 300_000;

/** Distinct words of three to five letters, spelled from `letters` (the index in base `letters.length`, so no two are alike and none is a prefix of another). */
const makeWords = (letters: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => {
    const base = [...letters];
    let n = i;
    let w = "";
    do {
      w += base[n % base.length]!;
      n = Math.floor(n / base.length);
    } while (n > 0);
    return base[(i * 7) % base.length]! + w + base[(i * 3 + 1) % base.length]!;
  });

const HEBREW = "אבגדהוזחטיכלמנסעפצקרשת";
const ARABIC = "ابتثجحخدذرزسشصضطظعغفقكلمنهوي";

/** Words of a page as pdftotext's `-bbox` gives them: text and box, in PDF user space (y up). */
function boxes(pdf: Uint8Array): { text: string; x: number; y: number; w: number; h: number }[] {
  const dir = mkdtempSync(join(tmpdir(), "cc-rtl-"));
  try {
    const file = join(dir, "x.pdf");
    writeFileSync(file, pdf);
    const html = execFileSync("pdftotext", ["-f", "1", "-l", "1", "-bbox", file, "-"], {
      encoding: "utf8",
    });
    const height = Number(/<page width="[\d.]+" height="([\d.]+)"/.exec(html)![1]);
    return [
      ...html.matchAll(
        /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g,
      ),
    ].map((m) => ({
      text: m[5]!,
      x: (Number(m[1]) + Number(m[3])) / 2,
      y: height - (Number(m[2]) + Number(m[4])) / 2,
      w: Number(m[3]) - Number(m[1]),
      h: Number(m[4]) - Number(m[2]),
    }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function runsOfFirstPage(pdf: Uint8Array): Promise<TextRun[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: pdf.slice() });
  const doc = await task.promise;
  const content = await (await doc.getPage(1)).getTextContent();
  const runs = content.items.flatMap((item) =>
    "str" in item
      ? [
          {
            str: item.str,
            transform: item.transform as number[],
            width: item.width,
            height: item.height,
            dir: item.dir,
          },
        ]
      : [],
  );
  await task.destroy();
  return runs;
}

suite("a click on a word of a right-to-left page, with real Typst and pdf.js", () => {
  const cases: [string, string, string][] = [
    ["Hebrew", "he", HEBREW],
    ["Arabic", "ar", ARABIC],
  ];
  for (const [label, language, letters] of cases) {
    it(
      `${label}: every word clicked is the word of the text`,
      async () => {
        const words = makeWords(letters, 90);
        // A number and a word in Latin letters in the middle of a line, as books have them.
        words.splice(40, 0, "1984");
        const chapter: PdfChapter = {
          id: "c1",
          title: words[0]!,
          doc: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: words.join(" ") }] }],
          },
        };
        const { pdf } = await renderPdf(
          { title: "ספר", author: "A", language },
          [chapter],
          { template: "novel", chapterStart: "any", trimSize: "5x8" },
          createNodeRunner(),
        );
        const runs = await runsOfFirstPage(pdf);
        // pdftotext's boxes spell a right-to-left word in drawing order; the word is found by its letters either way.
        const spelled = (b: string): string | undefined =>
          words.find((w) => w === b || [...w].reverse().join("") === b);
        const onPage = boxes(pdf).flatMap((b) => {
          const text = spelled(b.text);
          return text === undefined ? [] : [{ ...b, text }];
        });
        // Most of the paragraph is on the first page (there is a chapter title above it).
        expect(onPage.length).toBeGreaterThan(30);
        let found = 0;
        for (const b of onPage) {
          const click = wordAtPoint(runs, b.x, b.y);
          expect(click, `${label} ${b.text}`).not.toBeNull();
          const at = alignWord(click!.tokens, click!.index, words);
          // A word is found, and it is the one that was clicked; only the numeral may be off (a number is one word to the eye and to the text, but pdf.js keeps it apart).
          if (at !== null) {
            expect(words[at], `${label} ${b.text}`).toBe(b.text);
            found++;
          }
        }
        expect(found / onPage.length).toBeGreaterThan(0.9);
      },
      T,
    );
  }
});
