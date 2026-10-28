import { t } from "@lingui/core/macro";
import { EpubExportError } from "@cadabracraft/export-epub";

/**
 * Turns an EPUB exporter refusal into a translated message that names the page and where in it the problem is.
 * `fileOf` finds a page's file name, used when the page has no title. Anything else is returned unchanged.
 */
export function describeEpubError(
  e: unknown,
  fileOf: (id: string) => string | undefined = () => undefined,
): unknown {
  if (!(e instanceof EpubExportError)) return e;
  const { chapter, nodeType, path } = e.where;
  const page = chapter ? chapter.title.trim() || fileOf(chapter.id) || chapter.id : "";
  const kind = nodeType ?? "";
  const place = path ?? "";
  const cause = { cause: e };
  switch (e.code) {
    case "unsupported-node":
      return new Error(
        page
          ? t`“${page}” has a “${kind}” the EPUB export cannot write (at ${place}). The export stopped so nothing is lost.`
          : t`The book has a “${kind}” the EPUB export cannot write (at ${place}). The export stopped so nothing is lost.`,
        cause,
      );
    case "unsupported-mark":
      return new Error(
        page
          ? t`“${page}” uses a text style the EPUB export cannot write: ${kind} (at ${place}). The export stopped so nothing is lost.`
          : t`The book uses a text style the EPUB export cannot write: ${kind} (at ${place}). The export stopped so nothing is lost.`,
        cause,
      );
    default: {
      const detail = e.detail;
      return new Error(page ? t`“${page}”: ${detail}` : detail, cause);
    }
  }
}
