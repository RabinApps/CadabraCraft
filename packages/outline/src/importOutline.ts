import type { ChapterDoc, DocNode } from "@cadabracraft/shared";
import { fromCsv } from "./csvParse";
import { fromMarkdown } from "./markdown";
import { fromOpml } from "./opml";
import { OutlineError, type OutlineWarning, type ParsedOutline } from "./parsed";

/** The formats an outline can be read from (the same three it is written in). */
export type OutlineImportFormat = "opml" | "markdown" | "csv";

/** The format a file name stands for, or `null` for a name that is not an outline file. `.md` is only an outline when the author says so. */
export function outlineFormatOfFile(name: string): OutlineImportFormat | null {
  const ext = /\.([^.\\/]+)$/.exec(name)?.[1]?.toLowerCase();
  if (ext === "opml") return "opml";
  if (ext === "csv") return "csv";
  if (ext === "md" || ext === "markdown") return "markdown";
  return null;
}

/** An outline file as chapters and scenes. Throws `OutlineError` (see its `code`) for a file that cannot be read, and `empty` when it holds no chapter. */
export function parseOutline(text: string, format: OutlineImportFormat): ParsedOutline {
  const parsed =
    format === "opml" ? fromOpml(text) : format === "csv" ? fromCsv(text) : fromMarkdown(text);
  if (!parsed.chapters.length)
    throw new OutlineError("empty", "The file holds no chapters or scenes");
  return parsed;
}

/** One chapter of an imported outline, ready to be written as a chapter file. */
export interface OutlinePage {
  title: string;
  doc: ChapterDoc;
  sceneCount: number;
}

export interface OutlinePages {
  pages: OutlinePage[];
  warnings: OutlineWarning[];
}

/**
 * The parsed outline as chapter documents: a level 1 heading, then one `scene` for each scene with its notes (title, synopsis,
 * POV, status, label, target, date) and an empty paragraph to write in. Every scene gets a new id from `newId`, whatever the
 * file carried, so importing into a book that already has these scenes never makes two with the same id. The cast is not
 * kept (the file names characters and the book's codex may not know them) and one warning says so. A chapter with no
 * title is called `untitled`.
 */
export function outlineToPages(
  parsed: ParsedOutline,
  newId: () => string,
  untitled = "Untitled",
): OutlinePages {
  // The ids are replaced, so a complaint about one would be about something that is not kept either way.
  const warnings = parsed.warnings.filter((w) => w.code !== "bad-id" && w.code !== "duplicate-id");
  let cast = 0;
  const pages = parsed.chapters.map((c): OutlinePage => {
    const title = c.title || untitled;
    return {
      title,
      sceneCount: c.scenes.length,
      doc: {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: title }] },
          ...(c.scenes.length
            ? c.scenes.map((s): DocNode => {
                if (s.castIds.length || s.castNames.length) cast++;
                return {
                  type: "scene",
                  attrs: {
                    id: newId(),
                    title: s.title,
                    synopsis: s.synopsis,
                    pov: s.pov,
                    status: s.status,
                    label: s.label,
                    target: s.target,
                    date: s.date,
                  },
                  content: [{ type: "paragraph" }],
                };
              })
            : [{ type: "paragraph" } satisfies DocNode]),
        ],
      },
    };
  });
  if (cast)
    warnings.push({
      code: "cast-skipped",
      message: `${cast} scene(s) name characters; the cast was not imported (add characters to the codex and pick them in the scene)`,
    });
  return { pages, warnings };
}
