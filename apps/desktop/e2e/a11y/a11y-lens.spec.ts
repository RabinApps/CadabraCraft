import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { expect, test } from "../support/coverage";

// Rendered A11yLens gate (https://github.com/eleven-hits/a11ylens, installed at the repo root). The CLI launches its
// OWN Chrome (Playwright's Chromium binary, --no-sandbox), loads the dev server, and runs axe-core, an accessibility
// tree check and a keyboard walk. LIMITATION: the fake Tauri backend (`fakeTauri`) is injected into Playwright pages
// with an init script, and the CLI's browser has no such script, so it sees only what the app renders with no native
// backend: the opening shell of `index.html`. The app has no URL routes (screens are state, not paths), so there is
// nothing else to crawl. Screens, dialogs and the editor are covered by the axe, IBM and CodeSniffer specs over
// `e2e/support/a11yScreens.ts`; this spec only adds A11yLens's own checks on that shell. The shell has no <main> or
// skip link yet (the app adds them once it mounts), so warnings and info findings are allowed and only errors fail.
// The CLI runs in an empty directory with --no-scan-source, so the source findings (the static gate in
// `scripts/a11ylens/app-gate.test.mjs`) are not counted twice.

const BIN = resolve(
  import.meta.dirname,
  "../../../../node_modules/@eleven-hits/a11ylens/bin/a11ylens.js",
);

interface Finding {
  severity: string;
  ruleId?: string;
  rule?: string;
  message: string;
  file?: string;
  url?: string;
}
interface Report {
  findings: Finding[];
  summary: { errors: number; pages: number };
  dynamic: { enabled: boolean; axeEnabled: boolean; urls: string[] };
}

test("A11yLens rendered scan of the opening shell has no errors", async ({
  baseURL,
  browserName,
}, testInfo) => {
  test.skip(
    browserName !== "chromium",
    "A11yLens drives Chromium; it runs on the chromium project only",
  );
  test.skip(Number(process.versions.node.split(".")[0]) < 22, "A11yLens needs Node 22 or newer");
  test.setTimeout(120_000);

  const cwd = mkdtempSync(join(tmpdir(), "a11ylens-render-"));
  try {
    const r = spawnSync(
      process.execPath,
      [
        BIN,
        "--render",
        "--url",
        `${baseURL}/`,
        "--browser",
        chromium.executablePath(),
        "--no-sandbox",
        "--no-scan-source",
        "--no-css",
        "--no-color",
        "-f",
        "json",
      ],
      { cwd, encoding: "utf8", timeout: 100_000 },
    );
    let report: Report;
    try {
      report = JSON.parse(r.stdout) as Report;
    } catch {
      throw new Error(`no JSON report (exit ${r.status}): ${r.stderr}`);
    }
    await testInfo.attach("a11ylens.json", { body: r.stdout, contentType: "application/json" });

    expect(report.dynamic.enabled, "the rendered scan ran").toBe(true);
    expect(report.dynamic.axeEnabled, "axe-core ran").toBe(true);
    expect(report.dynamic.urls.length, "a page was rendered").toBeGreaterThan(0);

    const errors = report.findings
      .filter((f) => f.severity === "error")
      .map((f) => `${f.ruleId ?? f.rule}: ${f.message} (${f.url ?? f.file ?? ""})`);
    expect(errors, errors.join("\n")).toEqual([]);
    expect(r.status, r.stderr).toBe(0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
