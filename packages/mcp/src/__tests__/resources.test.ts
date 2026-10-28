import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ noDocs: false }));
vi.mock("node:fs", async (orig) => {
  const real = await orig<typeof import("node:fs")>();
  return {
    ...real,
    existsSync: (p: Parameters<typeof real.existsSync>[0]) =>
      fake.noDocs && String(p).includes("docs") ? false : real.existsSync(p),
  };
});

import { type Session, connect } from "./helpers";

let s: Session;
afterEach(async () => {
  fake.noDocs = false;
  await s.close();
});

const read = (uri: string) => s.client.readResource({ uri });

describe("documentation resources", () => {
  it("are read from the checkout named by CADABRA_REPO, or from next to the package", async () => {
    s = await connect();
    const fromRepo = await read("cadabra://docs/file-format");
    expect((fromRepo.contents[0] as { text: string }).text).toContain("cadabra.json");
    await s.close();
    s = await connect({ repo: null });
    const fromPackage = await read("cadabra://docs/import");
    expect(fromPackage.contents[0]!.mimeType).toBe("text/markdown");
  });

  it("say where to look when the checkout has a docs folder without the file", async () => {
    const repo = mkdtempSync(join(tmpdir(), "mcp-docs-"));
    mkdirSync(join(repo, "docs"));
    s = await connect({ repo });
    await expect(read("cadabra://docs/file-format")).rejects.toThrow(
      /was not found; set CADABRA_REPO/,
    );
  });

  it("say so when there is no docs folder anywhere", async () => {
    s = await connect({ repo: null });
    fake.noDocs = true;
    await expect(read("cadabra://docs/import")).rejects.toThrow(/docs\/import\.md was not found/);
  });
});
