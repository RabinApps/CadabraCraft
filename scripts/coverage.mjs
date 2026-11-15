import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktop = path.join(root, "apps/desktop");
const appUnitPath = path.join(desktop, "coverage/coverage-summary.json");
const e2eSummaryPath = path.join(root, "coverage/e2e/coverage-summary.json");
const rustPath = path.join(desktop, "src-tauri/target/llvm-cov.lcov");
const rustSummaryPath = path.join(desktop, "src-tauri/target/llvm-cov-summary.json");
const outputDir = path.join(root, "coverage/merged");
const rustOutputPath = path.join(outputDir, "rust-lcov.info");

const floors = {
  desktopUnit: { lines: 99, branches: 98, functions: 99, statements: 99 },
  desktopE2e: { lines: 98, branches: 90, functions: 95, statements: 97 },
  rust: { lines: 99, functions: 98 },
};
const rustExcluded = [
  "src/lib.rs", // application builder wiring, explicitly excluded by policy
  "src/platform/native_dialog.rs", // opens the OS file dialogs: needs a real window and a person
  "src/commands/project.rs:62", // generated #[tauri::command] wrapper glue
];

function checkSummary(label, total, floor) {
  let failed = false;
  for (const [metric, minimum] of Object.entries(floor)) {
    const actual = total[metric]?.pct;
    console.log(`${label} ${metric}: ${actual}% (minimum ${minimum}%)`);
    if (typeof actual !== "number" || actual < minimum) failed = true;
  }
  return failed;
}

const newRecord = () => ({
  functions: new Map(),
  functionLines: new Map(),
  lines: new Map(),
  branches: new Map(),
});

const addTo = (map, key, count) => map.set(key, (map.get(key) ?? 0) + count);

// One reader per lcov line kind: it matches the line and folds it into the record.
const lcovReaders = [
  [
    "FN:",
    (record, line) => {
      const [, at, name] = line.match(/^FN:(\d+),(.*)$/) ?? [];
      if (name) record.functionLines.set(name, at);
    },
  ],
  [
    "FNDA:",
    (record, line) => {
      const [, count, name] = line.match(/^FNDA:(\d+),(.*)$/) ?? [];
      if (name) addTo(record.functions, name, Number(count));
    },
  ],
  [
    "DA:",
    (record, line) => {
      const [, at, count] = line.match(/^DA:(\d+),(\d+)/) ?? [];
      if (at) addTo(record.lines, at, Number(count));
    },
  ],
  [
    "BRDA:",
    (record, line) => {
      const [, at, block, branch, count] = line.match(/^BRDA:([^,]+),([^,]+),([^,]+),(.+)$/) ?? [];
      if (at && count !== "-") addTo(record.branches, `${at},${block},${branch}`, Number(count));
    },
  ],
];

function parseLcov(text) {
  const records = new Map();
  for (const raw of text.split("end_of_record")) {
    const lines = raw.trim().split(/\r?\n/).filter(Boolean);
    const rawSource = lines.find((line) => line.startsWith("SF:"))?.slice(3);
    if (!rawSource) continue;
    const source = rawSource.replace(/^.*\/src\//, "src/");
    if (!source.startsWith("src/")) continue;
    const record = records.get(source) ?? newRecord();
    for (const line of lines) {
      const reader = lcovReaders.find(([prefix]) => line.startsWith(prefix));
      if (reader) reader[1](record, line);
    }
    records.set(source, record);
  }
  return records;
}

function mergeLcov(inputs) {
  const merged = new Map();
  for (const input of inputs) {
    const records = parseLcov(input);
    for (const [source, record] of records) {
      const target = merged.get(source) ?? {
        functions: new Map(),
        functionLines: new Map(),
        lines: new Map(),
        branches: new Map(),
      };
      for (const [name, at] of record.functionLines) target.functionLines.set(name, at);
      for (const [name, count] of record.functions)
        target.functions.set(name, (target.functions.get(name) ?? 0) + count);
      for (const [at, count] of record.lines)
        target.lines.set(at, (target.lines.get(at) ?? 0) + count);
      for (const [key, count] of record.branches)
        target.branches.set(key, (target.branches.get(key) ?? 0) + count);
      merged.set(source, target);
    }
  }

  let totalLines = 0;
  let coveredLines = 0;
  let totalBranches = 0;
  let coveredBranches = 0;
  let totalFunctions = 0;
  let coveredFunctions = 0;
  const output = [];
  for (const [source, record] of [...merged].sort(([a], [b]) => a.localeCompare(b))) {
    const lines = [...record.lines].sort(([a], [b]) => Number(a) - Number(b));
    const branches = [...record.branches].sort(([a], [b]) => a.localeCompare(b));
    const functions = [...record.functionLines].sort(([a], [b]) => a.localeCompare(b));
    const functionCounts = new Map(
      functions.map(([name]) => [name, record.functions.get(name) ?? 0]),
    );
    totalLines += lines.length;
    coveredLines += lines.filter(([, count]) => count > 0).length;
    totalBranches += branches.length;
    coveredBranches += branches.filter(([, count]) => count > 0).length;
    totalFunctions += functions.length;
    coveredFunctions += [...functionCounts.values()].filter((count) => count > 0).length;
    output.push(
      `TN:CadabraCraft\nSF:${source}`,
      ...functions.map(([name, at]) => `FN:${at},${name}`),
      ...[...functionCounts].map(([name, count]) => `FNDA:${count},${name}`),
      `FNF:${totalFunctions ? functions.length : 0}`,
      `FNH:${[...functionCounts.values()].filter((count) => count > 0).length}`,
      ...lines.map(([at, count]) => `DA:${at},${count}`),
      `LF:${lines.length}`,
      `LH:${lines.filter(([, count]) => count > 0).length}`,
      ...branches.map(([key, count]) => `BRDA:${key},${count}`),
      `BRF:${branches.length}`,
      `BRH:${branches.filter(([, count]) => count > 0).length}`,
      "end_of_record",
    );
  }
  return {
    text: `${output.join("\n")}\n`,
    summary: {
      lines: {
        covered: coveredLines,
        total: totalLines,
        pct: totalLines ? (coveredLines / totalLines) * 100 : 100,
      },
      branches: {
        covered: coveredBranches,
        total: totalBranches,
        pct: totalBranches ? (coveredBranches / totalBranches) * 100 : 100,
      },
      functions: {
        covered: coveredFunctions,
        total: totalFunctions,
        pct: totalFunctions ? (coveredFunctions / totalFunctions) * 100 : 100,
      },
    },
  };
}

const mode = process.argv[2] ?? "all";
if (!["all", "--js-only", "--rust-only"].includes(mode)) {
  console.error(`Unknown coverage report mode: ${mode}`);
  process.exit(2);
}
let failed = false;
if (mode !== "--rust-only") {
  const [unit, e2e, unitLcov, e2eLcov] = await Promise.all([
    readFile(appUnitPath, "utf8").then(JSON.parse),
    readFile(e2eSummaryPath, "utf8").then(JSON.parse),
    readFile(path.join(desktop, "coverage/lcov.info"), "utf8"),
    readFile(path.join(root, "coverage/e2e/lcov.info"), "utf8"),
  ]);
  const merged = mergeLcov([unitLcov, e2eLcov]);
  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(outputDir, "lcov.info"), merged.text),
    writeFile(path.join(outputDir, "summary.json"), `${JSON.stringify(merged.summary, null, 2)}\n`),
  ]);
  console.log("Combined desktop LCOV:", merged.summary);
  failed = checkSummary("Desktop Vitest", unit.total, floors.desktopUnit);
  failed = checkSummary("Desktop Playwright", e2e.total, floors.desktopE2e) || failed;
}
if (mode !== "--js-only") {
  const [rustLcov, rustJsonText] = await Promise.all([
    readFile(rustPath, "utf8"),
    readFile(rustSummaryPath, "utf8"),
  ]);
  const rustRecords = parseLcov(rustLcov);
  const rustReport = JSON.parse(rustJsonText);
  const rustTotals = { lines: { covered: 0, total: 0 }, functions: { covered: 0, total: 0 } };
  const rustFileSummaries = new Map();
  for (const file of rustReport.data.flatMap((chunk) => chunk.files)) {
    const source = file.filename.replace(/^.*\/src\//, "src/");
    if (!source.startsWith("src/") || source === "src/lib.rs" || source === "src/main.rs") continue;
    rustFileSummaries.set(source, file.summary);
    const lines = file.summary.lines;
    const functions = file.summary.functions;
    rustTotals.lines.total += lines.count;
    rustTotals.lines.covered += lines.covered;
    rustTotals.functions.total += functions.count;
    rustTotals.functions.covered += functions.covered;
  }
  for (const excluded of rustExcluded) {
    if (!excluded.includes(":")) {
      rustRecords.delete(excluded);
      continue;
    }
    const [source, line] = excluded.split(":");
    const record = rustRecords.get(source);
    const lineCount = record?.lines.get(line);
    const [fileName] = excluded.split(":");
    const summary = rustFileSummaries.get(fileName);
    const wrapperFunction = [...(record?.functionLines ?? [])].find(([, at]) => at === line);
    if (
      lineCount !== 0 ||
      !summary ||
      !wrapperFunction ||
      record.functions.get(wrapperFunction[0]) !== 0
    ) {
      console.error(
        `Expected uncovered generated wrapper line/function at ${excluded}; refusing a stale exclusion.`,
      );
      failed = true;
      continue;
    }
    record.lines.delete(line);
    for (const [key] of record.branches)
      if (key.startsWith(`${line},`)) record.branches.delete(key);
    rustTotals.lines.total--;
    rustTotals.functions.total--;
    summary.lines.count--;
    summary.functions.count--;
  }
  const rustLcovForGate = [...rustRecords]
    .map(([source, record]) => {
      const functions = [...record.functionLines];
      return [
        `SF:${source}`,
        ...functions.map(([name, at]) => `FN:${at},${name}`),
        ...functions.map(([name]) => `FNDA:${record.functions.get(name) ?? 0},${name}`),
        ...[...record.lines].map(([at, count]) => `DA:${at},${count}`),
        ...[...record.branches].map(([key, count]) => `BRDA:${key},${count}`),
        "end_of_record",
      ].join("\n");
    })
    .join("\n");
  const rust = {
    lines: {
      ...rustTotals.lines,
      pct: rustTotals.lines.total ? (rustTotals.lines.covered / rustTotals.lines.total) * 100 : 100,
    },
    functions: {
      ...rustTotals.functions,
      pct: rustTotals.functions.total
        ? (rustTotals.functions.covered / rustTotals.functions.total) * 100
        : 100,
    },
  };
  console.log(`Rust exclusions: ${rustExcluded.join(", ")}`);
  if (!rust.lines.total || !rust.functions.total) {
    console.error(
      "Rust coverage report has no in-scope source files; refusing an empty-report pass.",
    );
    failed = true;
  } else {
    failed = checkSummary("Rust", rust, floors.rust) || failed;
    await mkdir(outputDir, { recursive: true });
    await writeFile(rustOutputPath, `${rustLcovForGate}\n`);
  }
}
if (failed) process.exitCode = 1;
