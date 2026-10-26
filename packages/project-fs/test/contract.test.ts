// Consumes fixtures/contract/*.json, the same vectors apps/desktop/src-tauri/src/project/contract_tests.rs runs.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { ProjectFsError, conflictPath, imageExt, looksLike, readRelativeImage, resolveRelative, resolveSafe, sanitizeAssetStem, storeImage, writeProjectFile } from "../src/index";

const vec = (name: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/contract/${name}.json`, import.meta.url), "utf8"));
const hex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (b) => parseInt(b, 16));
const tmp = () => mkdtempSync(join(tmpdir(), "pfs-contract-"));
const STAMP = /\d{8}-\d{4}/;

describe("contract: safe paths", () => {
  const v = vec("safe-path");
  for (const c of v.resolve as { rel: string; ok: boolean; normalized?: string }[]) {
    it(`resolve ${JSON.stringify(c.rel)} -> ${c.ok ? "ok" : "refused"}`, () => {
      if (c.ok) expect(resolveRelative("/p", c.rel)).toBe(join("/p", c.normalized!));
      else expect(() => resolveRelative("/p", c.rel)).toThrow(/unsafe project path/);
    });
  }
  for (const c of v.imageReference.reject as { reference: string; error: string }[]) {
    it(`image reference ${JSON.stringify(c.reference)} refused`, () => {
      const d = tmp();
      expect(() => readRelativeImage(join(d, "book.md"), c.reference)).toThrow(c.error);
    });
  }
});

describe("contract: symlinks", () => {
  const sym = vec("safe-path").symlinks as {
    files: string[];
    links: { at: string; to: string }[];
    cases: { rel: string; ok: boolean }[];
  };
  // D is a fresh temp dir; the project root is D/project. Links are created relative to D (`to` need not exist).
  const build = () => {
    const d = tmp();
    for (const f of sym.files) {
      mkdirSync(dirname(join(d, f)), { recursive: true });
      writeFileSync(join(d, f), "x");
    }
    for (const l of sym.links) {
      mkdirSync(dirname(join(d, l.at)), { recursive: true });
      symlinkSync(join(d, l.to), join(d, l.at));
    }
    return join(d, "project");
  };
  for (const c of sym.cases) {
    it(`resolveSafe ${JSON.stringify(c.rel)} -> ${c.ok ? "ok" : "path_escape"}`, () => {
      const root = build();
      if (c.ok) expect(() => resolveSafe(root, c.rel)).not.toThrow();
      else {
        const err = (() => { try { resolveSafe(root, c.rel); } catch (e) { return e; } })();
        expect(err).toBeInstanceOf(ProjectFsError);
        expect((err as ProjectFsError).code).toBe("path_escape");
      }
    });
  }
});

describe("contract: sanitize names", () => {
  const v = vec("sanitize-name");
  for (const c of v.stems as { stem: string; expected: string }[]) {
    it(`stem ${JSON.stringify(c.stem.slice(0, 30))}`, () => expect(sanitizeAssetStem(c.stem)).toBe(c.expected));
  }
  for (const c of v.extensions.cases as { name: string; expected: string | null }[]) {
    it(`extension of ${JSON.stringify(c.name)}`, () => expect(imageExt(c.name)).toBe(c.expected));
  }
});

describe("contract: magic bytes", () => {
  for (const c of vec("magic-bytes").cases as { name: string; ext: string; hex: string; expected: boolean }[]) {
    it(c.name, () => expect(looksLike(c.ext, hex(c.hex))).toBe(c.expected));
  }
});

describe("contract: conflict names", () => {
  const v = vec("conflict-name");
  for (const c of v.names as { rel: string; expected: string }[]) {
    it(`pure name for ${c.rel}`, () => expect(conflictPath(c.rel, "STAMP")).toBe(c.expected));
    it(`a real conflicting write of ${c.rel} keeps the on-disk version there`, () => {
      const d = tmp();
      mkdirSync(join(d, c.rel, ".."), { recursive: true });
      writeFileSync(join(d, c.rel), "external");
      const r = writeProjectFile(d, c.rel, "mine", "0".repeat(64));
      expect(r.conflictCopy!.replace(STAMP, "STAMP")).toBe(c.expected);
      expect(readFileSync(join(d, r.conflictCopy!), "utf8")).toBe("external");
      expect(readFileSync(join(d, c.rel), "utf8")).toBe("mine");
    });
  }
  it("never overwrites an existing conflict copy", () => {
    const rel: string = v.collisions.rel;
    const d = tmp();
    mkdirSync(join(d, "manuscript"));
    const got: string[] = [];
    for (let i = 0; i < 3; i++) {
      writeFileSync(join(d, rel), `external ${i}`);
      got.push(writeProjectFile(d, rel, "mine", "0".repeat(64)).conflictCopy!.replace(STAMP, "STAMP"));
    }
    expect(got).toEqual(v.collisions.expected);
    const copies = readdirSync(join(d, "manuscript")).filter((n) => n.includes("conflict")).sort();
    expect(copies.map((n) => readFileSync(join(d, "manuscript", n), "utf8")).sort()).toEqual(["external 0", "external 1", "external 2"]);
  });
});

describe("contract: asset collisions", () => {
  for (const seq of vec("asset-collision").sequences as { name: string; steps: { file: string; hex: string; expected?: string; error?: string }[] }[]) {
    it(seq.name, () => {
      const d = tmp();
      const contents = new Map<string, string>();
      for (const s of seq.steps) {
        const bytes = hex(s.hex);
        if (s.error) {
          expect(() => storeImage(d, s.file, bytes)).toThrow(s.error);
          continue;
        }
        const rel = storeImage(d, s.file, bytes);
        expect(rel).toBe(s.expected);
        if (!contents.has(rel)) contents.set(rel, s.hex);
        expect(readFileSync(join(d, rel)).toString("hex")).toBe(contents.get(rel));
      }
      const onDisk = existsSync(join(d, "assets")) ? readdirSync(join(d, "assets")).length : 0;
      expect(onDisk).toBe(contents.size);
    });
  }
});
