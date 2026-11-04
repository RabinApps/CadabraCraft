import { useMemo } from "react";
import { useLingui } from "@lingui/react/macro";
import type { EditionEntry } from "@cadabracraft/format";
import { dirFor } from "../../i18n/locales";
import { fontKindOf } from "../../lib/pageLayout";
import { contentsLayout, previewLines } from "../../lib/tocPreview";
import { useProject } from "../../state/project/index";
import { useToc } from "./useToc";

/**
 * Everything that draws the Contents page of one entry, whoever draws it: the editor (its list and its preview) and Read mode. The
 * list and its page numbers come from `useToc`; this adds the printed lines, the page layout at the book's trim size, the title and
 * the direction, so every screen starts from the same data.
 */
export function useContentsView(entry: EditionEntry, measure = true) {
  const { t } = useLingui();
  const toc = useToc(entry, measure);
  const manifest = useProject((s) => s.manifest)!;
  const layout = useMemo(() => contentsLayout(manifest), [manifest]);
  const lines = useMemo(
    () => previewLines(toc.rows, toc.settings.pageNumbers),
    [toc.rows, toc.settings.pageNumbers],
  );
  const title = entry.titles[toc.language] ?? Object.values(entry.titles)[0] ?? t`Contents`;
  const before = manifest.frontMatter.findIndex((e) => e.id === entry.id);
  const rtl = dirFor(toc.language) === "rtl";
  const serif = fontKindOf(manifest.template) === "serif";
  return { ...toc, lines, layout, title, before, rtl, serif };
}
