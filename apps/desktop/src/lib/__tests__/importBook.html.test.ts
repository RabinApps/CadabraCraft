import { sourceEdition } from "@cadabracraft/format";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { disk } from "../../test/fakeBridge";

const sources = new Map<string, Uint8Array>();
let readError: unknown = null;
let gate: Promise<void> | null = null;
const enc = (s: string) => new TextEncoder().encode(s);
vi.mock("../bridge", async () =>
  (await import("../../test/fakeBridge")).fakeBridge({
    readImportSource: async (p: string) => {
      if (gate) await gate;
      if (readError) throw readError;
      const b = sources.get(p);
      if (!b) throw new Error(`cannot read ${p}`);
      return b;
    },
    readImportImage: async () => {
      throw new Error("no image");
    },
    importAssetBytes: async () => "assets/x.png",
  }),
);

import { useProject } from "../../state/project/index";
import { decodeText, loadImport, parseText } from "../import/importBook";

const a = () => useProject.getState().actions;
const s = () => useProject.getState();
const utf16 = (str: string, le: boolean) => {
  const out = new Uint8Array(2 + str.length * 2);
  out[0] = le ? 0xff : 0xfe;
  out[1] = le ? 0xfe : 0xff;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    out[2 + i * 2 + (le ? 0 : 1)] = c & 255;
    out[3 + i * 2 - (le ? 0 : 1)] = c >> 8;
  }
  return out;
};
const titles = (bytes: Uint8Array, ext = "html") =>
  parseText({ ext, bytes }).chapters.map((c) => c.title);

beforeEach(() => {
  sources.clear();
  disk.clear();
  readError = null;
  gate = null;
  useProject.setState({
    root: null,
    manifest: null,
    currentId: null,
    currentDoc: null,
    draft: null,
    hashes: {},
    notice: "",
    reloadCount: 0,
    importReport: null,
  });
});

describe("HTML import: encodings and damaged files", () => {
  it("reads UTF-16 LE and BE files with a byte-order mark", () => {
    const html = "<h1>Café 日本</h1><p>text</p>";
    expect(titles(utf16(html, true))).toEqual(["Café 日本"]);
    expect(titles(utf16(html, false))).toEqual(["Café 日本"]);
  });
  it("strips a UTF-8 byte-order mark", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...enc("<h1>Alpha</h1><p>x</p>")]);
    expect(titles(bytes)).toEqual(["Alpha"]);
  });
  it("reads a declared legacy charset and falls back to Windows-1252 for invalid UTF-8", () => {
    const latin = Uint8Array.from([
      ...enc('<meta charset="iso-8859-1"><h1>Caf'),
      0xe9,
      ...enc("</h1><p>x</p>"),
    ]);
    expect(titles(latin)).toEqual(["Café"]);
    const undeclared = Uint8Array.from([...enc("<h1>Caf"), 0xe9, ...enc("</h1><p>x</p>")]);
    expect(titles(undeclared)).toEqual(["Café"]);
    expect(decodeText(enc("<meta charset=bogus-charset><p>é</p>"), true)).toContain("é");
  });
  it("rejects binary data with a readable message instead of importing garbage", () => {
    const binary = new Uint8Array(2000).map((_, i) => (i % 7 === 0 ? 0 : i % 251));
    expect(() => parseText({ ext: "html", bytes: binary })).toThrow(/does not look like text/);
    expect(() => parseText({ ext: "md", bytes: binary })).toThrow(/does not look like text/);
  });
  it("says there is no text for an empty or whitespace-only file", () => {
    expect(() => parseText({ ext: "html", bytes: new Uint8Array() })).toThrow(/no text/);
    expect(() => parseText({ ext: "html", bytes: enc("  \n\t ") })).toThrow(/no text/);
    expect(() =>
      parseText({
        ext: "html",
        bytes: enc("<html><head><title>x</title></head><body></body></html>"),
      }),
    ).toThrow(/no text/);
  });
  it("maps a pile of nested tags to a readable message", () => {
    expect(() => parseText({ ext: "html", bytes: enc("<div>".repeat(5000)) })).toThrow(
      /too deeply/,
    );
  });
  it("copes with a mangled, unclosed and script-only file", () => {
    expect(titles(enc("<h1>Open<p>no close <b>bold")).length).toBeGreaterThan(0);
    expect(() => parseText({ ext: "html", bytes: enc("<script>alert(1)</script>") })).toThrow(
      /no text/,
    );
  });
  it("accepts an upper-case extension and refuses unknown ones", async () => {
    sources.set("/s/A.HTML", enc("<h1>A</h1><p>x</p>"));
    expect((await loadImport("/s/A.HTML")).ext).toBe("html");
    await expect(loadImport("/s/A.exe")).rejects.toThrow(/Choose/);
    await expect(loadImport("/s/noext")).rejects.toThrow(/Choose/);
  });
});

describe("HTML import: failures and concurrency", () => {
  it("passes a read failure through as a readable error and creates nothing", async () => {
    readError = { kind: "too_large", path: "/s/big.html", max_mb: 50 };
    await expect(a().importBook("/s/big.html", "/new", "T", "A")).rejects.toBeTruthy();
    expect(disk.size).toBe(0);
    expect(s().importReport).toBeNull();
  });
  it("refuses a second import while one is running", async () => {
    sources.set("/s/a.html", enc("<h1>A</h1><p>x</p>"));
    let release!: () => void;
    gate = new Promise((r) => {
      release = r;
    });
    const first = a().importBook("/s/a.html", "/new", "T", "A");
    await expect(a().importBook("/s/a.html", "/new2", "T", "A")).rejects.toThrow(/already running/);
    release();
    await first;
    expect(sourceEdition(s().manifest!.editions).title).toBe("T");
    // And a later one works again.
    gate = null;
    await a().importBook("/s/a.html", "/new3", "T3", "A");
    expect(sourceEdition(s().manifest!.editions).title).toBe("T3");
  });
});
