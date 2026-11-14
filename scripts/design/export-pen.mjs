#!/usr/bin/env node
// Export cadabracraft.pen for OpenPencil (https://openpencil.dev): one .fig (or .png) file per
// top-level section, with the text sizes OpenPencil's .pen reader leaves unresolved fixed first.
//
//   node scripts/design/export-pen.mjs [--in cadabracraft.pen] [--out out/design] [--format fig|png]
//
// Needs @open-pencil/core (see docs/design.md, "Exporting the pen for OpenPencil").
// Never writes next to the pen file and never modifies it.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  exportFigFile,
  extractExportGraph,
  headlessRenderNodes,
  initCanvasKit,
  parsePenFile,
} from "@open-pencil/core/io";
import { iconNames, replaceIcons } from "./icons.mjs";
import { loadLucideShapes } from "./lucide.mjs";
import { detachInstance, failingInstanceId, resolveFontSizes } from "./resolve-sizes.mjs";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const input = arg("in", "cadabracraft.pen");
const outDir = arg("out", "out/design");
const format = arg("format", "fig");
if (!["fig", "png"].includes(format)) throw new Error(`--format must be fig or png, got ${format}`);

const fileName = (name) => `${name.replace(/[^A-Za-z0-9._-]+/g, "_")}.${format}`;

// OpenPencil does not know the pen's "icon" nodes (they become empty squares), so swap in lucide paths.
const doc = JSON.parse(readFileSync(input, "utf8"));
const shapes = await loadLucideShapes("apps/desktop", iconNames(doc));
const icons = replaceIcons(doc, (name) => shapes.get(name));
console.log(
  `replaced ${icons.replaced} icons${icons.missing.length ? `, unknown: ${icons.missing.join(", ")}` : ""}`,
);
const graph = parsePenFile(JSON.stringify(doc));
const { fixed, missing } = resolveFontSizes(graph);
console.log(
  `resolved ${fixed} text sizes${missing.length ? `, unresolved: ${missing.join(", ")}` : ""}`,
);

const ck = await initCanvasKit();
const page = graph.getPages()[0];
mkdirSync(outDir, { recursive: true });

const detached = [];

async function exportNode(node) {
  if (format === "png") {
    const png = await headlessRenderNodes(graph, page.id, [node.id], { scale: 1, format: "PNG" });
    if (!png) throw new Error("nothing to render");
    return png;
  }
  // The .fig writer cannot address children authored inside an instance; detach that instance
  // (it keeps its look) and try again, one instance at a time.
  for (;;) {
    try {
      const part = extractExportGraph(graph, { scope: "node", nodeId: node.id });
      return await exportFigFile(part.graph, ck, undefined, part.pageId ?? undefined);
    } catch (error) {
      const id = failingInstanceId(error.message);
      if (!id || !detachInstance(graph, id)) throw error;
      detached.push(graph.getNode(id)?.name ?? id);
    }
  }
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
