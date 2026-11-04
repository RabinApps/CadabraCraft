#!/usr/bin/env node
// End-to-end click-through of the REAL desktop app (create, edit, image, EPUB, PDF, import) with assertions.
// Usage: node scripts/automation/scenario.ts [--launch] [--out <dir>]
//   --launch  start `pnpm tauri:automate` first (waits for the bridge) and stop it afterwards
//   --out     where to put the scratch books and screenshots (default: a new temp dir)
// The steps live in scenario/*.ts; scenario/context.ts holds the setup and the shared helpers.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createContext } from "./scenario/context.ts";
import { editingSteps } from "./scenario/editing.ts";
import { exportSteps } from "./scenario/export.ts";
import { pdfAndDetailsSteps } from "./scenario/pdf-and-details.ts";
import { publishingDetailsSteps } from "./scenario/publishing-details.ts";
import { findAndHistorySteps } from "./scenario/find-and-history.ts";
import { editionsSteps } from "./scenario/editions.ts";
import { importAndCloseSteps } from "./scenario/import-and-close.ts";
import { referencesSteps } from "./scenario/references.ts";
import { chapterIconsSteps } from "./scenario/chapter-icons.ts";
import { moreFormattingSteps } from "./scenario/more-formatting.ts";
import { osA11ySteps } from "./scenario/os-a11y.ts";

const ctx = await createContext(process.argv.slice(2));
const { app, child, out, results } = ctx;

try {
  await editingSteps(ctx);
  await moreFormattingSteps(ctx);
  await osA11ySteps(ctx);
  await referencesSteps(ctx);
  await exportSteps(ctx);
  await pdfAndDetailsSteps(ctx);
  await publishingDetailsSteps(ctx);
  await findAndHistorySteps(ctx);
  await chapterIconsSteps(ctx);
  await editionsSteps(ctx);
  await importAndCloseSteps(ctx);
} catch {
  process.exitCode = 1;
} finally {
  writeFileSync(join(out, "results.json"), JSON.stringify(results, null, 2));
  console.log(
    `\n${results.filter((r) => r.ok).length}/${results.length} steps passed. Artifacts: ${out}`,
  );
  app.close();
  if (child && child.pid !== undefined) {
    try {
      process.kill(-child.pid);
    } catch {
      // the app and its process group may already be gone
    }
  }
}
