import { existsSync, mkdirSync, readFileSync, readdirSync, truncateSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { decodeSourceText } from "../tools/import";
import { type Session, connect, gradientPng, snapshot } from "./helpers";

let s: Session;
afterEach(async () => {
  await s?.close();
  s = undefined as unknown as Session;
});

const page = (body: string) => `<!doctype html><html><head><title>Hostile</title></head><body>${body}</body></html>`;
const utf16le = (text: string, bom = true) => Buffer.concat([bom ? Buffer.from([0xff, 0xfe]) : Buffer.alloc(0), Buffer.from(text, "utf16le")]);
const utf16be = (text: string) => {
  const le = Buffer.from(text, "utf16le");
  for (let i = 0; i + 1 < le.length; i += 2) [le[i], le[i + 1]] = [le[i + 1]!, le[i]!];
  return Buffer.concat([Buffer.from([0xfe, 0xff]), le]);
};

describe("decodeSourceText", () => {
  it("drops UTF-8 and reads UTF-16 BOMs, refuses everything else that is not UTF-8", () => {
    expect(decodeSourceText(Buffer.from("﻿<p>é</p>"), "a.html")).toBe("<p>é</p>");
    expect(decodeSourceText(utf16le("<p>é €</p>"), "a.html")).toBe("<p>é €</p>");
    expect(decodeSourceText(utf16be("<p>é €</p>"), "a.html")).toBe("<p>é €</p>");
    expect(decodeSourceText(Buffer.alloc(0), "a.html")).toBe("");
    for (const bad of [Buffer.from([0x3c, 0x70, 0x3e, 0xe9, 0x3c]), Buffer.from([0xff, 0x00]), utf16le("<p>x</p>", false), Buffer.from([0x61, 0x00, 0x62]), Buffer.from([0xc0, 0xaf]), Buffer.from([0xff, 0xfe, 0x00])]) {
      expect(() => decodeSourceText(bad, "a.html"), bad.toString("hex")).toThrow(/cannot be read as text/);
    }
  });
});

describe("import_file (html) failures create nothing and carry stable codes", () => {
  const fails = async (file: string, bytes: Buffer | string, code: string, extra?: (r: { data: { error: { code: string; details?: Record<string, unknown> } } }) => void) => {
    writeFileSync(join(s.root, file), bytes);
    const before = snapshot(s.root);
    const r = await s.call("cadabra_import_file", { source: file, destination: "out" });
    expect(r.isError, file).toBe(true);
    expect(r.data.error.code, file).toBe(code);
    expect(existsSync(join(s.root, "out")), file).toBe(false);
    expect(snapshot(s.root), file).toEqual(before);
    extra?.(r);
  };

  it("wrong encodings: invalid UTF-8, UTF-16 without BOM", async () => {
    s = await connect();
    await fails("latin1.html", Buffer.from("<h1>Caf\xe9</h1>", "latin1"), "invalid_file");
    await fails("nobom.htm", utf16le("<h1>x</h1>", false), "invalid_file");
    await fails("latin1.md", Buffer.from("# Caf\xe9", "latin1"), "invalid_file");
  });

  it("empty, whitespace-only, comment-only and script-only files are empty_input", async () => {
    s = await connect();
    await fails("a.html", "", "empty_input");
    await fails("b.html", " \n\t", "empty_input");
    await fails("c.html", "﻿<!-- nothing -->", "empty_input");
    await fails("d.html", page("<script>alert(1)</script><style>p{}</style>"), "empty_input");
  });

  it("refuses over-nested and over-complex HTML with import_failed and the importer's code", async () => {
    s = await connect();
    await fails("deep.html", page("<div>".repeat(3000)), "import_failed", (r) => expect(r.data.error.details).toMatchObject({ importCode: "too-deeply-nested" }));
    await fails("deep2.html", "<template>".repeat(200_000), "import_failed", (r) => expect(r.data.error.details).toMatchObject({ importCode: "too-deeply-nested" }));
    const attrs = Array.from({ length: 100_000 }, (_, i) => `a${i}=1`).join(" ");
    await fails("attrs.html", page(`<p ${attrs}>x</p>`), "import_failed", (r) => expect(r.data.error.details).toMatchObject({ importCode: "input-too-large" }));
  });

  it("refuses a file over the character limit and a file over the size limit", async () => {
    s = await connect();
    await fails("big.html", page(`<p>${"a".repeat(50_000_100)}</p>`), "import_failed", (r) => expect(r.data.error.details).toMatchObject({ importCode: "input-too-large" }));
    writeFileSync(join(s.root, "huge.html"), "");
    truncateSync(join(s.root, "huge.html"), 201 * 1024 * 1024);
    const r = await s.call("cadabra_import_file", { source: "huge.html", destination: "out" });
    expect(r.data.error.code).toBe("source_invalid");
    expect(existsSync(join(s.root, "out"))).toBe(false);
  }, 60_000);

  it("keeps path escapes refused for html sources and destinations", async () => {
    s = await connect();
    writeFileSync(join(s.root, "ok.html"), page("<p>x</p>"));
    for (const [source, destination, code] of [
      ["../outside.html", "out", "path_escape"],
      ["/etc/hosts.html", "out", "path_escape"],
      ["ok.html", "../escaped", "path_escape"],
      ["ok.html", "/tmp/cadabra-escape-test", "path_escape"],
    ] as const) {
      const r = await s.call("cadabra_import_file", { source, destination });
      expect(r.data.error.code, `${source} -> ${destination}`).toBe(code);
    }
    expect(existsSync("/tmp/cadabra-escape-test")).toBe(false);
  });

  it("never writes into an existing project and leaves it byte-identical, also when the html is fine", async () => {
    s = await connect();
    await s.ok("cadabra_project_create", { path: "proj", title: "T", author: "A" });
    await s.ok("cadabra_chapter_add", { path: "proj", title: "Keep" });
    writeFileSync(join(s.root, "ok.html"), page("<h1>New</h1><p>text</p>"));
    writeFileSync(join(s.root, "bad.html"), page("<div>".repeat(3000)));
    const before = snapshot(join(s.root, "proj"));
    for (const source of ["ok.html", "bad.html"]) {
      const r = await s.call("cadabra_import_file", { source, destination: "proj" });
      expect(r.data.error.code, source).toBe("destination_not_empty");
    }
    expect(snapshot(join(s.root, "proj"))).toEqual(before);
  });

  it("an existing empty destination stays empty after a failed parse", async () => {
    s = await connect();
    mkdirSync(join(s.root, "empty"));
    writeFileSync(join(s.root, "bad.html"), page("<div>".repeat(3000)));
    const r = await s.call("cadabra_import_file", { source: "bad.html", destination: "empty" });
    expect(r.data.error.code).toBe("import_failed");
    expect(readdirSync(join(s.root, "empty"))).toEqual([]);
  });
});

describe("import_file (html) content edge cases", () => {
  it("reads UTF-16 and BOM files, keeps images safe, caps the warning report and writes valid chapters", async () => {
    s = await connect();
    mkdirSync(join(s.root, "src/img"), { recursive: true });
    writeFileSync(join(s.root, "src/img/grad.png"), gradientPng());
    const hostile = [
      '<h1>Ünïcödé 日本語</h1><p>a\u0000b ‮ rtl</p>',
      '<img src="img/grad.png" alt="ok"><img src="../secret.png"><img src="img/../../x.png"><img src="/etc/passwd.png"><img src="img\\x.png"><img src="img/missing.png">',
      '<a href="java\tscript:alert(1)">x</a>'.repeat(5000),
      "<unknown-el>t</unknown-el>".repeat(5000),
    ].join("");
    writeFileSync(join(s.root, "src/utf16.html"), utf16le(page(hostile)));
    const r = await s.ok("cadabra_import_file", { source: "src/utf16.html", destination: "out" });
    expect(r.imageCount).toBe(1);
    expect(r.warnings.length).toBeLessThan(15);
    for (const g of r.warnings) {
      expect(g.examples.length).toBeLessThanOrEqual(3);
      for (const e of g.examples) expect(e.length).toBeLessThan(300);
    }
    expect(JSON.stringify(r.warnings).length).toBeLessThan(8000);
    const m = JSON.parse(readFileSync(join(s.root, "out/cadabra.json"), "utf8"));
    const text = readFileSync(join(s.root, "out", m.chapters[0].file), "utf8");
    expect(text).toContain("Ünïcödé 日本語");
    expect(text).not.toContain("\\u0000");
    expect(readdirSync(join(s.root, "out/assets"))).toEqual(["grad.png"]);
    expect((await s.ok("cadabra_project_validate", { path: "out" })).valid).toBe(true);
    // And it exports: control characters and bad surrogates must not reach the XHTML.
    expect((await s.call("cadabra_export_epub", { path: "out" })).isError).toBe(false);
  }, 60_000);
});

describe("chapter_write_markdown with hostile inline and block HTML", () => {
  const setup = async () => {
    s = await connect();
    await s.ok("cadabra_project_create", { path: "p", title: "T", author: "A" });
    const a = await s.ok("cadabra_chapter_add", { path: "p", title: "One" });
    await s.ok("cadabra_chapter_write_markdown", { path: "p", chapterId: a.chapter.id, markdown: "# One\n\noriginal text" });
    return a.chapter.id as string;
  };
  const read = async (id: string) => JSON.stringify((await s.ok("cadabra_chapter_read", { path: "p", chapterId: id })).doc);

  it("never keeps script or style, event handlers or javascript: links, and the chapter stays valid", async () => {
    const id = await setup();
    const md = [
      "# T",
      '<script>alert("SECRET")</script>',
      "<style>.SECRET{}</style>",
      '<img src=x onerror="alert(1)">',
      '<a href="javascript:alert(1)" onclick="x()">click</a>',
      "<iframe src='http://evil'></iframe>",
      "text <u>crossed <sup>marks</u> here</sup> \u0000 \ud800 end",
      "<table><tr><td><script>SECRET</script>cell</td></tr></table>",
      "<svg onload='x'>\n<text>SECRET</text>\n</svg>",
    ].join("\n\n");
    const r = await s.ok("cadabra_chapter_write_markdown", { path: "p", chapterId: id, markdown: md });
    expect(r.warnings.length).toBeLessThan(30);
    const doc = await read(id);
    expect(doc).not.toMatch(/SECRET|onerror|onload|iframe/);
    // Inline tags other than the four mark tags stay literal text (never a link, never active markup).
    expect(doc).not.toMatch(/"type":"link"|"href"/);
    // eslint-disable-next-line no-control-regex
    expect(doc).not.toMatch(/\\u0000|\\ud800/i);
    expect(doc).toContain("cell");
    expect(doc).toContain("underline");
    expect((await s.ok("cadabra_project_validate", { path: "p" })).valid).toBe(true);
  });

  it("returns tool errors with the importer's code and leaves the chapter untouched when the HTML is refused", async () => {
    const id = await setup();
    const before = await read(id);
    const attrs = Array.from({ length: 100_000 }, (_, i) => `a${i}=1`).join(" ");
    for (const [markdown, importCode] of [
      ["<div>".repeat(5000), "too-deeply-nested"],
      [`<div ${attrs}>x</div>`, "input-too-large"],
    ] as const) {
      const r = await s.call("cadabra_chapter_write_markdown", { path: "p", chapterId: id, markdown });
      expect(r.isError).toBe(true);
      expect(r.data.error.code).toBe("import_failed");
      expect(r.data.error.details).toMatchObject({ importCode });
    }
    expect(await read(id)).toBe(before);
  });

  it("empty and whitespace-only or html-comment-only markdown is empty_input", async () => {
    const id = await setup();
    for (const markdown of ["", "  \n\n", "<!-- c -->", "<script>x</script>"]) {
      const r = await s.call("cadabra_chapter_write_markdown", { path: "p", chapterId: id, markdown });
      expect(r.data.error.code, markdown).toBe("empty_input");
    }
  });
});
