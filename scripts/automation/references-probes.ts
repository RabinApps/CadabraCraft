// Measurement helpers for measure-references.ts: process memory, webview frame gaps, bridge round trips, hashes.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import type { App } from "./client.ts";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const sha256 = (file: string) =>
  new Promise<string>((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(file)
      .on("data", (d) => h.update(d))
      .on("end", () => resolve(h.digest("hex")))
      .on("error", reject);
  });

// ---- memory: peak RSS of the app process and of the WebKit WebContent process that grows most ----
type Proc = { pid: number; rssMb: number; comm: string };
function procs(): Proc[] {
  const txt = execFileSync("ps", ["-axo", "pid=,rss=,comm="], { encoding: "utf8" });
  return txt
    .split("\n")
    .map((l) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ pid: Number(m[1]), rssMb: Number(m[2]) / 1024, comm: m[3] ?? "" }))
    .filter((p) => /cadabracraft|WebKit\.WebContent|WebKit\.Networking/i.test(p.comm));
}
export function sampler() {
  const base = new Map(procs().map((p) => [p.pid, p.rssMb]));
  const peak = new Map<number, Proc>();
  const tick = () => {
    for (const p of procs()) if (p.rssMb > (peak.get(p.pid)?.rssMb ?? 0)) peak.set(p.pid, p);
  };
  tick();
  const timer = setInterval(tick, 150);
  return () => {
    clearInterval(timer);
    tick();
    const rows = [...peak.values()].map((p) => ({
      pid: p.pid,
      kind: p.comm.includes("cadabracraft")
        ? "app"
        : /Networking/.test(p.comm)
          ? "networking"
          : "webcontent",
      baseMb: Math.round(base.get(p.pid) ?? 0),
      peakMb: Math.round(p.rssMb),
      growthMb: Math.round(p.rssMb - (base.get(p.pid) ?? 0)),
    }));
    // WebContent processes of other apps stay flat, so the one that grows is ours; the app process is the one named cadabracraft.
    const grew = rows.filter((r) => r.kind !== "app").sort((a, b) => b.growthMb - a.growthMb)[0];
    return { app: rows.find((r) => r.kind === "app"), webview: grew };
  };
}

// ---- responsiveness: frame gaps inside the webview and the round trip of a trivial script ----
export async function installFrameMonitor(app: App) {
  await app.js(`(() => { const m = window.__frames = { last: performance.now(), max: 0, n: 0 };
    const f = (t) => { m.max = Math.max(m.max, t - m.last); m.last = t; m.n++; requestAnimationFrame(f); };
    requestAnimationFrame(f); return "ok"; })()`);
}
export const resetFrames = (app: App) =>
  app.js(
    `(() => { window.__frames.max = 0; window.__frames.n = 0; window.__frames.last = performance.now(); return 1; })()`,
  );
export const readFrames = (app: App) =>
  app.js<{ max: number; n: number }>(`({ max: window.__frames.max, n: window.__frames.n })`);
export function probe(app: App) {
  const lat: number[] = [];
  let go = true;
  const loop = (async () => {
    while (go) {
      const t = performance.now();
      try {
        await app.js("1");
        lat.push(performance.now() - t);
      } catch {
        lat.push(Infinity);
      }
      await sleep(200);
    }
  })();
  return async () => {
    go = false;
    await loop;
    const finite = lat.filter(Number.isFinite).sort((a, b) => a - b);
    return {
      probes: lat.length,
      medianMs: Math.round(finite[Math.floor(finite.length / 2)] ?? 0),
      maxMs: Math.round(finite[finite.length - 1] ?? 0),
    };
  };
}
