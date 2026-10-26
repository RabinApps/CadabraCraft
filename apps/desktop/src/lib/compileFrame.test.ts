import { describe, expect, it } from "vitest";
import { packCompileRequest } from "./compileFrame";

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
      typstPath: "/opt/homebrew/bin/typst",
      source: '#set page(width: 5in)\nHello, "wörld" ✓',
      files: [["assets/img-1.png", Uint8Array.of(1, 2, 3)], ["assets/img-2.jpg", Uint8Array.of(255, 0)]],
      pdfA: true,
    });
    const { header, files, rest } = unpack(frame);
    expect(header).toMatchObject({ typstPath: "/opt/homebrew/bin/typst", pdfA: true, source: '#set page(width: 5in)\nHello, "wörld" ✓' });
    expect(files).toEqual([["assets/img-1.png", [1, 2, 3]], ["assets/img-2.jpg", [255, 0]]]);
    expect(rest).toBe(0);
  });
  it("works with no files, no typst path and empty files", () => {
    const { header, files, rest } = unpack(packCompileRequest({ typstPath: null, source: "", files: [["a.bin", new Uint8Array()]], pdfA: false }));
    expect(header).toMatchObject({ typstPath: null, source: "", pdfA: false });
    expect(files).toEqual([["a.bin", []]]);
    expect(rest).toBe(0);
    expect(unpack(packCompileRequest({ typstPath: null, source: "x", files: [], pdfA: false })).files).toEqual([]);
  });
  it("copes with a large image without building a number array", () => {
    const big = new Uint8Array(5 * 1024 * 1024).fill(7);
    const frame = packCompileRequest({ typstPath: null, source: "x", files: [["assets/big.png", big]], pdfA: false });
    expect(frame.length).toBeGreaterThan(big.length);
    expect(frame[frame.length - 1]).toBe(7);
  });
});
