import { execFileSync } from "node:child_process";
import { assert, type Context } from "./context.ts";

// Window title, focus and keyboard reach of the dialog routes, in the real window. What a screen reader reads first is
// the window title, and the shape of tauri-apps/tauri#15624 (NVDA loses the WebView2 content after the window is
// deactivated and activated again) is checked as: focus is in web content after launch and again after the switch.
// Only the macOS branch of the window switch has run (docs/platform-checks.md); the Windows and Linux branches are
// written but have not been run, and nothing here claims they pass.

type Where = { hasFocus: boolean; tag: string; label: string; inBody: boolean };

/** Deactivates this app and brings it back, by the system's own means. Returns what it did, or why it could not. */
function switchAway(): { ok: true; how: string } | { ok: false; why: string } {
  const run = (cmd: string, args: string[]) =>
    execFileSync(cmd, args, { stdio: "pipe", timeout: 15000 });
  try {
    if (process.platform === "darwin") {
      run("osascript", ["-e", 'tell application "Finder" to activate']);
      return { ok: true, how: "Finder activated" };
    }
    if (process.platform === "win32") {
      // Not run: written from the AppActivate documentation.
      run("powershell", [
        "-NoProfile",
        "-Command",
        "(New-Object -ComObject WScript.Shell).AppActivate('Program Manager')",
      ]);
      return { ok: true, how: "Program Manager activated" };
    }
    return { ok: false, why: "no window switch written for this platform (needs xdotool)" };
  } catch (e) {
    return { ok: false, why: e instanceof Error ? e.message.split("\n")[0]! : String(e) };
  }
}
function switchBack(): { ok: true; how: string } | { ok: false; why: string } {
  try {
    if (process.platform === "darwin") {
      execFileSync(
        "osascript",
        [
          "-e",
          'tell application "System Events" to set frontmost of (first process whose name is "cadabracraft") to true',
        ],
        { stdio: "pipe", timeout: 15000 },
      );
      return { ok: true, how: "System Events set frontmost" };
    }
    if (process.platform === "win32") {
      execFileSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          "(New-Object -ComObject WScript.Shell).AppActivate('CadabraCraft')",
        ],
        { stdio: "pipe", timeout: 15000 },
      );
      return { ok: true, how: "AppActivate" };
    }
    return { ok: false, why: "no window switch written for this platform" };
  } catch (e) {
    return { ok: false, why: e instanceof Error ? e.message.split("\n")[0]! : String(e) };
  }
}

/** The checks of this module record a failure and carry on, so one finding does not hide the rest. */
function osHelpers({ app, step: hardStep }: Context) {
  // A failing check here is a finding, not a reason to skip the rest of the scenario: it is recorded and the run goes on.
  const step = async (name: string, fn: () => Promise<string | void>) => {
    try {
      await hardStep(name, fn);
    } catch {
      process.exitCode = 1;
    }
  };
  const windowTitle = () =>
    app
      .js<string>(
        `window.__TAURI__.window.getCurrentWindow().title().then((t) => JSON.stringify(t))`,
      )
      .then((s) => JSON.parse(s) as string);
  const where = () =>
    app
      .js<string>(
        `JSON.stringify((() => { const a = document.activeElement; return { hasFocus: document.hasFocus(), tag: a ? a.tagName : "", label: a ? (a.getAttribute("aria-label") || a.textContent || "").trim().slice(0, 40) : "", inBody: !a || a === document.body || a === document.documentElement }; })())`,
      )
      .then((s) => JSON.parse(s) as Where);
  const titles: Record<string, string> = {};
  return { step, windowTitle, where, titles };
}
type Helpers = ReturnType<typeof osHelpers>;

export async function osA11ySteps(ctx: Context) {
  const helpers = osHelpers(ctx);
  await windowTitleSteps(ctx, helpers);
  await focusSteps(ctx, helpers);
  await dialogRouteSteps(ctx, helpers);
}

async function windowTitleSteps(
  { app, book, runMenu }: Context,
  { step, windowTitle, titles }: Helpers,
) {
  await step("window title: the home screen has a title that is not empty", async () => {
    await runMenu("file.close").catch(() => {});
    await app.js("location.reload()").catch(() => {});
    await app.sleep(3000);
    titles.home = await windowTitle();
    assert(titles.home.trim() !== "", "the window title is empty");
    return `home: "${titles.home}" (document.title "${await app.js<string>("document.title")}")`;
  });

  await step("window title: Settings has its own title (names the screen)", async () => {
    await runMenu("app.settings");
    titles.settings = await windowTitle();
    assert(
      titles.settings !== titles.home,
      `Settings has the same window title as home ("${titles.settings}"); a screen reader user cannot tell which screen is open from the title`,
    );
    return `settings: "${titles.settings}"`;
  });

  await step("window title: an open book is named in the title", async () => {
    await app.js("location.reload()").catch(() => {});
    await app.sleep(3000);
    await runMenu("file.openRecent", book);
    await app.sleep(2000);
    titles.book = await windowTitle();
    assert(
      titles.book.includes("Scenario Book"),
      `the window title "${titles.book}" does not name the open book`,
    );
    assert(titles.book !== titles.home, "the book and home share a title");
    return `book: "${titles.book}"`;
  });
}

async function focusSteps({ app }: Context, { step, where }: Helpers) {
  await step(
    "focus: web content has focus after launch (a control or the page, not nothing)",
    async () => {
      const w = await where();
      assert(
        w.hasFocus,
        "document.hasFocus() is false: the window is not key (is the app in front?)",
      );
      return `hasFocus; active ${w.tag} "${w.label}"${w.inBody ? " (the page body)" : ""}`;
    },
  );

  await step(
    "focus: after the window is deactivated and activated again, web content still has focus (tauri#15624 shape)",
    async () => {
      await app.js(`document.querySelector(".ProseMirror")?.focus(); "focused"`);
      const before = await where();
      const away = switchAway();
      if (!away.ok) return `NOT RUN: ${away.why}`;
      await app.sleep(1200);
      const away1 = await where();
      const back = switchBack();
      if (!back.ok) return `NOT RUN (could not reactivate): ${back.why}`;
      await app.sleep(1500);
      const after = await where();
      assert(after.hasFocus, `after reactivation document.hasFocus() is false (${back.how})`);
      assert(!after.inBody, `after reactivation the focus is on the page body, not a control`);
      assert(
        after.tag === before.tag && after.label === before.label,
        `focus moved from ${before.tag} "${before.label}" to ${after.tag} "${after.label}"`,
      );
      return `${away.how}; hasFocus while away ${away1.hasFocus}; back via ${back.how}; focus kept on ${after.tag}`;
    },
  );
}

async function dialogRouteSteps({ app, book, runMenu }: Context, { step }: Helpers) {
  // Dialog routes. The bridge cannot send key events, so reach is checked from the DOM: focus is inside the dialog, its
  // controls are in the Tab order, and Escape (the key the app handles on the document) closes it.
  const dialogReach = (id: string, arg?: string) => async () => {
    await runMenu(id, arg);
    const r = JSON.parse(
      await app.js<string>(`JSON.stringify((() => {
        const d = document.querySelector('[role="dialog"]');
        if (!d) return { open: false };
        const tabbable = [...d.querySelectorAll('button,[href],input,select,textarea,[tabindex]')].filter((e) => !e.disabled && e.tabIndex >= 0 && e.getClientRects().length > 0);
        return { open: true, name: d.getAttribute("aria-label") || d.querySelector("h1,h2")?.textContent || "", focusInside: d.contains(document.activeElement), tabbable: tabbable.length, outside: [...document.querySelectorAll("main,header,nav")].filter((e) => !e.closest("[inert],[aria-hidden=true]") && !d.contains(e) && !e.contains(d)).length };
      })())`),
    ) as { open: boolean; name: string; focusInside: boolean; tabbable: number; outside: number };
    assert(r.open, `${id} did not open a dialog`);
    assert(r.focusInside, `${id}: focus is not inside the "${r.name}" dialog`);
    assert(r.tabbable >= 1, `${id}: the "${r.name}" dialog has no control in the Tab order`);
    await app.js(
      `document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); "esc"`,
    );
    await app.sleep(600);
    const still = await app.js<boolean>(`!!document.querySelector('[role="dialog"]')`);
    assert(!still, `${id}: Escape did not close the "${r.name}" dialog`);
    return `"${r.name}": focus inside, ${r.tabbable} controls in Tab order, Escape closes`;
  };

  await step("dialog routes (book): Book details by keyboard", dialogReach("file.bookDetails"));
  await step(
    "dialog routes (book): Import into this book by keyboard",
    dialogReach("file.importInto"),
  );
  await step("dialog routes (book): Find by keyboard", async () => {
    await runMenu("edit.find");
    const focused = await app.js<boolean>(
      `!!document.activeElement && !!document.activeElement.closest('[role="search"]')`,
    );
    assert(focused, "Find did not move focus into the find bar");
    await app.js(
      `document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); "esc"`,
    );
    await app.sleep(400);
    return "focus in the find bar";
  });

  await step("dialog routes (home): the native picker buttons are in the Tab order", async () => {
    await runMenu("file.close");
    await app.sleep(800);
    const r = JSON.parse(
      await app.js<string>(`JSON.stringify(["New project", "Open folder", "Import…"].map((n) => {
        const b = [...document.querySelectorAll("button")].find((b) => (b.textContent.trim() || b.getAttribute("aria-label")) === n);
        return { n, ok: !!b && !b.disabled && b.tabIndex >= 0 && !b.closest("[inert]") };
      }))`),
    ) as { n: string; ok: boolean }[];
    const bad = r.filter((x) => !x.ok).map((x) => x.n);
    assert(bad.length === 0, `not reachable by Tab: ${bad.join(", ")}`);
  });

  await step("dialog routes (home): New book and Import a manuscript by keyboard", async () => {
    const a = await dialogReach("file.new")();
    const b = await dialogReach("file.import")();
    return `${a}; ${b}`;
  });

  await step(
    "dialog routes (home): the trigger button gets focus back when its dialog closes",
    async () => {
      await app.js(
        `(() => { const b = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "New project"); b.focus(); b.click(); return "opened"; })()`,
      );
      await app.sleep(700);
      await app.js(
        `document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); "esc"`,
      );
      await app.sleep(700);
      const label = await app.js<string>(`(document.activeElement?.textContent ?? "").trim()`);
      assert(label === "New project", `focus went to "${label}" instead of back to New project`);
      // Leave the book open for the steps that follow.
      await runMenu("file.openRecent", book);
      await app.sleep(2000);
    },
  );
}
