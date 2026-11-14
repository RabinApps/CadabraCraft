// Everything OpenPencil's .pen reader leaves out or gets wrong, fixed in order, so that the graph can be
// written to a faithful .fig (or rendered). See docs/architecture.md, "Moving the designs to OpenPencil".
import { readFileSync } from "node:fs";
import { parsePenFile } from "@open-pencil/core/io";
import { layoutAuthoredNodes } from "@open-pencil/core/layout";
import { makeIconComponents } from "./icon-components.mjs";
import { collectIconOverrides, iconNames, replaceIcons } from "./icons.mjs";
import { loadLucideShapes } from "./lucide.mjs";
import { markInstanceOverrides } from "./overrides.mjs";
import { resolveFontSizes } from "./resolve-sizes.mjs";
import { applyThemes, collectThemes, rebakeBoundColors } from "./themes.mjs";

/**
 * @param {string} input path of the .pen file
 * @param {string} iconsFrom a folder that can resolve "lucide-react"
 * @returns {Promise<{ graph: any, steps: string[] }>}
 */
export async function preparePen(input, iconsFrom = "apps/desktop") {
  const doc = JSON.parse(readFileSync(input, "utf8"));
  const steps = [];
  const themes = collectThemes(doc);
  // 1. icon nodes (unknown to OpenPencil) become stroked lucide paths
  const shapes = await loadLucideShapes(iconsFrom, iconNames(doc));
  const icons = replaceIcons(doc, (name) => shapes.get(name));
  steps.push(
    `${icons.replaced} icons${icons.missing.length ? ` (no lucide icon: ${icons.missing.join(", ")})` : ""}`,
  );
  const iconOverrides = collectIconOverrides(doc, icons.ids);
  const graph = parsePenFile(JSON.stringify(doc));
  // 1b. icons become components; an instance that shows another icon swaps the component
  const comps = makeIconComponents(graph, icons.ids, iconOverrides, shapes, doc.version);
  steps.push(
    `${comps.components} icon components, ${comps.instances} icon instances, ${comps.swaps} swaps`,
  );
  // 2. text sizes bound to variables ("$type-body") become numbers
  const sizes = resolveFontSizes(graph);
  steps.push(
    `${sizes.fixed} text sizes${sizes.missing.length ? ` (unresolved: ${sizes.missing.join(", ")})` : ""}`,
  );
  // 3. dark frames get their variable mode, and bound colours are resolved for it
  const modes = applyThemes(graph, themes);
  const colours = rebakeBoundColors(graph);
  steps.push(`${modes.applied} themed frames, ${colours.rebaked} colours re-resolved`);
  // 4. sizes and positions the layout implies (a .pen stores none; a .fig must)
  layoutAuthoredNodes(graph, graph.getPages()[0].childIds);
  // 5. instance text, fill and other overrides, which the .fig writer only writes when marked
  const overrides = markInstanceOverrides(graph);
  steps.push(`${overrides.fields} overrides on ${overrides.instances} instances`);
  return { graph, steps };
}
