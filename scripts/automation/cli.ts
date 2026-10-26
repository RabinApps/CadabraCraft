#!/usr/bin/env node
// Usage: node scripts/automation/cli.ts <command> [args]
//   snapshot | screenshot <file.png> | js "<expression>" | click "<label>" | fill <index|selector> "<value>"
//   queue-dialog <path|null>... | invoke <command> '<json args>'
import { connect } from "./client.ts";

const [cmd, ...a] = process.argv.slice(2);
const app = await connect();
try {
  const out = ({
    snapshot: () => app.snapshot(),
    screenshot: () => app.screenshot(a[0] ?? "screenshot.png"),
    js: () => app.js(a[0] ?? ""),
    click: () => app.click(a[0] ?? ""),
    fill: () => app.fill(/^\d+$/.test(a[0] ?? "") ? Number(a[0]) : (a[0] ?? ""), a[1] ?? ""),
    "queue-dialog": () => app.queueDialogs(a.map((x) => (x === "null" ? null : x))),
    invoke: () => app.invoke(a[0] ?? "", a[1] ? JSON.parse(a[1]) : {}),
  } as Record<string, () => Promise<unknown>>)[cmd ?? ""];
  if (!out) throw new Error("unknown command: " + cmd);
  console.log(JSON.stringify(await out(), null, 2));
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
} finally {
  app.close();
}
