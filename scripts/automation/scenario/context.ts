import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, type App } from "../client.ts";
import { tinyDocx } from "../../../apps/desktop/e2e/fixtures.ts";

export type StepResult = { name: string; ok: boolean; detail?: string | void };

export function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

export type MenuEntry = {
  kind: string;
  id: string;
  arg?: string;
  text: string;
  enabled: boolean;
  checked?: boolean;
  accelerator?: string;
  items: MenuEntry[];
};

/** Everything a step module needs: the connected app, the scratch folders, and the shared helpers. */
export type Context = Awaited<ReturnType<typeof createContext>>;

/** Starts the app when `--launch` is given, connects to the bridge and prepares the scratch folders and helpers. */
export async function createContext(args: string[]) {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const out = args.includes("--out")
    ? resolve(args[args.indexOf("--out") + 1] ?? ".")
    : mkdtempSync(join(tmpdir(), "cadabra-scenario-"));
  mkdirSync(out, { recursive: true });

  const results: StepResult[] = [];
  const step = async (name: string, fn: () => Promise<string | void>) => {
    try {
      const detail = await fn();
      results.push({ name, ok: true, detail });
      console.log(`PASS ${name}${detail ? ` - ${detail}` : ""}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      results.push({ name, ok: false, detail: message });
      console.log(`FAIL ${name} - ${message}`);
      throw e;
    }
  };

  let launched: App | undefined;
  let child: ChildProcess | undefined;
  if (args.includes("--launch")) {
    child = spawn("pnpm", ["--filter", "@cadabracraft/desktop", "tauri:automate"], {
      cwd: repo,
      stdio: "ignore",
      detached: true,
    });
    for (let i = 0; i < 90; i++) {
      try {
        launched = await connect({ timeoutMs: 30000 });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
  const app: App = launched ?? (await connect());

  const book = join(out, "book"),
    imported = join(out, "imported"),
    src = join(out, "src");
  for (const d of [book, imported, src]) mkdirSync(d, { recursive: true });
  writeFileSync(
    join(src, "book.md"),
    "# First\n\nHello *world*[^1].\n\n<mark>raw</mark>\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n# Second\n\nMore.\n\n[^1]: Note.\n",
  );
  writeFileSync(join(src, "book.docx"), tinyDocx({ image: true }));
  const docxBefore = readFileSync(join(src, "book.docx"));
  const importedDocx = join(out, "imported-docx"),
    importedHtml = join(out, "imported-html");
  mkdirSync(importedDocx, { recursive: true });
  mkdirSync(importedHtml, { recursive: true });
  writeFileSync(
    join(src, "page.html"),
    "<html><head><title>Page Title</title><script>alert(1)</script></head><body><h1>Gate</h1><p>The gate was <b>old</b> and <u>tired</u>.</p></body></html>",
  );
  const mdBefore = readFileSync(join(src, "book.md"), "utf8");
  const png = join(repo, "fixtures/assets/pixel.png");
  const shot = (n: string) => app.screenshot(join(out, `${n}.png`));
  // Radix menus open on pointerdown, so a plain click() is not enough for the trigger; items react to click().
  const openMenu = (label: string) =>
    app.js(`(() => { const b = [...document.querySelectorAll("button")].find((b) => (b.textContent.trim() || b.getAttribute("aria-label")) === ${JSON.stringify(label)});
    if (!b) throw new Error("no button: ${label}"); b.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" })); return "opened"; })()`);
  const pickItem = (label: string) =>
    app.js(`(() => { const i = [...document.querySelectorAll('[role="menuitem"]')].find((i) => i.textContent.trim() === ${JSON.stringify(label)});
    if (!i) throw new Error("no menu item: ${label}"); i.click(); return "picked"; })()`);
  // The Export dialog (M2): the header button opens it, a Format control picks EPUB or PDF, the dialog's submit button runs it.
  const dlg = <T = unknown>(body: string) =>
    app.js<T>(
      `(() => { const d = document.querySelector('[role="dialog"]'); if (!d) throw new Error("no dialog"); ${body} })()`,
    );
  const exportVia = async (format: string) => {
    await app.click("Export");
    await app.sleep(800);
    await dlg(
      `const o = [...d.querySelectorAll("button,[role=radio]")].find((e) => e.textContent.trim() === ${JSON.stringify(format)}); if (!o) throw new Error("no format: ${format}"); o.click(); return "picked";`,
    );
    await app.sleep(300);
    await dlg(`d.querySelector('button[type="submit"]').click(); return "submitted";`);
  };
  const status = async () => (await app.snapshot()).status.join(" ");
  // The native menu cannot be clicked from outside, so dev builds publish what it was told to show and a way to run its commands.
  const menuState = async () => {
    const m = JSON.parse(
      await app.js(
        `JSON.stringify(window.__cadabraMenu ? { error: window.__cadabraMenu.error, model: window.__cadabraMenu.model } : null)`,
      ),
    );
    assert(m, "the app did not publish its menu");
    assert(m.error === null, `the system refused the menu: ${m.error}`);
    const items = new Map<string, MenuEntry>();
    const walk = (entries: MenuEntry[]) => {
      for (const e of entries) {
        if (e.kind === "command") items.set(e.arg === undefined ? e.id : `${e.id}:${e.arg}`, e);
        else if (e.kind === "submenu") walk(e.items);
      }
    };
    walk(m.model);
    return {
      tops: (m.model as MenuEntry[]).filter((e) => e.kind === "submenu").map((e) => e.text),
      items,
    };
  };
  const runMenu = async (id: string, arg?: string) => {
    const ran = await app.js(
      `window.__cadabraMenu.run(${JSON.stringify(id)}, ${JSON.stringify(arg)})`,
    );
    if (ran !== true) {
      const why = await app.js(
        `JSON.stringify({ dialogs: [...document.querySelectorAll("[role=dialog]")].map((d) => d.textContent.slice(0, 80)), headings: [...document.querySelectorAll("h1,h2")].map((h) => h.textContent) })`,
      );
      assert(false, `menu command ${id} did not run: ${why}`);
    }
    await app.sleep(900);
  };

  return {
    app,
    child,
    results,
    out,
    repo,
    book,
    imported,
    src,
    importedDocx,
    importedHtml,
    docxBefore,
    mdBefore,
    png,
    shot,
    openMenu,
    pickItem,
    dlg,
    exportVia,
    status,
    menuState,
    runMenu,
    step,
    args,
  };
}
