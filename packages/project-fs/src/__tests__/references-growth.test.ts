import { mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// A file whose size was small at the check but that is larger when read (it grew, or the stat lied).
vi.mock("node:fs", async (orig) => {
  const fs = await orig<typeof import("node:fs")>();
  return {
    ...fs,
    statSync: ((p: string, ...rest: unknown[]) => {
      const st = (fs.statSync as (...a: unknown[]) => import("node:fs").Stats)(p, ...rest);
      return String(p).endsWith("grows.txt") ? Object.assign(Object.create(st), { size: 1 }) : st;
    }) as typeof fs.statSync,
  };
});

const { importReference } = await import("../index");

describe("importReference while the source grows", () => {
  it("stops at the cap and leaves no temp file", () => {
    const root = mkdtempSync(join(tmpdir(), "pfs-grow-"));
    const p = join(mkdtempSync(join(tmpdir(), "pfs-grow-src-")), "grows.txt");
    writeFileSync(p, Buffer.alloc(5 * 1024 * 1024 + 1, 97));
    expect(statSync(p).size).toBe(1);
    expect(() => importReference(root, p)).toThrow(/larger than 5 MB/);
    expect(readdirSync(join(root, "references"))).toEqual([]);
  });
});
