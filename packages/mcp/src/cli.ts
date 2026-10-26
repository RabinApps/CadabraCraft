// Entry point: `node dist/cli.js [workspace-root]` (or CADABRA_MCP_ROOT). Speaks MCP over stdio, so nothing but
// protocol messages may go to stdout; diagnostics go to stderr.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server";

const fail = (msg: string): never => {
  process.stderr.write(`cadabracraft-mcp: ${msg}\nUsage: cadabracraft-mcp <workspace-root>   (or set CADABRA_MCP_ROOT)\n`);
  process.exit(1);
};

process.on("unhandledRejection", (e) => process.stderr.write(`cadabracraft-mcp: unhandled rejection: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`));
process.on("uncaughtException", (e) => process.stderr.write(`cadabracraft-mcp: uncaught exception: ${e.stack ?? e.message}\n`));

const root = process.argv[2] ?? process.env.CADABRA_MCP_ROOT ?? "";
try {
  const server = createServer({ root, repo: process.env.CADABRA_REPO || null });
  await server.connect(new StdioServerTransport());
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
