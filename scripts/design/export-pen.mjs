#!/usr/bin/env node
// Export the designs for OpenPencil (https://openpencil.dev): one .fig (or .png) file per top-level
// section, after preparePen() has fixed what OpenPencil's .pen reader leaves out.
//
//   node scripts/design/export-pen.mjs [--in cadabracraft.pen] [--out out/design] [--format fig|png] [--single]
//
// --single writes the whole document as one cadabracraft.fig (the design source) instead of one file per section.
//
// Needs @open-pencil/core (see docs/design.md, "Exporting the pen for OpenPencil").
// Never writes next to the pen file and never modifies it.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  exportFigFile,
  extractExportGraph,
  headlessRenderNodes,
  initCanvasKit,
} from "@open-pencil/core/io";
import { preparePen } from "./prepare.mjs";
import { detachInstance, failingInstanceId } from "./resolve-sizes.mjs";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const input = arg("in", "design/archive/cadabracraft.pen");
const outDir = arg("out", "out/design");
const format = arg("format", "fig");
const single = process.argv.includes("--single");
if (!["fig", "png"].includes(format)) throw new Error(`--format must be fig or png, got ${format}`);
if (single && format !== "fig") throw new Error("--single needs --format fig");

const fileName = (name) => `${name.replace(/[^A-Za-z0-9._-]+/g, "_")}.${format}`;

const { graph, steps } = await preparePen(input);
for (const step of steps) console.log(`prepared ${step}`);

const ck = await initCanvasKit();
const page = graph.getPages()[0];
mkdirSync(outDir, { recursive: true });

const detached = [];

// The .fig writer cannot address children authored inside an instance; detach that instance
// (it keeps its look) and try again, one instance at a time.
async function withDetach(write) {
  for (;;) {
    try {
      return await write();
    } catch (error) {
      const id = failingInstanceId(error.message);
      if (!id || !detachInstance(graph, id)) throw error;
      detached.push(graph.getNode(id)?.name ?? id);
      if (detached.length % 20 === 1) console.log(`detach #${detached.length}: ${error.message}`);
    }
  }
}

async function exportNode(node) {
  if (format === "png") {
    const png = await headlessRenderNodes(graph, page.id, [node.id], { scale: 1, format: "PNG" });
    if (!png) throw new Error("nothing to render");
    return png;
  }
  return withDetach(async () => {
    const part = extractExportGraph(graph, { scope: "node", nodeId: node.id });
    return exportFigFile(part.graph, ck, undefined, part.pageId ?? undefined);
  });
}

if (single) {
  const bytes = await withDetach(() => exportFigFile(graph, ck, undefined, page.id));
  const file = join(outDir, "cadabracraft.fig");
  writeFileSync(file, bytes);
  console.log(
    `wrote ${file} (${bytes.length} bytes); detached: ${[...new Set(detached)].join(", ") || "nothing"}`,
  );
  process.exit(0);
}

const report = { written: [], failed: [] };
async function run(node, prefix = "") {
  const name = `${prefix}${node.name}`;
  try {
    writeFileSync(join(outDir, fileName(name)), await exportNode(node));
    report.written.push(name);
  } catch (error) {
    // A section that cannot be written whole is exported frame by frame so only the broken frame is lost.
    const children = node.childIds
      .map((id) => graph.getNode(id))
      .filter((c) => c?.type === "FRAME");
    if (children.length === 0) {
      report.failed.push({ name, reason: error.message });
      return;
    }
    for (const child of children) await run(child, `${name}__`);
  }
}

for (const id of page.childIds) {
  const node = graph.getNode(id);
  if (node && node.type !== "COMPONENT") await run(node);
}

writeFileSync(
  join(outDir, "manifest.json"),
  JSON.stringify({ source: input, format, ...report, detached }, null, 2),
);
if (detached.length)
  console.log(
    `detached ${detached.length} instances to frames (kept their look): ${[...new Set(detached)].join(", ")}`,
  );
console.log(`${report.written.length} written, ${report.failed.length} failed -> ${outDir}`);
for (const f of report.failed) console.log(`  failed: ${f.name}: ${f.reason}`);
process.exitCode = report.failed.length ? 1 : 0;
