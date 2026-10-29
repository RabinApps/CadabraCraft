/**
 * The closing block of every document: an invisible `<page-report>` metadata element holding the physical page count and where each
 * page entry (the `<chapter-start>` marks, in document order) starts and ends (the paired `<chapter-end>` marks), with the page number printed there. Read with `typst query`,
 * so a book can be measured without producing a PDF.
 *
 * With `marks` the report also lists the page marks (see `PdfOptions.blockMarks`) as tuples in document order: `("s", chapter, block, kind, page)`
 * where a block starts and `("w", word, page)` for a word mark that is on a different page than the mark before it.
 *
 * Numbers follow the preamble: lowercase roman before the `<numbering-arabic>` mark (only when there is front matter), arabic after;
 * "" on pages that show no folio (title and copyright pages) and for every page when page numbers are off.
 */
export function pageReport(hasFront: boolean, pageNumbers: boolean, marks = false): string {
  const numbered = pageNumbers ? "true" : "false";
  return `
#context {
  let total = here().page()
  let arabic = query(<numbering-arabic>).map(m => m.location().page())
  let first-arabic = if arabic.len() > 0 { arabic.first() } else { total + 1 }
  let hidden = no-folio-pages()
  let ends = query(<chapter-end>).map(m => m.location().page())
  let starts = query(<chapter-start>).enumerate().map(((i, m)) => {
    let loc = m.location()
    let pg = loc.page()
    let last = if i < ends.len() { calc.max(pg, ends.at(i)) } else { pg }
    let fmt = if ${hasFront ? "true" : "false"} and pg < first-arabic { "i" } else { "1" }
    let number = if ${numbered} and not (pg in hidden) { numbering(fmt, ..counter(page).at(loc)) } else { "" }
    (id: m.value.id, kind: m.value.kind, page: pg, end: last, number: number)
  })
${
  marks
    ? `  let marks = ()
  let prev = 0
  for m in query(<bm>) {
    let v = m.value
    let pg = m.location().page()
    if type(v) == int { if pg != prev { marks.push(("w", v, pg)) } }
    else { marks.push(("s", v.at(1), v.at(2), v.at(3), pg)) }
    prev = pg
  }
`
    : ""
}  [#metadata((total: total, starts: starts${marks ? ", marks: marks" : ""}))<page-report>]
}
`;
}
