import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { openWorkspace } from "@cadabracraft/project-fs";
import { registerResources } from "./resources";
import { type Ctx, registerTools } from "./tooling";
import { chapterTools } from "./tools/chapters";
import { exportTools } from "./tools/export";
import { importTools } from "./tools/import";
import { projectTools } from "./tools/project";
import { errMsg } from "@cadabracraft/shared";

export interface ServerOptions {
  /** Workspace root: every path a caller supplies must resolve inside it. */
  root: string;
  /** CadabraCraft checkout (CADABRA_REPO): docs/ and tools/epubcheck-5.4.0 are looked up here. */
  repo?: string | null;
  /** Explicit EPUBCheck jar; `null` disables it. Default: EPUBCHECK_JAR, then `<repo>/tools/...`. */
  epubcheckJar?: string | null;
  /** Explicit typst binary. Default: TYPST_BIN, PATH, Homebrew locations. */
  typstBin?: string;
  /** Directory with poppler's tools; `null` treats poppler as not installed. */
  popplerDir?: string | null;
}

const INSTRUCTIONS = `Tools to create, edit, import and export CadabraCraft books (a project is a folder with cadabra.json and chapter JSON files) without the app.
All paths are relative to the workspace root (or absolute inside it); anything outside is refused.
Typical flow: cadabra_project_create or cadabra_import_file, then cadabra_chapter_add / cadabra_chapter_write_markdown, cadabra_project_validate, cadabra_export_epub / cadabra_export_pdf / cadabra_export_markdown.
Nothing is deleted for good: removed chapters go to .cadabra/trash/, replaced chapter text is kept in .cadabra/backups/, exports go to exports/.
Read cadabra://docs/file-format and cadabra://docs/import for the format and the Markdown mappings. Errors are tool errors with a stable code.`;

/** Builds the MCP server (not yet connected). Throws a clear Error when the root is missing or unusable. */
export function createServer(opts: ServerOptions): McpServer {
  if (!opts.root) throw new Error("A workspace root is required: set CADABRA_MCP_ROOT or pass the folder as the first argument");
  let ws;
  try {
    ws = openWorkspace(opts.root);
  } catch (e) {
    throw new Error(`Invalid workspace root: ${errMsg(e)}`);
  }
  const ctx: Ctx = { ws, repo: opts.repo ?? null, epubcheckJar: opts.epubcheckJar, typstBin: opts.typstBin, popplerDir: opts.popplerDir };
  const server = new McpServer({ name: "cadabracraft", version: "0.0.0" }, { instructions: INSTRUCTIONS });
  registerTools(server, ctx, [...projectTools, ...chapterTools, ...importTools, ...exportTools]);
  registerResources(server, ctx);
  return server;
}
