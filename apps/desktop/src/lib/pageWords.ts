/** A word of the chapter's text from where the page begins on: its text and where it is (a document position). */
export interface DocWord {
  text: string;
  pos: number;
}

/** A word as it is compared: letters and digits only, in lower case (punctuation, quotes and the hyphen at a line end differ between the PDF and the text). */
const norm = (s: string): string =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");

interface Item {
  n: string;
  /** Index among the words it came from. */
  i: number;
}

const items = (words: readonly string[]): Item[] =>
  words.map((w, i) => ({ n: norm(w), i })).filter((x) => x.n !== "");

/** Longest run of the words of `doc` that the words of `page` from `at` on spell, a word the PDF broke at a line end counting as its pieces. */
function agree(page: Item[], at: number, doc: Item[]): number {
  let i = at;
  let n = 0;
  for (const d of doc) {
    let joined = page[i]?.n ?? "";
    while (
      joined !== "" &&
      joined.length < d.n.length &&
      d.n.startsWith(joined) &&
      i + 1 < page.length
    )
      joined += page[++i]!.n;
    if (joined !== d.n) break;
    i++;
    n++;
  }
  return n;
}

/** How many words of page furniture (a running head, a folio, the repeated header of a table) or of text the PDF has no room for are looked past. */
const SKIP = 8;
/** How many words must agree to take the start of the page's text for found. */
const LEAD = 3;

/**
 * The word of the chapter's text under a click on a page of the PDF. `page` is the words of the PDF page in drawing order (running
 * head and folio among them) and `clicked` the one that was clicked; `doc` is the chapter's words from the text that begins the page
 * on. The two are walked together: words that spell the same go together, a word the PDF split at a line end (or a drop cap) matches
 * its pieces, and a few words in one that the other does not have (the head, the folio, a footnote) are skipped. Returns the index in
 * `doc`, or null when the page and the text do not line up (then the caller keeps the start of the page).
 */
export function alignWord(
  page: readonly string[],
  clicked: number,
  doc: readonly string[],
): number | null {
  const p = items(page);
  const d = items(doc);
  if (d.length === 0) return null;
  // Where the page's text begins: the first place the first words of the text are spelled out (after the running head).
  const lead = d.slice(0, LEAD);
  let i = -1;
  for (let at = 0; at < Math.min(p.length, SKIP * 2); at++)
    if (agree(p, at, lead) === lead.length) {
      i = at;
      break;
    }
  if (i < 0) return null;
  let j = 0;
  while (i < p.length && j < d.length) {
    const pieces = (() => {
      let joined = p[i]!.n;
      let k = i;
      while (joined.length < d[j]!.n.length && d[j]!.n.startsWith(joined) && p[k + 1])
        joined += p[++k]!.n;
      return joined === d[j]!.n ? k : -1;
    })();
    if (pieces >= 0) {
      // The clicked word is one of the pieces of this word.
      for (let k = i; k <= pieces; k++) if (p[k]!.i === clicked) return d[j]!.i;
      i = pieces + 1;
      j++;
      continue;
    }
    // Out of step: look a few words ahead in the text, then in the page, for where they meet again.
    const ahead = d.findIndex((x, k) => k > j && k <= j + SKIP && agree(p, i, [x]) === 1);
    const furniture = p.findIndex((x, k) => k > i && k <= i + SKIP && agree(p, k, [d[j]!]) === 1);
    if (furniture >= 0 && (ahead < 0 || furniture - i <= ahead - j)) {
      // The words of the page that were skipped are not text of the chapter: a click on one gives no word.
      for (let k = i; k < furniture; k++) if (p[k]!.i === clicked) return null;
      i = furniture;
    } else if (ahead >= 0) {
      j = ahead;
    } else return null;
  }
  return null;
}
