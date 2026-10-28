import { esc, XML_HEAD } from "./xml";

export type ManuscriptFont = "times" | "courier";

export const FONT_NAMES: Record<ManuscriptFont, string> = {
  times: "Times New Roman",
  courier: "Courier New",
};

export const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** Page geometry in twips (1/1440 in): US Letter, 1 inch margins. */
export const PAGE = { width: 12240, height: 15840, margin: 1440, header: 720 } as const;
/** Text width between the margins, in twips. */
export const TEXT_WIDTH = PAGE.width - 2 * PAGE.margin;
/** 0.5 inch first-line indent. */
export const INDENT = 720;
/** Double line spacing (240 = single). */
export const DOUBLE = 480;

export const contentTypes = (imageTypes: ReadonlyMap<string, string>): string =>
  `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${[...imageTypes].map(([ext, type]) => `<Default Extension="${ext}" ContentType="${type}"/>`).join("")}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/header2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;

export const packageRels = (): string =>
  `${XML_HEAD}<Relationships xmlns="${NS_REL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`;

export interface Rel {
  id: string;
  type: string;
  target: string;
  external?: boolean;
}

export const documentRels = (rels: Rel[]): string =>
  `${XML_HEAD}<Relationships xmlns="${NS_REL}">${rels.map((r) => `<Relationship Id="${r.id}" Type="${REL}/${r.type}" Target="${esc(r.target)}"${r.external ? ' TargetMode="External"' : ""}/>`).join("")}</Relationships>`;

const isoNoMs = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, "Z");

export const coreProps = (
  title: string,
  author: string,
  language: string,
  modified: Date,
): string =>
  `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>${esc(author)}</dc:creator><dc:language>${esc(language)}</dc:language><dcterms:created xsi:type="dcterms:W3CDTF">${isoNoMs(modified)}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${isoNoMs(modified)}</dcterms:modified></cp:coreProperties>`;

export const appProps = (): string =>
  `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>CadabraCraft</Application></Properties>`;

export const settings = (): string =>
  `${XML_HEAD}<w:settings xmlns:w="${NS_W}"><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;

export const footnotesPart = (notes: string[]): string =>
  `${XML_HEAD}<w:footnotes xmlns:w="${NS_W}" xmlns:r="${NS_R}"><w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>${notes.join("")}</w:footnotes>`;

/** Empty header (used by the title page section). */
export const emptyHeader = (): string =>
  `${XML_HEAD}<w:hdr xmlns:w="${NS_W}"><w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr></w:p></w:hdr>`;

/** Running header "Surname / TITLE / page", right aligned. `label` is "Surname / TITLE / " or "TITLE / ". */
export const runningHeader = (label: string): string =>
  `${XML_HEAD}<w:hdr xmlns:w="${NS_W}"><w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr><w:r><w:t xml:space="preserve">${esc(label)}</w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:hdr>`;

/** Bullet (num 1) and numbered (abstract 1) list definitions; each numbered list gets its own `num` so it restarts. */
export function numberingPart(
  font: string,
  orderedStarts: ReadonlyArray<{ numId: number; start: number }>,
): string {
  const lvl = (i: number, fmt: string, text: string) =>
    `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (i + 1)}" w:hanging="360"/></w:pPr>${fmt === "bullet" ? `<w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}" w:hint="default"/></w:rPr>` : ""}</w:lvl>`;
  const levels = Array.from({ length: 9 }, (_, i) => i);
  const bullets = levels.map((i) => lvl(i, "bullet", i % 2 === 0 ? "•" : "–")).join("");
  const FORMATS = ["decimal", "lowerLetter", "lowerRoman"];
  const numbers = levels.map((i) => lvl(i, FORMATS[i % 3]!, `%${i + 1}.`)).join("");
  return `${XML_HEAD}<w:numbering xmlns:w="${NS_W}"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${bullets}</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${numbers}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>${orderedStarts
    .map(
      (o) =>
        `<w:num w:numId="${o.numId}"><w:abstractNumId w:val="1"/>${levels.map((i) => `<w:lvlOverride w:ilvl="${i}"><w:startOverride w:val="${i === 0 ? o.start : 1}"/></w:lvlOverride>`).join("")}</w:num>`,
    )
    .join("")}</w:numbering>`;
}

/** Styles for the standard manuscript format: 12 pt, double spaced, left aligned, 0.5 in first-line indent. */
export function stylesPart(fontName: string, language: string): string {
  const f = `<w:rFonts w:ascii="${fontName}" w:hAnsi="${fontName}" w:eastAsia="${fontName}" w:cs="${fontName}"/>`;
  const mono = FONT_NAMES.courier;
  const para = (id: string, name: string, ppr: string, rpr = "", extra = "") =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/>${id === "Normal" ? "" : '<w:basedOn w:val="Normal"/>'}${extra}<w:qFormat/>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ""}${rpr ? `<w:rPr>${rpr}</w:rPr>` : ""}</w:style>`;
  const single = '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>';
  const none = '<w:ind w:left="0" w:firstLine="0"/>';
  const heading = (n: number, ppr: string) =>
    para(
      `Heading${n}`,
      `heading ${n}`,
      `<w:keepNext/><w:keepLines/>${single.replace('w:line="240"', `w:line="${DOUBLE}"`)}${none}${ppr}<w:outlineLvl w:val="${n - 1}"/>`,
      "",
      '<w:next w:val="Normal"/>',
    );
  return (
    `${XML_HEAD}<w:styles xmlns:w="${NS_W}"><w:docDefaults><w:rPrDefault><w:rPr>${f}<w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="${esc(language)}" w:eastAsia="${esc(language)}" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:widowControl/><w:spacing w:before="0" w:after="0" w:line="${DOUBLE}" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:firstLine="${INDENT}"/><w:jc w:val="left"/></w:pPr></w:style>` +
    `<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/></w:style>` +
    `<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>` +
    heading(1, '<w:jc w:val="center"/>') +
    heading(2, "") +
    heading(3, "") +
    para("Header", "header", `${single}${none}<w:jc w:val="right"/>`) +
    para(
      "BlockQuote",
      "Block Quote",
      `<w:ind w:left="${INDENT}" w:right="${INDENT}" w:firstLine="0"/>`,
    ) +
    para("ListParagraph", "List Paragraph", '<w:ind w:firstLine="0"/>') +
    para(
      "CodeBlock",
      "Code Block",
      `${single}${none}`,
      `<w:rFonts w:ascii="${mono}" w:hAnsi="${mono}" w:cs="${mono}"/><w:sz w:val="22"/><w:szCs w:val="22"/>`,
    ) +
    para("SceneBreak", "Scene Break", `${none}<w:jc w:val="center"/>`) +
    para("Figure", "Figure", `<w:keepNext/>${single}${none}<w:jc w:val="center"/>`) +
    para(
      "Caption",
      "caption",
      `${single}${none}<w:spacing w:before="120" w:after="240" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/>`,
      "<w:i/><w:iCs/>",
    ) +
    para("TableText", "Table Text", `${single}${none}`) +
    para("TitlePageInfo", "Title Page Info", `${single}${none}<w:jc w:val="right"/>`) +
    para(
      "Title",
      "Title",
      `<w:spacing w:before="0" w:after="240" w:line="${DOUBLE}" w:lineRule="auto"/>${none}<w:jc w:val="center"/>`,
      "<w:b/><w:bCs/>",
      '<w:next w:val="Normal"/>',
    ) +
    para("TitlePageAuthor", "Title Page Author", `${none}<w:jc w:val="center"/>`) +
    para(
      "FootnoteText",
      "footnote text",
      `${single}${none}`,
      '<w:sz w:val="20"/><w:szCs w:val="20"/>',
    ) +
    `<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:basedOn w:val="DefaultParagraphFont"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>` +
    `<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>` +
    `<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:tblPr><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`).join("")}</w:tblBorders></w:tblPr></w:style>` +
    "</w:styles>"
  );
}
