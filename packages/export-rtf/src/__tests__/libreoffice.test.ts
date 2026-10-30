import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { DocNode } from "@cadabracraft/shared";
import { buildRtf, type RtfChapter } from "../index";

// Each conversion starts LibreOffice (a few seconds warm, much slower on a cold profile or a loaded CI machine).
const SOFFICE_TIMEOUT = 180_000;

const findSoffice = (): string | null => {
  for (const name of ["soffice", "libreoffice"])
    if (!spawnSync(name, ["--version"], { stdio: "ignore", timeout: 60_000 }).error) return name;
  return null;
};
const soffice = findSoffice();

const fullBook: { title: string; author: string; chapters: RtfChapter[] } = JSON.parse(
  readFileSync(new URL("../../../../fixtures/manuscripts/full-book.json", import.meta.url), "utf8"),
);
const pixel = new Uint8Array(
  readFileSync(new URL("../../../../fixtures/assets/pixel.png", import.meta.url)),
);
const assets = new Map([
  ["assets/pixel.png", pixel],
  ["assets/gradient.png", pixel],
]);

const para = (text: string): DocNode => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const img = (alt: string): DocNode =>
  ({ type: "image", attrs: { src: "assets/pixel.png", alt } }) as DocNode;

/** Runs soffice with a throw-away profile so it never touches a real one or waits on a first-run dialog. */
function convert(rtfPath: string, filter: string, ext: string): string {
  const work = mkdtempSync(join(tmpdir(), "lo-out-"));
  const profile = mkdtempSync(join(tmpdir(), "lo-profile-"));
  const r = spawnSync(
    soffice!,
    [
      `-env:UserInstallation=${pathToFileURL(profile).href}`,
      "--headless",
      "--norestore",
      "--convert-to",
      filter,
      "--outdir",
      work,
      rtfPath,
    ],
    { encoding: "utf8", timeout: 150_000, killSignal: "SIGKILL" },
  );
  expect(r.error, String(r.error)).toBeUndefined();
  expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
  const out = readdirSync(work).filter((f) => f.endsWith(`.${ext}`));
  expect(out, `no .${ext} produced: ${r.stdout}${r.stderr}`).toHaveLength(1);
  return join(work, out[0]!);
}

const writeRtf = (
  book: { title: string; author: string; language?: string },
  chapters: RtfChapter[],
) => {
  const f = join(mkdtempSync(join(tmpdir(), "lo-in-")), "manuscript.rtf");
  writeFileSync(f, buildRtf(book, chapters, { assets }), "latin1");
  return f;
};
const pageCount = (pdf: Buffer): number =>
  (pdf.toString("latin1").match(/\/Type\s*\/Page(?![A-Za-z])/g) ?? []).length;
const toPdf = (rtf: string): Buffer => readFileSync(convert(rtf, "pdf", "pdf"));
const toText = (rtf: string): string => readFileSync(convert(rtf, "txt:Text", "txt"), "utf8");

// Needs LibreOffice (`soffice` on the PATH). CI installs it on Linux; set REQUIRE_SOFFICE=1 to fail instead of skip.
// Right-to-left books are refused by the exporter (see rtf.test.ts), so there is nothing to open for them.
describe.skipIf(!soffice && !process.env.REQUIRE_SOFFICE)("LibreOffice opens the .rtf", () => {
  it("is installed when required", () => {
    expect(soffice, "REQUIRE_SOFFICE is set but soffice was not found").not.toBeNull();
  });

  it(
    "converts the full manuscript (language ids, picture descriptions, a table) to a multi-page PDF and to text",
    () => {
      const chapters: RtfChapter[] = [
        ...fullBook.chapters,
        {
          title: "Extras",
          doc: {
            type: "doc",
            content: [
              para("Before the figure."),
              img("A single pixel described for screen readers"),
              img(""),
              para("After the pictures."),
            ],
          },
        },
      ];
      const rtf = writeRtf({ ...fullBook, language: "en-GB" }, chapters);
      const pdf = toPdf(rtf);
      expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
      expect(pageCount(pdf)).toBeGreaterThan(1);

      const text = toText(rtf);
      for (const word of ["harbour", "Quay", "gulls", "Before the figure", "After the pictures"])
        expect(text, word).toContain(word);
    },
    SOFFICE_TIMEOUT,
  );

  it(
    "opens a book in a non-English language with accents",
    () => {
      const rtf = writeRtf({ title: "Le Quai", author: "Ada Q. Lovelace", language: "fr" }, [
        {
          title: "Chapitre premier",
          doc: { type: "doc", content: [para("Le port était calme, très tôt."), img("Un pixel")] },
        },
        { title: "Suite", doc: { type: "doc", content: [para("Après la pluie, le vent.")] } },
      ]);
      const text = toText(rtf);
      expect(text).toContain("Le port était calme, très tôt.");
      expect(text).toContain("Après la pluie, le vent.");
      expect(toPdf(rtf).subarray(0, 4).toString("latin1")).toBe("%PDF");
    },
    SOFFICE_TIMEOUT,
  );
});
