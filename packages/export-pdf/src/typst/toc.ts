import { contentsLines, CONTENTS_MAX_INDENT, CONTENTS_MAX_LEVEL } from "@cadabracraft/format";
import { typstString } from "../escape";
import { PdfExportError } from "../errors";
import type { PdfTocItem } from "../types";
import { em } from "./units";

/**
 * The Contents page. The list is Typst code that runs in one `context`: it looks up where each entry landed through the
 * `<chapter-start>` marks (pages, by entry id) and the `<toc-heading>` marks (headings, by item key) and prints the number the footer
 * would print there (roman before the `<numbering-arabic>` mark, arabic after). Typst lays the book out again until the list and the
 * numbers agree, so a list that grows by a page moves the roman numbers, and the arabic ones never depend on it.
 */

/** Items as `entry id -> heading position in the chapter (extractOutline `index`) -> item key`: the headings that get a `toc-heading` mark. Hidden items are included, a custom entry may point at one. */
export function tocHeadingKeys(items: readonly PdfTocItem[]): Map<string, Map<number, string>> {
  const out = new Map<string, Map<number, string>>();
  for (const i of items) {
    if (i.kind !== "heading" || i.entryId === undefined || i.index === undefined) continue;
    const list = out.get(i.entryId) ?? new Map<number, string>();
    out.set(i.entryId, list.set(i.index, i.key));
  }
  return out;
}

/** The visible items as a Typst array of `(key, level, title, target)`; `target` is the key whose page the entry shows, or `none`. */
export function tocEntries(items: readonly PdfTocItem[]): string {
  const rows = contentsLines(items).map(({ item: i, title }) => {
    if (!Number.isInteger(i.level) || i.level < 0 || i.level > CONTENTS_MAX_LEVEL)
      throw new PdfExportError(`Contents entry "${i.key}": level ${i.level} is not 0 to 3`);
    const indent = i.indent ?? i.level;
    if (!Number.isInteger(indent) || indent < 0 || indent > CONTENTS_MAX_INDENT)
      throw new PdfExportError(`Contents entry "${i.key}": indent ${indent} is not 0 to 4`);
    const target = i.kind === "custom" ? i.target : i.key;
    return `  (key: ${typstString(i.key)}, level: ${indent}, title: ${typstString(title)}, target: ${target === undefined ? "none" : typstString(target)}),`;
  });
  return rows.length === 0 ? "()" : `(\n${rows.join("\n")}\n)`;
}

/** Helper functions of the Contents page (the entries use an explicit `par` because a `set par` inside their block gives wrapped lines no hanging indent, checked with Typst 0.15); written only when the book has one (front matter, so the book is numbered in roman up to the arabic mark). */
export function tocDefs(sinkEm: number, numbers: boolean): string {
  return `#let toc-numbers = ${numbers}
#let toc-targets() = {
  let t = (:)
  for m in query(<chapter-start>) { if m.value.id not in t { t.insert(m.value.id, m.location()) } }
  for m in query(<toc-heading>) { if m.value.key not in t { t.insert(m.value.key, m.location()) } }
  t
}
#let toc-list(entries) = context {
  let targets = toc-targets()
  let arabic = query(<numbering-arabic>).map(m => m.location().page())
  let first-arabic = if arabic.len() > 0 { arabic.first() } else { 1000000 }
  let hidden = no-folio-pages()
  for e in entries {
    let loc = if e.target != none and e.target in targets { targets.at(e.target) } else { none }
    let number = if toc-numbers and loc != none and not (loc.page() in hidden) {
      numbering(if loc.page() < first-arabic { "i" } else { "1" }, ..counter(page).at(loc))
    } else { "" }
    let ind = 1.4em * e.level
    // explicit par(): a set rule inside the block gives the wrapped lines no hanging indent
    // the title is an internal link to the place it lists (an entry that links nowhere is plain text); a link may not hold an artifact, so the dots and number sit outside it
    let label = if e.level > 0 { text(size: 0.92em, e.title) } else { e.title }
    block(above: 0.55em, below: 0.55em, width: 100%, par(first-line-indent: 0pt, justify: false, hanging-indent: ind + 1.2em, {
      h(ind)
      if loc != none { link(loc, label) } else { label }
      if number != "" {
        h(0.4em)
        // the dot leaders are decoration: an artifact is not read out between the title and the number
        pdf.artifact(box(width: 1fr, repeat(gap: 0.3em)[.]))
        h(0.4em)
        number
      }
    }))
  }
}
#let contents-page(id, kind, entries, body) = {
  pagebreak(weak: true)
  matter-marks(id, kind, "folio-off-start", "folio-off-end", {
    v(${em(sinkEm)})
    body
    v(1em)
    toc-list(entries)
  })
}
`;
}
