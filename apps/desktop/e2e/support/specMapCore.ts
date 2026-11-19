// The decisions behind e2e/spec-map.json that need no file system or Playwright, so scripts/affected/spec-map-core.test.mjs can test them.
// Only syntax Node can strip (no enums): that test imports this file as it is.

export type Part = { spec: string; test: string; files: string[] };
/**
 * What the reporter saw of the run: `subset` when it ran fewer tests than its files hold (grep, shard, rerun), `named` when files
 * were named on the command line, `skipped` the specs whose tests are all skipped, `tests` how many tests of each spec ran.
 */
export type Run = {
  subset: boolean;
  named: boolean;
  skipped: string[];
  tests: Record<string, number>;
};
export type SpecMap = { specs: string[]; files: Record<string, number[]> };
export type Merge = { ok: true; map: SpecMap } | { ok: false; reason: string };

/** How a Playwright run is narrowed: `subset` runs fewer tests than the files hold, `named` runs only the files named on the command line. */
export function runNarrowing(
  config: { grep?: unknown; grepInvert?: unknown; shard?: unknown },
  args: string[],
): { subset: boolean; named: boolean } {
  const grepSet = config.grep !== undefined && String(config.grep) !== "/.*/";
  const flags = args.some((a) =>
    /^(--last-failed|--only-changed|-g|--grep|--grep-invert|--shard)/.test(a),
  );
  return {
    subset: grepSet || Boolean(config.grepInvert) || Boolean(config.shard) || flags,
    named: args.some((a) => !a.startsWith("-")),
  };
}

/** The specs of `run` for which fewer distinct tests recorded a part than ran: a crash or an early exit left some out. */
function incompleteSpecs(parts: Part[], run: Run): string[] {
  const recorded = new Map<string, Set<string>>();
  for (const part of parts)
    recorded.set(part.spec, (recorded.get(part.spec) ?? new Set()).add(part.test));
  return Object.entries(run.tests)
    .filter(([spec, count]) => (recorded.get(spec)?.size ?? 0) < count)
    .map(([spec]) => spec);
}

const describeSpecs = (specs: string[]): string =>
  `${specs.slice(0, 3).join(", ")}${specs.length > 3 ? ", ..." : ""}`;

/**
 * The map from what the tests recorded. Refused (with the reason) for a filtered run, and when a spec file recorded nothing
 * and is not known to be skipped entirely: either would send changes to the specs that did record.
 * @param parts what each test exercised
 * @param allSpecs every spec file, relative to apps/desktop
 * @param run what the reporter saw of this run
 */
export function planMerge(parts: Part[], allSpecs: string[], run: Run): Merge {
  if (run.subset || run.named)
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
  if (missing.length > 0)
    return {
      ok: false,
      reason: `no test of ${missing.length} spec(s) ran (${describeSpecs(missing)})`,
    };
  const incomplete = incompleteSpecs(parts, run);
  if (incomplete.length > 0)
    return {
      ok: false,
      reason: `tests of ${incomplete.length} spec(s) did not all record (${describeSpecs(incomplete)})`,
    };
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
 * map after a few specs changed, without a full run. Refused when the run took only some of a spec's tests, or when a spec's tests
 * did not all record. Specs and files that no longer exist are dropped.
 */
export function patchMap(existing: SpecMap, parts: Part[], allSpecs: string[], run: Run): Merge {
  if (run.subset)
    return {
      ok: false,
      reason: "this run took only some of the tests of its specs (grep, shard or a rerun)",
    };
  const incomplete = incompleteSpecs(parts, run);
  if (incomplete.length > 0)
    return {
      ok: false,
      reason: `tests of ${incomplete.length} spec(s) did not all record (${describeSpecs(incomplete)})`,
    };
  const recorded = new Map<string, Set<string>>();
  for (const part of parts) {
    const set = recorded.get(part.spec) ?? new Set<string>();
    for (const f of part.files) set.add(f);
    recorded.set(part.spec, set);
  }
  for (const spec of run.skipped) if (!recorded.has(spec)) recorded.set(spec, new Set());
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
  return { ok: true, map: { specs, files: Object.fromEntries(sorted) } };
}
