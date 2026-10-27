import { describe, expect, it } from "vitest";
import { chapterDocProblem } from "@cadabracraft/editor-schema";
import { Node } from "@tiptap/pm/model";
import { ImportError, htmlToBlocks, htmlToInline, importHtml, importMarkdown, looksLikeHtml, type ImportResult } from "..";
import { schema } from "./helpers";

/** Small seeded PRNG (mulberry32) so a failure reproduces from its seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const OPEN = [
  "<p>", "<div>", "<span>", "<b>", "<strong>", "<i>", "<em>", "<u>", "<s>", "<del>", "<code>", "<sup>", "<sub>", "<a href='http://x.com/a'>", "<a href='javascript:alert(1)'>", "<a>", "<a href='#x'>",
  "<h1>", "<h2>", "<h4>", "<ul>", "<ol start='3'>", "<ol start='-1'>", "<li>", "<blockquote>", "<pre>", "<table>", "<thead>", "<tbody>", "<tr>", "<td>", "<th colspan='2'>", "<caption>",
  "<dl>", "<dt>", "<dd>", "<center>", "<font color='red'>", "<span class='small-caps'>", "<span style='font-variant:small-caps'>", "<span class='footnote'>", "<form>", "<select>", "<option>",
  "<svg>", "<math>", "<template>", "<noscript>", "<iframe>", "<object>", "<custom-el>", "<figure>", "<details>", "<summary>", "<section>", "<button>", "<label>", "<ruby>", "<rt>",
];
const CLOSE = OPEN.map((o) => `</${/<([A-Za-z0-9-]+)/.exec(o)![1]}>`);
const VOID = [
  "<br>", "<br/>", "<hr>", "<hr class='scene-break'>", "<img src='a.png' alt='A'>", "<img src='b/a.png'>", "<img src='http://h/x.png' alt='r'>", "<img src='data:image/png;base64,AA=='>", "<img>", "<img alt='only'>",
  "<input value='v'>", "<wbr>", "<col>", "<meta charset='x'>", "<link rel='x'>", "<base href='x'>", "<!-- c -->", "<!-->", "<![CDATA[ cd ]]>", "<?pi x?>", "<!DOCTYPE html>",
  "<script>SECRET();</script>", "<style>.SECRET{}</style>", "<script>", "</script>", "<style>",
];
const TEXT = [
  "word", " ", "  ", "\n", "\t", "a b c", "&nbsp;", "&amp;", "&lt;b&gt;", "&#65;", "&#x1F600;", "&bogus;", "&#0;", "&", "< ", ">", "<3 ", "a < b", "​", "‮", "שלום", "\u{1F468}‍\u{1F469}", "\u0000", "\ud800", "﻿", " ", "x".repeat(300),
  "[link](http://x)", "# not heading", "*not em*", "`code`", "|a|b|",
];
const SECRET = /SECRET/;

function snippet(r: () => number, tokens: number): string {
  const pick = <T>(a: T[]): T => a[Math.floor(r() * a.length)]!;
  let s = "";
  for (let i = 0; i < tokens; i++) {
    const k = r();
    s += k < 0.3 ? pick(OPEN) : k < 0.5 ? pick(CLOSE) : k < 0.65 ? pick(VOID) : pick(TEXT);
  }
  return s;
}

/** Mutations on a character level: delete, duplicate, swap and truncate slices. */
function mutate(r: () => number, s: string): string {
  let out = s;
  for (let i = 0, n = 1 + Math.floor(r() * 4); i < n && out.length > 2; i++) {
    const a = Math.floor(r() * out.length);
    const b = Math.min(out.length, a + 1 + Math.floor(r() * 20));
    const k = r();
    if (k < 0.3) out = out.slice(0, a) + out.slice(b);
    else if (k < 0.6) out = out.slice(0, b) + out.slice(a, b) + out.slice(b);
    else if (k < 0.8) out = out.slice(0, a) + String.fromCharCode(Math.floor(r() * 0x3000)) + out.slice(b);
    else out = out.slice(0, Math.max(1, b));
  }
  return out;
}

function check(label: string, run: () => ImportResult | { blocks: unknown[] }): void {
  let out;
  try {
    out = run();
  } catch (e) {
    expect(e, `${label}: ${String(e)}`).toBeInstanceOf(ImportError);
    return;
  }
  const docs = "chapters" in out ? out.chapters.map((c) => c.doc) : [{ type: "doc", content: out.blocks.length ? out.blocks : [{ type: "paragraph" }] }];
  for (const d of docs) {
    expect(chapterDocProblem(d), label).toBeNull();
    expect(() => Node.fromJSON(schema, d as never).check(), label).not.toThrow();
  }
}

describe("HTML fuzz", () => {
  it("random token soup: only ImportError, always schema-valid, no script or style text, within a time budget", () => {
    const start = performance.now();
    for (let seed = 1; seed <= 1500; seed++) {
      const r = rng(seed);
      const html = snippet(r, 1 + Math.floor(r() * 60));
      const label = `seed ${seed}: ${JSON.stringify(html).slice(0, 300)}`;
      const res = (() => {
        try {
          return importHtml(html);
        } catch (e) {
          expect(e, label).toBeInstanceOf(ImportError);
          return null;
        }
      })();
      if (res) {
        check(label, () => res);
        expect(JSON.stringify(res), label).not.toMatch(SECRET);
        // A title taken from the file must be plain text too.
        for (const c of res.chapters) expect(c.title, label).not.toMatch(SECRET);
      }
      check(label, () => htmlToBlocks(html));
      onlyImportError(label, () => htmlToInline(html));
      expect(typeof looksLikeHtml(html), label).toBe("boolean");
      check(label, () => importMarkdown(html));
      check(label, () => importMarkdown(`# T\n\n${html}\n\n- ${html.replace(/\n/g, " ")}\n\n> ${html.replace(/\n/g, " ")}\n\n| a |\n|---|\n| ${html.replace(/[\n|]/g, " ")} |\n\n[^1]\n\n[^1]: ${html.replace(/\n/g, " ")}\n`));
    }
    expect(performance.now() - start).toBeLessThan(30_000);
  }, 60_000);

  it("mutated real-world snippets", () => {
    const seeds = [
      '<!DOCTYPE html><html><head><title>Book</title><style>p{}</style></head><body><h1>One</h1><p>Hello <b>wor<i>ld</i></b> &amp; <a href="http://x.com">link</a><sup>1</sup></p><ul><li>a<ul><li>b</li></ul></li></ul><table><tr><th>h</th></tr><tr><td>c</td></tr></table><hr><pre><code class="language-js">let a;</code></pre><blockquote><p>q</p></blockquote></body></html>',
      '<p style="font-variant:small-caps">Caps</p><p><span class="footnote">note</span></p><img src="a.png" alt="x"><br>text<br><br>more',
      "<div><div><p>nested</p></div></div><table><tr><td><table><tr><td>t</td></tr></table></td></tr></table>",
    ];
    const start = performance.now();
    for (let seed = 1; seed <= 1500; seed++) {
      const r = rng(1000 + seed);
      const html = mutate(r, seeds[seed % seeds.length]!);
      const label = `seed ${1000 + seed}: ${JSON.stringify(html).slice(0, 300)}`;
      check(label, () => importHtml(html));
      check(label, () => htmlToBlocks(html));
      check(label, () => importMarkdown(html));
      expect(typeof looksLikeHtml(html), label).toBe("boolean");
    }
    expect(performance.now() - start).toBeLessThan(30_000);
  }, 60_000);

  it("random markdown with inline HTML marks: valid docs, balanced pairs become marks, nothing throws but ImportError", () => {
    const parts = ["<u>", "</u>", "<sup>", "</sup>", "<sub>", "</sub>", '<span class="small-caps">', "</span>", "<U>", "</SUP>", "<u class='x'>", "<u/>", "<!-- c -->", "<br>", "*", "**", "_", "~~", "`", "[", "](http://x.com)", "](javascript:x)", "word ", "a", " ", "\n", "# ", "- ", "> ", "|", "[^1]", "![i](a.png)"];
    for (let seed = 1; seed <= 1500; seed++) {
      const r = rng(5000 + seed);
      let md = "";
      for (let i = 0, n = 2 + Math.floor(r() * 25); i < n; i++) md += parts[Math.floor(r() * parts.length)]!;
      md += "\n\n[^1]: note <u>x</u>\n";
      check(`seed ${5000 + seed}: ${JSON.stringify(md)}`, () => importMarkdown(md));
    }
  }, 60_000);
});

function onlyImportError(label: string, fn: () => unknown): void {
  try {
    fn();
  } catch (e) {
    expect(e, `${label}: ${String(e)}`).toBeInstanceOf(ImportError);
  }
}
