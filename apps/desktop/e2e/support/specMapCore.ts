// The decisions behind e2e/spec-map.json that need no file system or Playwright, so scripts/affected/spec-map-core.test.mjs can test them.
// Only syntax Node can strip (no enums): that test imports this file as it is.

export type Part = { spec: string; files: string[] };
export type Run = { filtered: boolean; skipped: string[] };
export type SpecMap = { specs: string[]; files: Record<string, number[]> };
export type Merge = { ok: true; map: SpecMap } | { ok: false; reason: string };

/**
 * Whether this Playwright run selects fewer tests than the whole suite: a grep, a shard, files named on the command line, or
 * a rerun of failures. Such a run cannot make the map, even when it touches every spec.
 */
export function isFilteredRun(
  config: { grep?: unknown; grepInvert?: unknown; shard?: unknown },
  args: string[],
): boolean {
  const grepSet = config.grep !== undefined && String(config.grep) !== "/.*/";
  const named = args.some((a) => !a.startsWith("-"));
  const flags = args.some((a) =>
    /^(--last-failed|--only-changed|-g|--grep|--grep-invert|--shard)/.test(a),
  );
  return grepSet || Boolean(config.grepInvert) || Boolean(config.shard) || named || flags;
}

/**
 * The map from what the tests recorded. Refused (with the reason) for a filtered run, and when a spec file recorded nothing
 * and is not known to be skipped entirely: either would send changes to the specs that did record.
 * @param parts what each test exercised
 * @param allSpecs every spec file, relative to apps/desktop
 * @param run what the reporter saw of this run
 */
export function planMerge(parts: Part[], allSpecs: string[], run: Run): Merge {
  if (run.filtered)
    return { ok: false, reason: "this run was filtered (grep, shard, named files or a rerun)" };
  const bySpec = new Map<string, Set<string>>();
  for (const part of parts) {
    const set = bySpec.get(part.spec) ?? new Set<string>();
    for (const f of part.files) set.add(f);
    bySpec.set(part.spec, set);
  }
  // A spec whose every test is skipped runs no fixture, so it records nothing and exercises nothing.
  for (const spec of run.skipped) if (!bySpec.has(spec)) bySpec.set(spec, new Set());
  const missing = allSpecs.filter((spec) => !bySpec.has(spec));
  if (missing.length > 0) {
    const names = `${missing.slice(0, 3).join(", ")}${missing.length > 3 ? ", ..." : ""}`;
    return { ok: false, reason: `no test of ${missing.length} spec(s) ran (${names})` };
  }
  const specs = allSpecs.filter((s) => bySpec.has(s)).sort();
  const files: Record<string, number[]> = {};
  specs.forEach((spec, i) => {
    for (const f of [...(bySpec.get(spec) ?? [])].sort()) (files[f] ??= []).push(i);
  });
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
  return { ok: true, map: { specs, files: sorted } };
}

/**
 * `existing` with the specs of `parts` replaced by what `parts` recorded (a spec new to the map is added): for refreshing the
 * map after a few specs changed, without a full run. Specs and files that no longer exist are dropped.
 */
export function patchMap(existing: SpecMap, parts: Part[], allSpecs: string[]): SpecMap {
  const recorded = new Map<string, Set<string>>();
  for (const part of parts) {
    const set = recorded.get(part.spec) ?? new Set<string>();
    for (const f of part.files) set.add(f);
    recorded.set(part.spec, set);
  }
  const specs = [...new Set([...existing.specs, ...recorded.keys()])]
    .filter((s) => allSpecs.includes(s))
    .sort();
  const files: Record<string, number[]> = {};
  const add = (file: string, spec: string) => (files[file] ??= []).push(specs.indexOf(spec));
  for (const [file, indexes] of Object.entries(existing.files))
    for (const i of indexes) {
      const spec = existing.specs[i];
      if (spec && specs.includes(spec) && !recorded.has(spec)) add(file, spec);
    }
  for (const [spec, set] of recorded) if (specs.includes(spec)) for (const f of set) add(f, spec);
  const sorted = Object.entries(files)
    .map(([file, idx]) => [file, [...new Set(idx)].sort((a, b) => a - b)] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return { specs, files: Object.fromEntries(sorted) };
}
