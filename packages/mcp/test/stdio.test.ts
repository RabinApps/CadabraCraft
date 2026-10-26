import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { tmpRoot } from "./helpers";

const pkg = fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]$/, "");
const cli = join(pkg, "dist/cli.js");

beforeAll(() => {
  execFileSync(process.execPath, [join(pkg, "scripts/build.mjs")], { cwd: pkg, stdio: "pipe" });
});

const env = (extra: Record<string, string> = {}): Record<string, string> => {
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== "CADABRA_MCP_ROOT") base[k] = v;
  return { ...base, ...extra };
};

describe("built server over stdio", () => {
  it("builds a self-contained dist/cli.js with a shebang", () => {
    expect(existsSync(cli)).toBe(true);
    expect(readFileSync(cli, "utf8").startsWith("#!/usr/bin/env node\n")).toBe(true);
  });

  it("lists tools and runs project_create + project_info (root from CADABRA_MCP_ROOT)", async () => {
    const root = tmpRoot();
    const client = new Client({ name: "smoke", version: "0.0.0" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [cli], env: env({ CADABRA_MCP_ROOT: root, CADABRA_REPO: join(pkg, "../..") }), stderr: "pipe" }));
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain("cadabra_project_create");
      expect(tools.length).toBe(17);
      const created = await client.callTool({ name: "cadabra_project_create", arguments: { path: "smoke", title: "Smoke", author: "Test" } });
      expect(created.isError).not.toBe(true);
      const info = await client.callTool({ name: "cadabra_project_info", arguments: { path: "smoke" } });
      expect(info.isError).not.toBe(true);
      expect((info.structuredContent as { manifest: { title: string } }).manifest.title).toBe("Smoke");
      const escaped = await client.callTool({ name: "cadabra_project_info", arguments: { path: "../x" } });
      expect(escaped.isError).toBe(true);
      const doc = await client.readResource({ uri: "cadabra://docs/file-format" });
      expect(String((doc.contents[0] as { text: string }).text)).toContain("formatVersion");
    } finally {
      await client.close();
    }
  });

  it("takes the root as the first CLI argument", async () => {
    const root = tmpRoot();
    const client = new Client({ name: "smoke", version: "0.0.0" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [cli, root], env: env(), stderr: "pipe" }));
    try {
      const r = await client.callTool({ name: "cadabra_project_create", arguments: { path: "arg", title: "T", author: "A" } });
      expect(r.isError).not.toBe(true);
      expect(existsSync(join(root, "arg/cadabra.json"))).toBe(true);
    } finally {
      await client.close();
    }
  });

  it("exits with a clear error when no root is configured or the root is unusable", () => {
    const none = spawnSync(process.execPath, [cli], { env: env(), encoding: "utf8" });
    expect(none.status).toBe(1);
    expect(none.stderr).toContain("CADABRA_MCP_ROOT");
    expect(none.stdout).toBe("");
    const bad = spawnSync(process.execPath, [cli, "/definitely/not/here"], { env: env(), encoding: "utf8" });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("workspace");
    expect(bad.stdout).toBe("");
  });
});
