// cli.ts run in-process (the stdio.test.ts suite runs the built copy in a child process, which coverage cannot see).
// The stdio transport, process.exit, stderr and the process-level handlers are replaced so nothing real is touched.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tmpRoot } from "./helpers";

const transport = vi.hoisted(() => ({ started: 0 }));
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: class {
    onmessage?: unknown;
    onclose?: unknown;
    onerror?: unknown;
    async start() {
      transport.started++;
    }
    async send() {}
    async close() {}
  },
}));

type Handler = (e: unknown) => void;
let handlers: Record<string, Handler>;
let stderr: string[];
let exits: (number | undefined)[];
let argv: string[];

beforeEach(() => {
  handlers = {};
  stderr = [];
  exits = [];
  transport.started = 0;
  argv = process.argv;
  vi.resetModules();
  vi.spyOn(process, "on").mockImplementation(((event: string, h: Handler) => {
    handlers[event] = h;
    return process;
  }) as never);
  vi.spyOn(process.stderr, "write").mockImplementation(((s: string) => {
    stderr.push(String(s));
    return true;
  }) as never);
  vi.spyOn(process, "exit").mockImplementation(((c?: number) => {
    exits.push(c);
  }) as never);
});

afterEach(() => {
  process.argv = argv;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const load = () => import("../cli");

describe("cli", () => {
  it("connects over stdio with the root from the first argument", async () => {
    process.argv = [argv[0]!, "cli", tmpRoot()];
    vi.stubEnv("CADABRA_REPO", "/some/checkout");
    await load();
    expect(transport.started).toBe(1);
    expect(exits).toEqual([]);
  });

  it("takes the root from CADABRA_MCP_ROOT, and runs without a checkout", async () => {
    process.argv = [argv[0]!, "cli"];
    vi.stubEnv("CADABRA_MCP_ROOT", tmpRoot());
    vi.stubEnv("CADABRA_REPO", "");
    await load();
    expect(transport.started).toBe(1);
  });

  it("explains itself and exits with 1 when there is no root", async () => {
    process.argv = [argv[0]!, "cli"];
    vi.stubEnv("CADABRA_MCP_ROOT", undefined);
    await load();
    expect(exits).toEqual([1]);
    expect(stderr.join("")).toMatch(/workspace root is required[\s\S]*Usage: cadabracraft-mcp/);
    expect(transport.started).toBe(0);
  });

  it("exits with 1 when the root is unusable", async () => {
    process.argv = [argv[0]!, "cli", "/no/such/folder/for/mcp"];
    await load();
    expect(exits).toEqual([1]);
    expect(stderr.join("")).toContain("Invalid workspace root");
  });

  it("logs unhandled rejections and uncaught exceptions to stderr, never stdout", async () => {
    process.argv = [argv[0]!, "cli", tmpRoot()];
    await load();
    handlers.unhandledRejection!(Object.assign(new Error("a"), { stack: "STACK" }));
    handlers.unhandledRejection!(Object.assign(new Error("b"), { stack: undefined }));
    handlers.unhandledRejection!("plain");
    handlers.uncaughtException!(Object.assign(new Error("c"), { stack: "STACK2" }));
    handlers.uncaughtException!(Object.assign(new Error("d"), { stack: undefined }));
    expect(stderr).toEqual([
      "cadabracraft-mcp: unhandled rejection: STACK\n",
      "cadabracraft-mcp: unhandled rejection: b\n",
      "cadabracraft-mcp: unhandled rejection: plain\n",
      "cadabracraft-mcp: uncaught exception: STACK2\n",
      "cadabracraft-mcp: uncaught exception: d\n",
    ]);
  });
});
