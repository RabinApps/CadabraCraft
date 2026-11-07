import { describe, expect, it } from "vitest";
import { decodeDocxImport } from "../export/docxFrame";

/** The writer of `import_docx::frame::encode` in Rust, for the tests: header length (little endian), JSON header, image bytes. */
function frame(header: unknown, ...images: number[][]): Uint8Array {
  const h = new TextEncoder().encode(typeof header === "string" ? header : JSON.stringify(header));
  const out = new Uint8Array(4 + h.length + images.reduce((n, i) => n + i.length, 0));
  new DataView(out.buffer).setUint32(0, h.length, true);
  out.set(h, 4);
  let at = 4 + h.length;
  for (const i of images) {
    out.set(i, at);
    at += i.length;
  }
  return out;
}

const asset = (name: string, len: number) => ({
  sourcePath: `word/media/${name}`,
  targetPath: `assets/${name}`,
  mediaType: "image/png",
  len,
});
const doc = { type: "doc", content: [{ type: "paragraph" }] };

describe("decodeDocxImport", () => {
  it("reads chapters, warnings and each image's bytes in order", () => {
    const warning = { code: "w", severity: "info", message: "m", count: 1 };
    const r = decodeDocxImport(
      frame(
        {
          chapters: [{ title: "One", doc }],
          warnings: [warning],
          assets: [asset("a.png", 3), asset("b.png", 1)],
        },
        [1, 2, 3],
        [9],
      ),
    );
    expect(r.chapters).toEqual([{ title: "One", doc }]);
    expect(r.warnings).toEqual([warning]);
    expect(r.assets.map((a) => [a.sourcePath, a.targetPath, a.mediaType])).toEqual([
      ["word/media/a.png", "assets/a.png", "image/png"],
      ["word/media/b.png", "assets/b.png", "image/png"],
    ]);
    expect(Array.from(r.assets[0]!.bytes!)).toEqual([1, 2, 3]);
    expect(Array.from(r.assets[1]!.bytes!)).toEqual([9]);
  });

  it("reads a reply that sits inside a larger buffer", () => {
    const inner = frame({ chapters: [], warnings: [], assets: [asset("a.png", 1)] }, [7]);
    const padded = new Uint8Array(inner.length + 10);
    padded.set(inner, 5);
    const r = decodeDocxImport(padded.subarray(5, 5 + inner.length));
    expect(Array.from(r.assets[0]!.bytes!)).toEqual([7]);
  });

  it("accepts an empty result", () => {
    const r = decodeDocxImport(frame({ chapters: [], warnings: [], assets: [] }));
    expect(r).toEqual({ chapters: [], warnings: [], assets: [] });
  });

  it.each([
    ["too short", new Uint8Array([1, 2])],
    [
      "a header past the end",
      (() => {
        const f = frame({ chapters: [], warnings: [], assets: [] });
        new DataView(f.buffer).setUint32(0, 9999, true);
        return f;
      })(),
    ],
    ["a header that is not JSON", frame("{nope")],
    ["a header without the lists", frame({ chapters: [] })],
    [
      "an image past the end",
      frame({ chapters: [], warnings: [], assets: [asset("a.png", 5)] }, [1]),
    ],
    ["a negative length", frame({ chapters: [], warnings: [], assets: [asset("a.png", -1)] })],
    ["a fractional length", frame({ chapters: [], warnings: [], assets: [asset("a.png", 0.5)] })],
    ["extra bytes", frame({ chapters: [], warnings: [], assets: [asset("a.png", 1)] }, [1, 2])],
  ])("refuses %s", (_name, body) => {
    expect(() => decodeDocxImport(body)).toThrow(/reply is damaged/);
  });

  it("names a header that is not an Error when it fails to parse", () => {
    const orig = JSON.parse;
    JSON.parse = () => {
      throw "plain string";
    };
    try {
      expect(() => decodeDocxImport(frame({ chapters: [], warnings: [], assets: [] }))).toThrow(
        /bad header/,
      );
    } finally {
      JSON.parse = orig;
    }
  });
});
