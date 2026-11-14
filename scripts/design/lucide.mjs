import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Loads icon shapes from the lucide-react package that the desktop app already depends on.
 * @param {string} fromDir a directory that can resolve "lucide-react" (apps/desktop)
 * @param {Iterable<string>} names icon names used by the pen
 * @returns {Promise<Map<string, Array<[string, Record<string, string>]>>>} shapes by name (unknown names are absent)
 */
export async function loadLucideShapes(fromDir, names) {
  const entry = createRequire(join(resolve(fromDir), "package.json")).resolve("lucide-react");
  // .../lucide-react/dist/cjs/lucide-react.js -> .../lucide-react/dist/esm/icons
  const icons = join(dirname(dirname(entry)), "esm", "icons");
  const shapes = new Map();
  let aliases; // alias -> file name, built only when a name is not a file
  for (const name of names) {
    if (!/^[a-z0-9-]+$/.test(name)) continue;
    let file = join(icons, `${name}.mjs`);
    if (!existsSync(file)) {
      aliases ??= aliasIndex(icons);
      const target = aliases.get(name);
      if (!target) continue;
      file = join(icons, target);
    }
    const mod = await import(pathToFileURL(followReExports(file, icons)).href);
    if (mod.__iconData?.node) shapes.set(name, mod.__iconData.node);
  }
  return shapes;
}

/** Old icon names that lucide kept as aliases: alias -> icon file. Read from each file's `aliases: [...]`. */
function aliasIndex(icons) {
  const index = new Map();
  for (const file of readdirSync(icons)) {
    if (!file.endsWith(".mjs")) continue;
    const list = /aliases:\s*\[([^\]]*)\]/.exec(readFileSync(join(icons, file), "utf8"))?.[1];
    for (const alias of list?.match(/"([a-z0-9-]+)"/g) ?? []) index.set(alias.slice(1, -1), file);
  }
  return index;
}

/** Renamed icons are stub files like `export { default } from './letter-b.mjs'`; returns the real file. */
function followReExports(file, icons) {
  for (let hops = 0; hops < 5; hops++) {
    const target = /export \{ default \} from '\.\/([a-z0-9-]+\.mjs)'/.exec(
      readFileSync(file, "utf8"),
    )?.[1];
    if (!target) return file;
    file = join(icons, target);
  }
  return file;
}
