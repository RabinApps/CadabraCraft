import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ProjectFsError, openWorkspace, resolveInWorkspace } from "../src/index";

const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), "pfs-w-")));
const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return e instanceof ProjectFsError ? e.code : `other:${String(e)}`;
  }
  return "none";
};

describe("workspace", () => {
  it("requires an existing directory", () => {
    expect(code(() => openWorkspace(join(tmp(), "nope")))).toBe("workspace_invalid");
    const f = join(tmp(), "f");
    writeFileSync(f, "");
    expect(code(() => openWorkspace(f))).toBe("workspace_invalid");
    expect(code(() => openWorkspace(""))).toBe("workspace_invalid");
  });
  it("resolves relative paths and absolute paths inside the root, including not-yet-existing ones", () => {
    const root = tmp();
    const ws = openWorkspace(root);
    mkdirSync(join(root, "books"));
    expect(resolveInWorkspace(ws, "books/a")).toBe(join(root, "books/a"));
    expect(resolveInWorkspace(ws, "new/deep/dir")).toBe(join(root, "new/deep/dir"));
    expect(resolveInWorkspace(ws, join(root, "books/b"))).toBe(join(root, "books/b"));
    expect(resolveInWorkspace(ws, ".")).toBe(root);
  });
  it("refuses ../, absolute paths outside, and NUL", () => {
    const root = tmp();
    const ws = openWorkspace(root);
    for (const bad of ["../x", "a/../../x", tmp(), "/etc/passwd", "a\0b", ""]) expect(code(() => resolveInWorkspace(ws, bad)), JSON.stringify(bad)).toBe("path_escape");
  });
  it("refuses symlinks that leave the root, even when the target does not exist yet", () => {
    const root = tmp();
    const outside = tmp();
    const ws = openWorkspace(root);
    symlinkSync(outside, join(root, "link"));
    expect(code(() => resolveInWorkspace(ws, "link"))).toBe("path_escape");
    expect(code(() => resolveInWorkspace(ws, "link/new-project"))).toBe("path_escape");
    writeFileSync(join(outside, "f.md"), "x");
    symlinkSync(join(outside, "f.md"), join(root, "f.md"));
    expect(code(() => resolveInWorkspace(ws, "f.md"))).toBe("path_escape");
  });
  it("allows a symlink that stays inside the root", () => {
    const root = tmp();
    const ws = openWorkspace(root);
    mkdirSync(join(root, "real"));
    symlinkSync(join(root, "real"), join(root, "alias"));
    expect(resolveInWorkspace(ws, "alias/x")).toBe(join(root, "real/x"));
  });
  it("a root that is itself a symlink works (paths are compared by real path)", () => {
    const real = tmp();
    const holder = tmp();
    symlinkSync(real, join(holder, "root"));
    const ws = openWorkspace(join(holder, "root"));
    expect(ws.root).toBe(real);
    expect(resolveInWorkspace(ws, "x")).toBe(join(real, "x"));
  });
});
