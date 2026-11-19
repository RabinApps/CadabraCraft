import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Which app source files each Playwright spec calls into, for the CI selection (scripts/affected/e2e-specs.mjs).
 * `SPEC_MAP=1 playwright test` with COVERAGE=1 writes one part per test into coverage/spec-map-parts, and the global teardown
 * merges them into e2e/spec-map.json (`pnpm e2e:map` does both). A file counts for a spec when the spec called a function
 * in it: every spec loads every module, so only what runs says what a spec exercises.
 */
const here = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(here, "../..");
const repo = resolve(desktop, "../..");
const partsDir = join(repo, "coverage/spec-map-parts");
export const specMapPath = join(desktop, "e2e/spec-map.json");

export const specMapEnabled = (): boolean => Boolean(process.env.COVERAGE && process.env.SPEC_MAP);
/** SPEC_MAP=only writes the map without the coverage report, whose cache is gigabytes on a full run. */
export const reportEnabled = (): boolean =>
  Boolean(process.env.COVERAGE) && process.env.SPEC_MAP !== "only";
/** SPEC_MAP_KEEP=1 keeps the parts of an earlier run, to finish an interrupted one with the specs that are left. */
export const keepParts = (): boolean => Boolean(process.env.SPEC_MAP_KEEP);

type Entry = {
  url: string;
  functions?: { ranges: { count: number }[] }[];
};

/** `http://localhost:1420/src/app/App.tsx?t=1` and `/@fs/<repo>/packages/format/src/a.ts` as repo-relative paths; null for anything else. */
export function repoPath(url: string): string | null {
  let path: string;
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {
    return null;
  }
  if (
    path.includes("node_modules") ||
    path.startsWith("/@vite") ||
    path.includes("/@react-refresh")
  )
    return null;
  if (path.startsWith("/@fs")) path = path.slice("/@fs".length);
  if (path.startsWith(repo)) return path.slice(repo.length + 1);
  if (path.startsWith("/src/")) return `apps/desktop${path}`;
  return null;
}

/** The repo files in which the page called a function (not just ran the module's own top-level code). */
export function exercisedFiles(coverage: Entry[]): string[] {
  const files = new Set<string>();
  for (const entry of coverage) {
    const file = repoPath(entry.url);
    // functions[0] is the module itself, which every spec runs when it loads the file.
    if (file && (entry.functions ?? []).slice(1).some((f) => (f.ranges[0]?.count ?? 0) > 0))
      files.add(file);
  }
  return [...files];
}

/** Left in coverage/ when the last merge refused to write (ci.yml says so in the job summary). */
const incompleteMarker = join(repo, "coverage/spec-map-incomplete");
const clearIncomplete = (): void => rmSync(incompleteMarker, { force: true });

/** Every spec file of the e2e folder, relative to apps/desktop, as the parts name them. */
function listSpecs(dir = join(desktop, "e2e")): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listSpecs(path);
    return entry.name.endsWith(".spec.ts") ? [relative(desktop, path).split("\\").join("/")] : [];
  });
}

export function clearParts(): void {
  rmSync(partsDir, { recursive: true, force: true });
}

/** Records what one test exercised. */
export function writePart(testFile: string, testId: string, files: string[]): void {
  mkdirSync(partsDir, { recursive: true });
  const spec = relative(desktop, testFile).split("\\").join("/");
  writeFileSync(join(partsDir, `${testId}.json`), JSON.stringify({ spec, files }));
}

/** Merges the parts into e2e/spec-map.json: `{ specs: [...], files: { path: [spec indexes] } }`, sorted so a diff shows real change. */
export function mergeParts(): void {
  const bySpec = new Map<string, Set<string>>();
  // No parts (no test reached Chromium): keep the map that is there rather than write an empty one.
  if (!existsSync(partsDir)) return;
  clearIncomplete();
  for (const name of readdirSync(partsDir)) {
    const part = JSON.parse(readFileSync(join(partsDir, name), "utf8")) as {
      spec: string;
      files: string[];
    };
    const set = bySpec.get(part.spec) ?? new Set<string>();
    for (const f of part.files) set.add(f);
    bySpec.set(part.spec, set);
  }
  // A map made from some of the specs would send changes to those alone: refuse it (a filtered run, a crashed one).
  const missing = listSpecs().filter((spec) => !bySpec.has(spec));
  if (missing.length > 0) {
    const message = `spec map not written: no test of ${missing.length} spec(s) ran (${missing.slice(0, 3).join(", ")}${missing.length > 3 ? ", ..." : ""}). Run all the specs (or resume with SPEC_MAP_KEEP=1).`;
    if (process.env.SPEC_MAP === "only") throw new Error(message);
    console.warn(message);
    writeFileSync(incompleteMarker, message);
    return;
  }
  const specs = [...bySpec.keys()].sort();
  const files: Record<string, number[]> = {};
  specs.forEach((spec, i) => {
    for (const f of [...(bySpec.get(spec) ?? [])].sort()) (files[f] ??= []).push(i);
  });
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(specMapPath, `${JSON.stringify({ specs, files: sorted })}\n`);
}
