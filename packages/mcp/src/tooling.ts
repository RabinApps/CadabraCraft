import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Workspace } from "@cadabracraft/project-fs";
import type { z } from "zod";
import { toToolError } from "./errors";

/** Everything a tool needs from the server configuration. */
export interface Ctx {
  ws: Workspace;
  /** Repo checkout (CADABRA_REPO): where docs/ and tools/epubcheck live. */
  repo: string | null;
  /** Explicit EPUBCheck jar; `null` = none, `undefined` = look in EPUBCHECK_JAR, then `<repo>/tools`. */
  epubcheckJar?: string | null;
  /** Explicit typst binary; default is TYPST_BIN, PATH, then the usual Homebrew locations. */
  typstBin?: string;
  /** Directory holding poppler's pdfinfo/pdffonts/pdftotext; `null` = poppler unavailable; undefined = PATH + Homebrew. */
  popplerDir?: string | null;
}

export interface ToolOutput {
  /** One short line for the human or the model. */
  summary: string;
  /** Structured result, also returned as JSON text. */
  data: Record<string, unknown>;
}

export interface Annotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
}

export interface ToolDef<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  input: S;
  annotations: Annotations;
  run: (args: z.infer<z.ZodObject<S>>, ctx: Ctx) => ToolOutput | Promise<ToolOutput>;
}

/** Type helper: infers the argument type of `run` from `input`. */
export const defineTool = <S extends z.ZodRawShape>(def: ToolDef<S>): ToolDef =>
  def as unknown as ToolDef;

const text = (t: string) => ({ type: "text" as const, text: t });

export function success(out: ToolOutput): CallToolResult {
  return {
    content: [text(out.summary), text(JSON.stringify(out.data, null, 2))],
    structuredContent: out.data,
  };
}

export function failure(e: unknown): CallToolResult {
  const err = toToolError(e);
  const data = {
    error: {
      code: err.code,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    },
  };
  return {
    isError: true,
    content: [text(`${err.code}: ${err.message}`), text(JSON.stringify(data, null, 2))],
    structuredContent: data,
  };
}

export function registerTools(server: McpServer, ctx: Ctx, defs: ToolDef[]): void {
  for (const def of defs) {
    server.registerTool(
      def.name,
      {
        title: def.title,
        description: def.description,
        inputSchema: def.input,
        annotations: { title: def.title, ...def.annotations, openWorldHint: false },
      },
      async (args: unknown) => {
        try {
          return success(await def.run(args as never, ctx));
        } catch (e) {
          return failure(e);
        }
      },
    );
  }
}

const locks = new Map<string, Promise<unknown>>();

/** Runs `fn` after every earlier call with the same key has finished, so read-modify-write edits of one project never interleave. */
export function withLock<T>(key: string, fn: () => T | Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  const tail = next.catch(() => undefined);
  locks.set(key, tail);
  void tail.then(() => {
    if (locks.get(key) === tail) locks.delete(key);
  });
  return next;
}
