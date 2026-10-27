import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "fflate";
import { createServer, type ServerOptions } from "../server";

export const REPO = fileURLToPath(new URL("../../../../", import.meta.url)).replace(/[\\/]$/, "");
export const FIXTURES = join(REPO, "fixtures/manuscripts");
export const fullBook = (): { title: string; author: string; language: string; chapters: { id: string; title: string; doc: unknown }[] } =>
  JSON.parse(readFileSync(join(FIXTURES, "full-book.json"), "utf8"));
export const sampleChapter = (): unknown => JSON.parse(readFileSync(join(FIXTURES, "sample-chapter.json"), "utf8"));
export const gradientPng = (): Buffer => readFileSync(join(FIXTURES, "assets/gradient.png"));

export const tmpRoot = (): string => realpathSync(mkdtempSync(join(tmpdir(), "cadabra-mcp-")));

export interface Result {
  isError: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  texts: string[];
}

export interface Session {
  root: string;
  client: Client;
  call: (name: string, args?: Record<string, unknown>) => Promise<Result>;
  /** Calls and asserts success. */
  ok: (name: string, args?: Record<string, unknown>) => Promise<Result["data"]>;
  close: () => Promise<void>;
}

export async function connect(opts: Partial<ServerOptions> & { root?: string } = {}): Promise<Session> {
  const root = opts.root ?? tmpRoot();
  const server = createServer({ repo: REPO, ...opts, root });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(ct);
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<Result> => {
    const r = await client.callTool({ name, arguments: args });
    const content = (r.content ?? []) as { type: string; text?: string }[];
    const texts = content.filter((c) => c.type === "text").map((c) => c.text ?? "");
    return { isError: r.isError === true, data: r.structuredContent, texts };
  };
  const ok = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await call(name, args);
    if (r.isError) throw new Error(`${name} failed: ${r.texts.join(" | ")}`);
    return r.data;
  };
  return { root, client, call, ok, close: () => client.close() };
}

/** Creates a project with the full-book chapters and its image, through the tools. */
export async function seedBook(s: Session, path = "book"): Promise<{ path: string; ids: string[] }> {
  const book = fullBook();
  await s.ok("cadabra_project_create", { path, title: book.title, author: book.author, language: book.language });
  mkdirSync(join(s.root, path, "assets"), { recursive: true });
  const { storeImage } = await import("@cadabracraft/project-fs");
  storeImage(join(s.root, path), "gradient.png", gradientPng());
  const ids: string[] = [];
  for (const c of book.chapters) {
    const added = await s.ok("cadabra_chapter_add", { path, title: c.title });
    await s.ok("cadabra_chapter_write_json", { path, chapterId: added.chapter.id, doc: c.doc });
    ids.push(added.chapter.id);
  }
  return { path, ids };
}

/** Every file under `dir` with its size, as a sorted listing, to prove nothing was written. */
export function snapshot(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else out.push(`${relative(dir, p).split(sep).join("/")}:${st.size}:${readFileSync(p).toString("hex").slice(0, 64)}`);
    }
  };
  walk(dir);
  return out;
}

/** Minimal valid .docx with the given body XML. */
export function makeDocx(body: string, media: Record<string, Uint8Array> = {}, rels = ""): Uint8Array {
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  return zipSync({
    "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'),
    "_rels/.rels": strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    "word/document.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document ${NS}><w:body>${body}<w:sectPr/></w:body></w:document>`),
    "word/styles.xml": strToU8(`<?xml version="1.0"?><w:styles ${NS}><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/></w:style></w:styles>`),
    "word/_rels/document.xml.rels": strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`),
    ...Object.fromEntries(Object.entries(media).map(([k, v]) => [`word/media/${k}`, v])),
  });
}
export const docxPara = (text: string, style?: string): string =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t>${text}</w:t></w:r></w:p>`;

export const has = (cmd: string, args: string[] = ["--version"]): boolean => {
  try {
    return spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
};
export const hasTypst = (): boolean => has("typst") || existsSync("/opt/homebrew/bin/typst");
export const hasPoppler = (): boolean => has("pdfinfo", ["-v"]) || existsSync("/opt/homebrew/bin/pdfinfo");
export const epubcheckJar = (): string | null => {
  const jar = process.env.EPUBCHECK_JAR ?? join(REPO, "tools/epubcheck-5.4.0/epubcheck.jar");
  return existsSync(jar) ? jar : null;
};
