// Shared by every template. Class names match packages/export-epub (small-caps, underline, scene-break, noteref).
const BASE = `.small-caps{font-variant:small-caps}.underline{text-decoration:underline}
a.noteref{font-size:.75em;vertical-align:super;line-height:0}
code{font-family:monospace;font-size:.9em}
pre{font-family:monospace;font-size:.85em;white-space:pre-wrap;overflow-wrap:anywhere;margin:1em 0;text-indent:0;text-align:left}pre code{font-size:1em}sup,sub{font-size:.75em;line-height:0}
img{max-width:100%;height:auto}figure{margin:1.5em 0;text-align:center;page-break-inside:avoid}
figcaption{font-size:.85em;margin-top:.4em}
ul,ol{margin:.6em 0;padding-left:1.6em}li>p{text-indent:0}
aside ol{font-size:.85em}
table{width:100%;table-layout:fixed;border-collapse:collapse;margin:1.2em 0;font-size:.9em}
th,td{border:1px solid #888;padding:.3em .5em;text-align:left;vertical-align:top;word-wrap:break-word;overflow-wrap:break-word}
th{font-weight:bold}td p,th p{margin:0;text-indent:0}td p+p,th p+p{margin-top:.4em}tr{page-break-inside:avoid}
h1,h2,h3{page-break-after:avoid;break-after:avoid}
body.title-page,body.dedication,body.epigraph{text-align:center}
body.title-page h1{margin:30% 0 .5em}body.title-page p,body.dedication p,body.epigraph p,body.copyright p{text-indent:0}
body.dedication,body.epigraph{margin-top:25%}body.dedication p{font-style:italic}
body.copyright{font-size:.85em}body.copyright p{margin:0 0 .4em}`;

export const NOVEL_CSS = `body{font-family:serif;line-height:1.4}
h1{font-size:1.6em;text-align:center;font-weight:normal;margin:3em 0 2em}
h2{font-size:1.2em;text-align:center;font-weight:normal;font-variant:small-caps;margin:2em 0 1em}
h3{font-size:1em;font-style:italic;font-weight:normal;margin:1.5em 0 .75em}
p{margin:0;text-indent:1.4em}h1+p,h2+p,h3+p,hr+p,blockquote+p{text-indent:0}
blockquote{margin:1em 1.5em;font-size:.95em}blockquote p{text-indent:0}
hr.scene-break{border:0;text-align:center;margin:1.5em 0;height:1em}hr.scene-break:after{content:"* * *";letter-spacing:.3em}
${BASE}`;

export const NONFICTION_CSS = `body{font-family:serif;line-height:1.45;counter-reset:chapter}
h1{font-size:1.8em;font-weight:bold;text-align:left;margin:2.5em 0 1em;padding-bottom:.3em;border-bottom:.08em solid currentColor}
body.chapter h1{counter-increment:chapter}
body.chapter h1:before{content:"Chapter " counter(chapter);display:block;font-size:.5em;font-weight:normal;letter-spacing:.12em;text-transform:uppercase;margin-bottom:.4em}
h2{font-size:1.3em;font-weight:bold;margin:2em 0 .6em}
h3{font-size:1.05em;font-weight:bold;font-style:italic;margin:1.5em 0 .5em}
p{margin:0 0 .9em;text-indent:0}
blockquote{margin:1.2em 0;padding:.6em 1em;border-left:.25em solid #888;background:rgba(128,128,128,.08)}blockquote p:last-child{margin-bottom:0}
hr.scene-break{border:0;text-align:center;margin:1.5em 0;height:1em}hr.scene-break:after{content:"\\2042"}
${BASE}`;

export const POETRY_CSS = `body{font-family:serif;line-height:1.6}
h1{font-size:1.6em;text-align:center;font-weight:normal;margin:3.5em 0 2.5em}
h2{font-size:1.1em;text-align:center;font-style:italic;font-weight:normal;margin:2em 0 1em}
h3{font-size:1em;font-style:italic;text-align:center;font-weight:normal;margin:1.5em 0 .75em}
p{margin:0 0 .7em;text-indent:0}
blockquote{margin:1em 2em;font-style:italic}blockquote p{margin-bottom:.4em}
hr.scene-break{border:0;text-align:center;margin:2em 0;height:1em}hr.scene-break:after{content:"*   *   *";letter-spacing:.2em}
${BASE}`;

export const MODERN_CSS = `body{font-family:sans-serif;line-height:1.5}
h1{font-size:1.9em;font-weight:600;text-align:left;margin:3em 0 1.2em;letter-spacing:-.01em}
h2{font-size:1.25em;font-weight:600;margin:2em 0 .6em}
h3{font-size:1em;font-weight:600;margin:1.5em 0 .5em}
p{margin:0 0 1em;text-indent:0}
blockquote{margin:1.2em 0;padding:0 0 0 1.2em;border-left:.15em solid currentColor}blockquote p{margin-bottom:.5em}
hr.scene-break{border:0;margin:2em 0;height:0;border-top:.05em solid #999;width:3em}
${BASE}`;

/** Chapter-opening rules generated from template data, so the EPUB follows `chapterOpening.dropCap` and `.ornament`. */
export function openingCss(o: { dropCap: boolean; ornament: string | null }): string {
  const drop = o.dropCap
    ? "body.chapter h1+p::first-letter{float:left;font-size:3.2em;line-height:.8;padding:.05em .08em 0 0}"
    : "";
  const orn =
    o.ornament === null
      ? ""
      : `body.chapter h1::before{content:"${o.ornament}";display:block;text-align:center;font-size:1.2em;margin-bottom:.6em}`;
  return drop + orn;
}
