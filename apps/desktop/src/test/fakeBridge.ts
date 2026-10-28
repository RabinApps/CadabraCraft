/**
 * Shared in-memory stand-in for the Rust project layer, used by the store and import tests.
 * Use it from a test as
 *   vi.mock("<path>/lib/bridge", async () => (await import("<path>/test/fakeBridge")).fakeBridge({ ...extra methods }));
 * and import `disk` / `hashOf` from this module to inspect or seed the fake disk. Overrides replace the defaults by name.
 */

/** The fake project folder: relative path to file text. Tests clear it in `beforeEach`. */
export const disk = new Map<string, string>();

/** Content hash of the fake disk: cheap, but changes whenever the text does. */
export const hashOf = (s: string): string =>
  `h:${s.length}:${s.slice(0, 40)}:${[...s].reduce((x, c) => (x * 31 + c.charCodeAt(0)) >>> 0, 7)}`;

/** The plain write: store the text and return its hash. */
export async function writeFile(
  _root: string,
  path: string,
  contents: string,
): Promise<{ hash: string; conflict_copy: string | null }> {
  disk.set(path, contents);
  return { hash: hashOf(contents), conflict_copy: null };
}

/** Like the Rust layer: if the file changed since `base`, the old text is kept as a conflict copy. */
export async function writeFileWithConflictCopy(
  _root: string,
  path: string,
  contents: string,
  base: string | null,
): Promise<{ hash: string; conflict_copy: string | null }> {
  let conflict_copy: string | null = null;
  if (base && disk.has(path) && hashOf(disk.get(path)!) !== base) {
    conflict_copy = path.replace(".json", ".conflict-x.json");
    disk.set(conflict_copy, disk.get(path)!);
  }
  disk.set(path, contents);
  return { hash: hashOf(contents), conflict_copy };
}

export async function readFile(
  _root: string,
  path: string,
): Promise<{ contents: string; hash: string } | null> {
  const contents = disk.get(path);
  return contents === undefined ? null : { contents, hash: hashOf(contents) };
}

/** Trash commands with the real naming (`.cadabra/trash/<stamp>-<path with / as __>`) and the `-2` rule on restore. */
export const trashMethods = {
  trashFile: async (_root: string, path: string) => {
    const contents = disk.get(path);
    if (contents === undefined) throw new Error(`${path} does not exist`);
    const base = `.cadabra/trash/20260101-1200-${path.replaceAll("/", "__")}`;
    let to = base;
    for (let n = 2; disk.has(to); n++) to = base.replace(/\.json$/, `-${n}.json`);
    disk.delete(path);
    disk.set(to, contents);
    return to;
  },
  listTrash: async () =>
    [...disk.keys()]
      .filter((k) => k.startsWith(".cadabra/trash/"))
      .map((k) => ({
        path: k,
        original: k.slice(29).replaceAll("__", "/"),
        trashed_at: "20260101-1200",
      })),
  restoreTrash: async (_root: string, path: string) => {
    if (!disk.has(path)) throw new Error(`${path} does not exist`);
    const original = path.slice(29).replaceAll("__", "/");
    let to = original;
    for (let n = 2; disk.has(to); n++) to = original.replace(/\.json$/, `-${n}.json`);
    disk.set(to, disk.get(path)!);
    disk.delete(path);
    return to;
  },
};

/** The module shape `vi.mock("lib/bridge")` expects: the project basics plus whatever a test adds or replaces. */
export function fakeBridge(overrides: Record<string, unknown> = {}) {
  return {
    bridge: {
      createProject: async (_root: string, manifest: string) => {
        disk.set("cadabra.json", manifest);
      },
      readFile,
      writeFile,
      backupManifest: async () => "backup",
      watchProject: async () => {},
      ...overrides,
    },
  };
}
