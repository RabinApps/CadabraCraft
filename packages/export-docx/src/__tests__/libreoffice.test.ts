import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ChapterDoc, DocNode } from "@cadabracraft/shared";
import { buildDocx, type DocxChapter } from "../index";

// Each conversion starts LibreOffice (a few seconds warm, much slower on a cold profile or a loaded CI machine).
const SOFFICE_TIMEOUT = 180_000;

const findSoffice = (): string | null => {
  for (const name of ["soffice", "libreoffice"])
    if (!spawnSync(name, ["--version"], { stdio: "ignore", timeout: 60_000 }).error) return name;
  return null;
};
const soffice = findSoffice();

const fullBook: { title: string; author: string; chapters: DocxChapter[] } = JSON.parse(
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
const cell = (type: "tableCell" | "tableHeader", text: string): DocNode => ({
  type,
  content: [para(text)],
});
const table: DocNode = {
  type: "table",
  content: [
    { type: "tableRow", content: [cell("tableHeader", "Port"), cell("tableHeader", "Cargo")] },
    { type: "tableRow", content: [cell("tableCell", "Quayside"), cell("tableCell", "Herring")] },
  ],
};
const withExtras = (doc: ChapterDoc): ChapterDoc => ({
  ...doc,
  content: [...doc.content, table, { type: "sceneBreak" }, para("After the table.")],
});

/** Runs soffice with a throw-away profile so it never touches a real one or waits on a first-run dialog. */
function convert(docxPath: string, filter: string, ext: string): string {
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
      docxPath,
    ],
    { encoding: "utf8", timeout: 150_000, killSignal: "SIGKILL" },
  );
  expect(r.error, String(r.error)).toBeUndefined();
  expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
  const out = readdirSync(work).filter((f) => f.endsWith(`.${ext}`));
  expect(out, `no .${ext} produced: ${r.stdout}${r.stderr}`).toHaveLength(1);
  return join(work, out[0]!);
}

const writeDocx = (title: string, chapters: DocxChapter[]): string => {
  const f = join(mkdtempSync(join(tmpdir(), "lo-in-")), "book.docx");
  writeFileSync(f, buildDocx({ title, author: "Ada Q. Lovelace" }, chapters, { assets }));
  return f;
};
const pageCount = (pdf: Buffer): number =>
  (pdf.toString("latin1").match(/\/Type\s*\/Page(?![A-Za-z])/g) ?? []).length;
const toPdf = (docx: string): Buffer => readFileSync(convert(docx, "pdf", "pdf"));
const toText = (docx: string): string => readFileSync(convert(docx, "txt:Text", "txt"), "utf8");

// Needs LibreOffice (`soffice` on the PATH). CI installs it on Linux; set REQUIRE_SOFFICE=1 to fail instead of skip.
// Right-to-left books are refused by the exporter (see docx.test.ts), so there is nothing to open for them.
describe.skipIf(!soffice && !process.env.REQUIRE_SOFFICE)("LibreOffice opens the .docx", () => {
  it("is installed when required", () => {
    expect(soffice, "REQUIRE_SOFFICE is set but soffice was not found").not.toBeNull();
  });

  it(
    "converts a manuscript with headings, footnotes, a table, an image and scene breaks to a multi-page PDF",
    () => {
      const chapters = fullBook.chapters.map((c, i) =>
        i === 0 ? { ...c, doc: withExtras(c.doc) } : c,
      );
      const docx = writeDocx(fullBook.title, chapters);
      const pdf = toPdf(docx);
      expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
      expect(pageCount(pdf)).toBeGreaterThan(1);

      const text = toText(docx);
      for (const word of ["harbour", "Quay", "gulls", "Herring", "After the table"])
        expect(text, word).toContain(word);
    },
    SOFFICE_TIMEOUT,
  );

  it(
    "converts a book whose title has special characters",
    () => {
      const title = `Tom & Jerry's "Quay" <1> — Ünïcöde 日本語`;
      const docx = writeDocx(title, [
        { title: "One & <Two>", doc: { type: "doc", content: [para("Sentence one & two.")] } },
      ]);
      const pdf = toPdf(docx);
      expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
      expect(pageCount(pdf)).toBeGreaterThanOrEqual(1);
      expect(toText(docx)).toContain("Sentence one & two.");
    },
    SOFFICE_TIMEOUT,
  );
});
