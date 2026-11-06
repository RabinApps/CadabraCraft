import { describe, expect, it } from "vitest";
import type { DocNode } from "@cadabracraft/shared";
import { RtfExportError, approximateWords, authorSurname, buildRtf } from "../index";
import { picture } from "../image";
import { para, paraOpen } from "../paragraphs";
import type { Ctx } from "../types";
import {
  t,
  p,
  chapter,
  image,
  book,
  build,
  one,
  message,
  png,
  pngOf,
  jpegOf,
  checkRtf,
} from "./rtfFixtures";

describe("images", () => {
  const assets = new Map([["assets/a.png", png]]);
  const imageDoc = (src: string, extra: Record<string, string | null> = {}): DocNode =>
    image({ src, alt: "alt", ...extra });
  it("embeds a PNG as hex with its size, and a caption from the title", () => {
    const d2 = build([chapter("A", imageDoc("assets/a.png", { title: "Fig <1>" }))], { assets });
    checkRtf(d2);
    expect(d2).toContain("\\pngblip\\picw");
    expect(d2).toContain("\\picwgoal15\\pichgoal15\n");
    expect(d2).toContain(Buffer.from(png).toString("hex").slice(0, 64));
    expect(d2).toContain("\\keepn");
    expect(d2).toContain("\\i Fig <1>\\par");
  });
  it("writes the alt text as the picture's wzDescription property, escaped, and nothing for a decorative image", () => {
    const d = build([chapter("A", imageDoc("assets/a.png", { alt: "A {quay} \\ café" }))], {
      assets,
    });
    checkRtf(d);
    expect(d).toContain(
      "{\\pict{\\*\\picprop\\shplid1025{\\sp{\\sn shapeType}{\\sv 75}}{\\sp{\\sn wzDescription}{\\sv A \\{quay\\} \\\\ caf\\u233?}}}\\pngblip",
    );
    const decorative = build([chapter("A", imageDoc("assets/a.png", { alt: "" }))], { assets });
    expect(decorative).toContain("{\\pict\\pngblip");
    expect(decorative).not.toContain("picprop");
    const flagged = build(
      [chapter("A", imageDoc("assets/a.png", { alt: "ignored", decorative: true } as never))],
      { assets },
    );
    expect(flagged).not.toContain("picprop");
    const bad = chapter("A", imageDoc("assets/a.png", { alt: "x\u0001" }));
    expect(message(() => build([bad], { assets }))).toContain("An image description");
  });
  it("scales wide and tall images to the text area and writes JPEGs", () => {
    const wide = new Map([["assets/w.png", pngOf(2000, 100)]]);
    const w = build([chapter("A", imageDoc("assets/w.png"))], { assets: wide });
    expect(w).toContain("\\picwgoal9360\\pichgoal468");
    const tall = new Map([["assets/t.jpg", jpegOf(100, 2000)]]);
    const tl = build([chapter("A", imageDoc("assets/t.jpg"))], { assets: tall });
    expect(tl).toContain("\\jpegblip");
    expect(tl).toContain("\\pichgoal12960");
    checkRtf(tl);
  });
  it("wraps picture data in 64-byte lines", () => {
    const d = build([chapter("A", imageDoc("assets/a.png"))], { assets });
    const data = d.slice(d.indexOf("\\pichgoal")).split("\n").slice(1);
    expect(data.length).toBeGreaterThan(1);
    expect(data[0]!.length).toBe(128);
  });
  it("refuses images RTF cannot hold and says why", () => {
    const ctx = (a: Map<string, Uint8Array>): Ctx => ({
      s: { assets: a, pendingBreak: false },
      chapter: "C",
      quote: 0,
      list: 0,
      inNote: false,
      runProps: {},
    });
    const fail = (src: string, a = new Map<string, Uint8Array>()) =>
      message(() => picture(src, ctx(a)));
    expect(fail("http://x/a.png")).toContain("not a project image");
    expect(fail("assets/a.txt")).toContain("unsupported type");
    expect(fail("assets/a.svg")).toContain("an SVG");
    expect(fail("assets/a.gif")).toContain("a GIF");
    expect(fail("assets/a.webp")).toContain("a WEBP");
    expect(fail("assets/a.png")).toContain("missing");
    expect(fail("assets/a.png", new Map([["assets/a.png", new Uint8Array(40)]]))).toContain(
      "not a readable PNG",
    );
    expect(fail("assets/a.jpg", new Map([["assets/a.jpg", new Uint8Array(40)]]))).toContain(
      "not a readable JPEG",
    );
    expect(fail("assets/a.png", new Map([["assets/a.png", pngOf(0, 10)]]))).toContain(
      "not a readable PNG",
    );
    expect(message(() => one(image()))).toContain("not a project image");
    expect(message(() => one(imageDoc("assets/a.png", { title: "x\u0001" })))).toContain("missing");
    expect(
      message(() =>
        build([chapter("A", imageDoc("assets/a.png", { title: "x\u0001" }))], { assets }),
      ),
    ).toContain("An image caption");
  });
  it("reads JPEG headers past other segments and refuses ones without a frame header", () => {
    const seg = (marker: number, len: number, ...rest: number[]): number[] => [
      0xff,
      marker,
      len >> 8,
      len & 255,
      ...rest,
    ];
    const ok = new Uint8Array([
      0xff,
      0xd8,
      0x00,
      0x00, // junk before a marker
      0xff,
      0xff, // fill byte
      ...seg(0xe0, 4, 0, 0),
      0xff,
      0x01, // standalone marker
      ...seg(0xc4, 4, 0, 0), // DHT is not a frame header
      ...seg(0xc2, 11, 8, 0, 20, 0, 30, 0, 0, 0),
      0,
      0,
      0,
    ]);
    const a = new Map([["assets/o.jpg", ok]]);
    expect(build([chapter("A", imageDoc("assets/o.jpg"))], { assets: a })).toContain(
      "\\picwgoal450\\pichgoal300",
    );
    const none = new Map([
      ["assets/n.jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0, 0, 0, 0, 0])],
    ]);
    expect(
      message(() => build([chapter("A", imageDoc("assets/n.jpg"))], { assets: none })),
    ).toContain("not a readable JPEG");
    const short = new Map([["assets/s.jpg", new Uint8Array([0xff, 0xd8])]]);
    expect(
      message(() => build([chapter("A", imageDoc("assets/s.jpg"))], { assets: short })),
    ).toContain("not a readable JPEG");
  });
});

describe("paragraph helpers", () => {
  it("paraOpen consumes the pending break once", () => {
    const ctx: Ctx = {
      s: { assets: new Map(), pendingBreak: true },
      chapter: "C",
      quote: 0,
      list: 0,
      inNote: false,
      runProps: {},
    };
    expect(paraOpen({}, ctx)).toContain("\\pagebb");
    expect(paraOpen({ bold: true, italic: true, cell: true, mono: true, size: 20 }, ctx)).toBe(
      "\\pard\\plain\\intbl\\f1\\fs20\\sl480\\slmult1\\sb0\\sa0\\li0\\ri0\\fi720\\ql\\b\\i",
    );
    expect(para("x", {}, ctx)).toMatch(/^\{\\pard.* x\\par\}$/);
  });
  it("author surnames and word counts", () => {
    expect(authorSurname("Ada Lovelace")).toBe("Lovelace");
    expect(authorSurname("Martin Luther King Jr.")).toBe("King");
    expect(authorSurname("Lovelace, Ada")).toBe("Ada");
    expect(authorSurname("Madonna")).toBe("Madonna");
    expect(authorSurname("")).toBe("");
    expect(authorSurname("Jr")).toBe("Jr");
    expect(approximateWords(99)).toBe(99);
    expect(approximateWords(149)).toBe(100);
    expect(approximateWords(150)).toBe(200);
  });
  it("RtfExportError carries the page and node", () => {
    const e = new RtfExportError("boom", { chapter: "Ch", node: "image" });
    expect(e.chapter).toBe("Ch");
    expect(e.node).toBe("image");
    expect(e.message).toBe("In “Ch”: boom");
    expect(new RtfExportError("plain").message).toBe("plain");
  });
});

describe("scenes", () => {
  it("prints a scene's blocks and none of its notes", () => {
    const out = buildRtf(book, [
      chapter("One", {
        type: "scene",
        attrs: {
          id: "sc-1",
          title: "Secret title",
          synopsis: "Plans",
          status: "draft",
          target: 800,
        },
        content: [p(t("In the scene."))],
      }),
    ]);
    expect(out).toContain("In the scene.");
    expect(out).not.toContain("Secret title");
  });
});
