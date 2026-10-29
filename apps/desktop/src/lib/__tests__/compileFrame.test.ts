import { describe, expect, it } from "vitest";
import { packCompileRequest, packQueryRequest } from "../compileFrame";

/** Reads the layout back the way the Rust side does. */
function unpack(frame: Uint8Array) {
  const headerLen = new DataView(frame.buffer, frame.byteOffset).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(frame.subarray(4, 4 + headerLen)));
  let at = 4 + headerLen;
  const files = (header.files as { name: string; len: number }[]).map((f) => {
    const bytes = frame.subarray(at, at + f.len);
    at += f.len;
    return [f.name, [...bytes]] as const;
  });
  return { header, files, rest: frame.length - at };
}

describe("packCompileRequest", () => {
  it("carries the options, the source and every file's bytes in order", () => {
    const frame = packCompileRequest({
      source: '#set page(width: 5in)\nHello, "wörld" ✓',
      files: [
        ["assets/img-1.png", Uint8Array.of(1, 2, 3)],
        ["assets/img-2.jpg", Uint8Array.of(255, 0)],
      ],
      pdfA: true,
    });
    const { header, files, rest } = unpack(frame);
    expect(header).toEqual({
      files: [
        { name: "assets/img-1.png", len: 3 },
        { name: "assets/img-2.jpg", len: 2 },
      ],
      pdfA: true,
      source: '#set page(width: 5in)\nHello, "wörld" ✓',
    });
    expect(files).toEqual([
      ["assets/img-1.png", [1, 2, 3]],
      ["assets/img-2.jpg", [255, 0]],
    ]);
    expect(rest).toBe(0);
  });
  it("works with empty files and never names a program", () => {
    const { header, files, rest } = unpack(
      packCompileRequest({
        source: "",
        files: [["a.bin", new Uint8Array()]],
        pdfA: false,
      }),
    );
    expect(header).toEqual({ source: "", pdfA: false, files: [{ name: "a.bin", len: 0 }] });
    expect(files).toEqual([["a.bin", []]]);
    expect(rest).toBe(0);
    expect(unpack(packCompileRequest({ source: "x", files: [], pdfA: false })).files).toEqual([]);
  });
  it("copes with a large image without building a number array", () => {
    const big = new Uint8Array(5 * 1024 * 1024).fill(7);
    const frame = packCompileRequest({
      source: "x",
      files: [["assets/big.png", big]],
      pdfA: false,
    });
    expect(frame.length).toBeGreaterThan(big.length);
    expect(frame[frame.length - 1]).toBe(7);
  });
});

describe("packQueryRequest", () => {
  it("carries the selector, the source and every file's bytes in order, with no pdfA", () => {
    const { header, files, rest } = unpack(
      packQueryRequest({
        source: "#metadata(1) <page-report>",
        files: [
          ["assets/a.png", Uint8Array.of(4, 5)],
          ["b.bin", new Uint8Array()],
        ],
        selector: "<page-report>",
      }),
    );
    expect(header).toEqual({
      source: "#metadata(1) <page-report>",
      selector: "<page-report>",
      files: [
        { name: "assets/a.png", len: 2 },
        { name: "b.bin", len: 0 },
      ],
    });
    expect(files).toEqual([
      ["assets/a.png", [4, 5]],
      ["b.bin", []],
    ]);
    expect(rest).toBe(0);
  });
});
