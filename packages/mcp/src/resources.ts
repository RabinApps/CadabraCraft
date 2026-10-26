import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ToolError } from "./errors";
import type { Ctx } from "./tooling";

const DOCS = [
  { name: "file-format", file: "file-format.md", title: "CadabraCraft project file format", description: "Folder layout, manifest, chapter files, assets, writes and conflicts." },
  { name: "import", file: "import.md", title: "Markdown and .docx import", description: "Import mappings, warnings catalogue and limits (what chapter_write_markdown and import_file do)." },
] as const;

/** docs/ of the checkout: `<CADABRA_REPO>/docs`, else relative to this package (packages/mcp/{src,dist} -> ../../../docs). */
function docsDir(ctx: Ctx): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  return [ctx.repo ? join(ctx.repo, "docs") : null, resolve(here, "../../../docs")].find((d): d is string => !!d && existsSync(d)) ?? null;
}

export function registerResources(server: McpServer, ctx: Ctx): void {
  for (const doc of DOCS) {
    const uri = `cadabra://docs/${doc.name}`;
    server.registerResource(doc.name, uri, { title: doc.title, description: doc.description, mimeType: "text/markdown" }, async (url) => {
      const dir = docsDir(ctx);
      const file = dir ? join(dir, doc.file) : null;
      if (!file || !existsSync(file)) throw new ToolError("not_found", `docs/${doc.file} was not found; set CADABRA_REPO to the CadabraCraft checkout`);
      return { contents: [{ uri: url.href, mimeType: "text/markdown", text: readFileSync(file, "utf8") }] };
    });
  }
}
