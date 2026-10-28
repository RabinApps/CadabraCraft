// Minimal client for the dev-only MCP bridge plugin that `pnpm tauri:automate` starts inside the real app
// (loopback WebSocket, default port 9223). No third-party code. See docs/agent-testing.md.
import { writeFileSync } from "node:fs";

type Reply = { id: string; success?: boolean; error?: string; data?: unknown };

/** What the webview returns is whatever the injected script produced, so `js` and `call` results are `unknown` unless the caller names the type. */
export type Snapshot = {
  buttons: string[];
  fields: { type: string; label: string | null; value: string }[];
  headings: string[];
  dialogs: string[];
  status: string[];
  editor: string | null;
};

export type App = Awaited<ReturnType<typeof connect>>;

export async function connect({
  port = 9223,
  timeoutMs = 30000,
}: { port?: number; timeoutMs?: number } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const pending = new Map<string, (m: Reply) => void>();
  let next = 0;
  ws.onmessage = (e: MessageEvent) => {
    const m: Reply = JSON.parse(String(e.data));
    pending.get(m.id)?.(m);
  };
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () =>
      reject(
        new Error(
          `Cannot reach the app bridge on 127.0.0.1:${port}. Start it with: pnpm --filter @cadabracraft/desktop tauri:automate`,
        ),
      );
  });

  const call = <T = unknown>(command: string, args: unknown): Promise<T> =>
    new Promise((resolve, reject) => {
      const id = String(++next);
      const timer = setTimeout(() => reject(new Error(`timeout: ${command}`)), timeoutMs);
      pending.set(id, (m) => {
        clearTimeout(timer);
        pending.delete(id);
        if (m.success === false) reject(new Error(m.error ?? `${command} failed`));
        else resolve(m.data as T);
      });
      ws.send(JSON.stringify({ id, command, args }));
    });

  /** Runs JavaScript in the app's webview. The expression may return a promise. */
  const js = <T = unknown>(script: string): Promise<T> => call<T>("execute_js", { script });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const q = (v: unknown) => JSON.stringify(v);

  return {
    call,
    js,
    sleep,
    close: () => ws.close(),
    /** Calls one of the app's own Tauri commands (needs withGlobalTauri, set by tauri.automation.conf.json). */
    invoke: (command: string, args: unknown = {}) =>
      js<string>(
        `window.__TAURI__.core.invoke(${q(command)}, ${q(args)}).then((r) => JSON.stringify(r ?? null))`,
      ).then((s) => JSON.parse(s) as unknown),
    /** Pre-answers the next native file/folder dialogs, in order. Use null to cancel one. */
    queueDialogs: (answers: (string | null)[]) =>
      js(
        `window.__TAURI__.core.invoke("automation_queue_dialog", { answers: ${q(answers)} }).then(() => "queued")`,
      ),
    /** Saves a PNG of the webview (no Screen Recording permission needed). Returns the path. */
    screenshot: async (path: string, maxWidth = 1000) => {
      const r = await call<{ dataUrl: string }>("capture_native_screenshot", {
        format: "png",
        maxWidth,
      });
      writeFileSync(path, Buffer.from(r.dataUrl.replace(/^data:image\/\w+;base64,/, ""), "base64"));
      return path;
    },
    /** Clicks the first button whose text (or aria-label) equals `label`, or matches the RegExp. */
    click: (label: string | RegExp) =>
      js(`(() => { const want = ${label instanceof RegExp ? `new RegExp(${q(label.source)}, ${q(label.flags)})` : q(label)};
        const name = (b) => (b.textContent.trim() || b.getAttribute("aria-label") || "");
        const b = [...document.querySelectorAll("button")].find((b) => want instanceof RegExp ? want.test(name(b)) : name(b) === want);
        if (!b) throw new Error("no button: " + want); b.click(); return "clicked"; })()`),
    /** Sets a React-controlled input (by index among visible inputs, or CSS selector). */
    fill: (target: number | string, value: string) =>
      js(`(() => { const el = ${typeof target === "number" ? `document.querySelectorAll("input,textarea")[${target}]` : `document.querySelector(${q(target)})`};
        if (!el) throw new Error("no field: " + ${q(String(target))});
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${q(value)});
        el.dispatchEvent(new Event("input", { bubbles: true })); return el.value; })()`),
    /** Compact view of what is on screen: buttons, fields, headings, dialogs, editor text. */
    snapshot: (): Promise<Snapshot> =>
      js<string>(`JSON.stringify({
        buttons: [...document.querySelectorAll("button")].map((b) => (b.textContent.trim() || b.getAttribute("aria-label") || "")),
        fields: [...document.querySelectorAll("input,textarea,select")].map((e) => ({ type: e.type, label: e.getAttribute("aria-label"), value: e.value })),
        headings: [...document.querySelectorAll("h1,h2,h3")].map((h) => h.textContent.trim()),
        dialogs: [...document.querySelectorAll("[role=dialog]")].map((d) => d.textContent.trim().slice(0, 300)),
        status: [...document.querySelectorAll("[role=status],[role=alert]")].map((s) => s.textContent.trim()),
        editor: document.querySelector(".ProseMirror")?.innerText ?? null })`).then(
        (s) => JSON.parse(s) as Snapshot,
      ),
  };
}
