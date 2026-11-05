import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { Outline } from "./outline";
import {
  OutlineError,
  checkChapters,
  checkSize,
  chapterTitle,
  createCleaner,
  type ParsedChapter,
  type ParsedOutline,
} from "./parsed";

/** The namespace of the scene fields no outliner knows: `cc:id`, `cc:pov`, `cc:status` and so on. */
export const OPML_NAMESPACE = "https://cadabracraft.app/ns/outline/1";

// XML 1.0 allows tab, line feed, carriage return and the characters from space up, minus the surrogates and U+FFFE/FFFF.
// eslint-disable-next-line no-control-regex -- intentional: this is the list of characters XML cannot hold
const NOT_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

/** Text for an attribute value: the five XML specials, line breaks as references (an attribute value cannot hold a raw one). */
const esc = (s: string): string =>
  s
    .replace(NOT_XML, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\r/g, "&#13;")
    .replace(/\n/g, "&#10;")
    .replace(/\t/g, "&#9;");

const attr = (name: string, value: string): string =>
  value === "" ? "" : ` ${name}="${esc(value)}"`;

/**
 * The outline as OPML 2.0: each chapter is a top-level `outline`, its scenes are the children. `text` is the title and `_note`
 * the synopsis (what OmniOutliner, Bike and other outliners show as a note). The scene fields no outliner has are attributes in
 * the `cc` namespace, including the scene `id` so a later import can recognise the scene.
 */
export function toOpml(outline: Outline): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<opml version="2.0" xmlns:cc="${OPML_NAMESPACE}">`,
    "  <head>",
    `    <title>${esc(outline.title)}</title>`,
    ...(outline.author ? [`    <ownerName>${esc(outline.author)}</ownerName>`] : []),
    "  </head>",
    "  <body>",
  ];
  for (const c of outline.chapters) {
    const open = `    <outline text="${esc(c.title)}"${attr("cc:id", c.id)} cc:words="${c.words}"`;
    if (!c.scenes.length) {
      lines.push(`${open}/>`);
      continue;
    }
    lines.push(`${open}>`);
    for (const s of c.scenes) {
      lines.push(
        `      <outline text="${esc(s.title)}"${attr("_note", s.synopsis)}${attr("cc:id", s.id)}${attr("cc:pov", s.pov)}${attr("cc:status", s.status)}${attr("cc:label", s.label)}${s.target === null ? "" : ` cc:target="${s.target}"`}${attr("cc:date", s.date)}${attr("cc:cast", s.cast.map((m) => m.id).join(" "))}${attr("cc:castNames", s.cast.map((m) => m.name).join(", "))} cc:words="${s.words}"/>`,
      );
    }
    lines.push("    </outline>");
  }
  lines.push("  </body>", "</opml>", "");
  return lines.join("\n");
}

interface XmlOutline {
  outline?: XmlOutline[];
  [attribute: string]: string | XmlOutline[] | undefined;
}
const attrOf = (o: XmlOutline, name: string): string | undefined => {
  const v = o[name];
  return typeof v === "string" ? v : undefined;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: true,
  htmlEntities: true,
  isArray: (name) => name === "outline",
});

/**
 * Reads an OPML outline: top-level outlines are chapters, their children scenes. Anything deeper is left out with a warning.
 * Files from other outliners work too (they carry titles and notes only); the `cc:` fields are read when present. Throws
 * `OutlineError` for text that is not well-formed XML, not OPML, has a DOCTYPE or entity declaration, or is too large.
 */
export function fromOpml(input: string): ParsedOutline {
  checkSize(input);
  if (/<!(DOCTYPE|ENTITY)/i.test(input))
    throw new OutlineError(
      "malformed",
      "The file declares a DOCTYPE or entities, which are not read",
    );
  const valid = XMLValidator.validate(input);
  if (valid !== true)
    throw new OutlineError("malformed", `The file is not well-formed XML: ${valid.err.msg}`);
  const root = (parser.parse(input) as { opml?: { body?: XmlOutline } }).opml;
  if (!root) throw new OutlineError("not-opml", "The file is not OPML (it has no opml element)");
  const top = root.body?.outline ?? [];
  checkChapters(top.length);
  const cleaner = createCleaner();
  let deeper = 0;
  const chapters: ParsedChapter[] = top.map((c) => ({
    title: chapterTitle(attrOf(c, "text")),
    scenes: (c.outline ?? []).map((s) => {
      deeper += countOutlines(s.outline);
      return cleaner.scene({
        id: attrOf(s, "id"),
        title: attrOf(s, "text"),
        synopsis: attrOf(s, "_note"),
        pov: attrOf(s, "pov"),
        status: attrOf(s, "status"),
        label: attrOf(s, "label"),
        target: attrOf(s, "target"),
        date: attrOf(s, "date"),
        castIds: attrOf(s, "cast")?.split(/\s+/),
      });
    }),
  }));
  if (deeper) cleaner.warn("ignored", `${deeper} outline(s) nested below a scene were left out`);
  return { chapters, warnings: cleaner.warnings };
}

const countOutlines = (list: XmlOutline[] | undefined): number =>
  (list ?? []).reduce((n, o) => n + 1 + countOutlines(o.outline), 0);
