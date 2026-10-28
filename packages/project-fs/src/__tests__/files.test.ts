import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PROJECT_DIRS,
  MANIFEST,
  ProjectFsError,
  atomicWrite,
  backupFile,
  backupManifest,
  createProject,
  hashBytes,
  readProjectFile,
  trashFile,
  writeBytes,
  writeProjectFile,
} from "../index";

const tmp = () => mkdtempSync(join(tmpdir(), "pfs-"));
const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return e instanceof ProjectFsError ? e.code : `other:${String(e)}`;
  }
  return "none";
};

describe("atomicWrite", () => {
  it("replaces content and leaves no temp file", () => {
    const d = tmp();
    const p = join(d, "a.json");
    atomicWrite(p, new TextEncoder().encode("one"));
    atomicWrite(p, new TextEncoder().encode("two"));
    expect(readFileSync(p, "utf8")).toBe("two");
    expect(readdirSync(d)).toEqual(["a.json"]);
  });
  it("creates missing parent directories", () => {
    const d = tmp();
    atomicWrite(join(d, "x/y/z.txt"), new Uint8Array([1]));
    expect(readFileSync(join(d, "x/y/z.txt"))[0]).toBe(1);
  });
});

describe("createProject", () => {
  it("makes the layout and never overwrites an existing project", () => {
    const d = tmp();
    createProject(d, '{"formatVersion":1}');
    for (const dir of PROJECT_DIRS) expect(existsSync(join(d, dir)), dir).toBe(true);
    expect(code(() => createProject(d, '{"formatVersion":1,"x":1}'))).toBe("already_exists");
    expect(readFileSync(join(d, MANIFEST), "utf8")).toBe('{"formatVersion":1}');
  });
});

describe("read and write", () => {
  it("missing is null and the hash is sha256 of the raw bytes", () => {
    const d = tmp();
    expect(readProjectFile(d, "manuscript/x.json")).toBeNull();
    writeProjectFile(d, "manuscript/x.json", "hi");
    const r = readProjectFile(d, "manuscript/x.json")!;
    expect(r.contents).toBe("hi");
    expect(r.hash).toBe("8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4");
    expect(r.hash).toBe(hashBytes(new TextEncoder().encode("hi")));
  });
  it("an iCloud placeholder is an error, not an empty file", () => {
    const d = tmp();
    mkdirSync(join(d, "manuscript"));
    writeFileSync(join(d, "manuscript/.x.json.icloud"), "");
    expect(code(() => readProjectFile(d, "manuscript/x.json"))).toBe("icloud_placeholder");
  });
  it("invalid UTF-8 is an error", () => {
    const d = tmp();
    writeFileSync(join(d, "bad.txt"), Buffer.from([0xff, 0xfe, 0xfd]));
    expect(code(() => readProjectFile(d, "bad.txt"))).toBe("invalid_utf8");
  });
  it("a matching baseHash writes without a conflict", () => {
    const d = tmp();
    const w1 = writeProjectFile(d, "manuscript/x.json", "v1");
    const w2 = writeProjectFile(d, "manuscript/x.json", "v2", w1.hash);
    expect(w2.conflictCopy).toBeNull();
    expect(readFileSync(join(d, "manuscript/x.json"), "utf8")).toBe("v2");
  });
  it("an external change keeps both versions (conflict copy has a UTC stamp)", () => {
    const d = tmp();
    const w1 = writeProjectFile(d, "manuscript/x.json", "v1");
    writeFileSync(join(d, "manuscript/x.json"), "external");
    const w2 = writeProjectFile(
      d,
      "manuscript/x.json",
      "mine",
      w1.hash,
      new Date(Date.UTC(2026, 9, 5, 7, 3)),
    );
    expect(w2.conflictCopy).toBe("manuscript/x.conflict-20261005-0703.json");
    expect(readFileSync(join(d, w2.conflictCopy!), "utf8")).toBe("external");
    expect(readFileSync(join(d, "manuscript/x.json"), "utf8")).toBe("mine");
  });
  it("a baseHash for a file that no longer exists just writes", () => {
    const d = tmp();
    expect(writeProjectFile(d, "x.json", "a", "0".repeat(64)).conflictCopy).toBeNull();
  });
  it("refuses unsafe relative paths", () => {
    const d = tmp();
    for (const bad of ["../x", "/etc/x", "a\\b", ""])
      expect(
        code(() => writeProjectFile(d, bad, "x")),
        bad,
      ).toBe("unsafe_path");
    expect(code(() => writeBytes(d, "../x", new Uint8Array()))).toBe("unsafe_path");
  });
  it("refuses to write through a symlinked folder that leaves the project", () => {
    const d = tmp();
    const outside = tmp();
    symlinkSync(outside, join(d, "manuscript"));
    expect(code(() => writeProjectFile(d, "manuscript/x.json", "x"))).toBe("path_escape");
    expect(readdirSync(outside)).toEqual([]);
  });
});

describe("backup and trash", () => {
  it("backup copies the manifest; trash moves and preserves content", () => {
    const d = tmp();
    createProject(d, '{"formatVersion":1}');
    const at = new Date(Date.UTC(2026, 0, 2, 3, 4));
    const b = backupManifest(d, at);
    expect(b).toBe(".cadabra/backups/cadabra-20260102-0304.json");
    expect(readFileSync(join(d, b), "utf8")).toBe('{"formatVersion":1}');
    writeProjectFile(d, "manuscript/x.json", "keep me");
    const t = trashFile(d, "manuscript/x.json", at);
    expect(t).toBe(".cadabra/trash/20260102-0304-manuscript__x.json");
    expect(existsSync(join(d, "manuscript/x.json"))).toBe(false);
    expect(readFileSync(join(d, t), "utf8")).toBe("keep me");
    expect(code(() => trashFile(d, "manuscript/nope.json"))).toBe("not_found");
  });
  it("backupFile keeps a copy of the current version, never overwriting an earlier one", () => {
    const d = tmp();
    const at = new Date(Date.UTC(2026, 0, 2, 3, 4));
    expect(backupFile(d, "manuscript/x.json", at)).toBeNull();
    writeProjectFile(d, "manuscript/x.json", "v1");
    const b1 = backupFile(d, "manuscript/x.json", at)!;
    expect(b1).toBe(".cadabra/backups/20260102-0304-manuscript__x.json");
    writeProjectFile(d, "manuscript/x.json", "v2");
    const b2 = backupFile(d, "manuscript/x.json", at)!;
    expect(b2).not.toBe(b1);
    expect(readFileSync(join(d, b1), "utf8")).toBe("v1");
    expect(readFileSync(join(d, b2), "utf8")).toBe("v2");
    expect(readFileSync(join(d, "manuscript/x.json"), "utf8")).toBe("v2");
  });
  it("never overwrites an earlier trash or backup entry made in the same minute", () => {
    const d = tmp();
    createProject(d, "one");
    const at = new Date(Date.UTC(2026, 0, 2, 3, 4));
    writeProjectFile(d, "manuscript/x.json", "first");
    const t1 = trashFile(d, "manuscript/x.json", at);
    writeProjectFile(d, "manuscript/x.json", "second");
    const t2 = trashFile(d, "manuscript/x.json", at);
    expect(t2).not.toBe(t1);
    expect(readFileSync(join(d, t1), "utf8")).toBe("first");
    expect(readFileSync(join(d, t2), "utf8")).toBe("second");
    const b1 = backupManifest(d, at);
    writeFileSync(join(d, MANIFEST), "changed");
    const b2 = backupManifest(d, at);
    expect(b2).not.toBe(b1);
    expect(readFileSync(join(d, b1), "utf8")).toBe("one");
    expect(readFileSync(join(d, b2), "utf8")).toBe("changed");
  });
});
