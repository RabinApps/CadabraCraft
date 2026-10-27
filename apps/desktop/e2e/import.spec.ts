import { expect, test, type Page } from "@playwright/test";
import { PNG_BYTES, TINY_MD, tinyDocx } from "./fixtures";

// Same idea as editor.spec.ts: the Tauri commands are faked in memory. Here the fake also serves the "source files"
// that the native picker would have returned, and records every command so we can assert the source is never written.
interface Fixtures { md: number[]; docx: number[]; png: number[]; html: number[] }
const fixtures = (): Fixtures => ({
  md: Array.from(new TextEncoder().encode(TINY_MD)),
  docx: Array.from(tinyDocx({ image: true })),
  png: Array.from(PNG_BYTES),
  html: Array.from(new TextEncoder().encode('<html><head><title>Web Page</title><script>stealCookies()</script></head><body><h1>Gamma</h1><p>Plain and <strong>strong</strong> text. <blink>x</blink></p></body></html>')),
});

async function fakeTauri(page: Page, pick: "md" | "docx" | "html" | "broken") {
  await page.addInitScript(([f, which]: [Fixtures, string]) => {
    if (!localStorage.getItem("cadabracraft.locale")) localStorage.setItem("cadabracraft.locale", "en");
    const sources: Record<string, number[]> = {
      "/src/My_Book.md": f.md,
      "/src/book.docx": f.docx,
      "/src/page.html": f.html,
      "/src/broken.docx": Array.from(new TextEncoder().encode("not a zip")),
    };
    const pickedSource = which === "md" ? "/src/My_Book.md" : which === "docx" ? "/src/book.docx" : which === "html" ? "/src/page.html" : "/src/broken.docx";
    const disk: Record<string, string | number[]> = {};
    const calls: { cmd: string; args: any }[] = [];
    const h = (s: string) => `${s.length}:${s.slice(0, 50)}`;
    const w = window as any;
    w.__disk = disk; w.__calls = calls; w.__sources = sources;
    w.__TAURI_INTERNALS__ = {
      transformCallback: () => 0,
      invoke: async (cmd: string, a: any) => {
        calls.push({ cmd, args: a });
        switch (cmd) {
          case "plugin:dialog|open": return a?.options?.filters?.[0]?.extensions?.includes("docx") ? pickedSource : "/newbook";
          case "plugin:event|listen": return 1;
          case "plugin:event|unlisten": return null;
          case "watch_project": return null;
          case "read_import_source": if (!sources[a.path]) throw `cannot read ${a.path}`; return sources[a.path];
          case "read_import_image": if (a.reference === "img/pixel.png") return f.png; throw `image not found: ${a.reference}`;
          case "import_asset_bytes": disk[`assets/${a.name}`] = a.bytes; return `assets/${a.name}`;
          case "create_project": disk["cadabra.json"] = a.manifestJson; return null;
          case "read_project_file": return typeof disk[a.path] === "string" ? { contents: disk[a.path], hash: h(disk[a.path] as string) } : null;
          case "write_project_file": disk[a.path] = a.contents; return { hash: h(a.contents), conflict_copy: null };
          case "read_asset": if (!Array.isArray(disk[a.path])) throw `missing ${a.path}`; return disk[a.path];
          case "backup_manifest": return "backup";
        }
        throw new Error(`unexpected command ${cmd}`);
      },
    };
  }, [fixtures(), pick] as [Fixtures, string]);
}

const chapterNav = (page: Page) => page.getByRole("navigation", { name: "Chapters" });

async function startImport(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Import…" }).click();
  const dialog = page.getByRole("dialog", { name: "Import a manuscript" });
  await dialog.getByRole("button", { name: "Choose file…" }).click();
  await expect(dialog.getByLabel("File")).not.toHaveValue("");
  await dialog.getByRole("button", { name: "Choose…" }).click();
  await expect(dialog.getByLabel("New book folder")).toHaveValue("/newbook");
  await dialog.getByRole("button", { name: "Next" }).click();
  return dialog;
}

test("importing Markdown creates a new project with chapters, shows the report, and leaves the source untouched", async ({ page }) => {
  await fakeTauri(page, "md");
  const dialog = await startImport(page);
  await dialog.getByRole("button", { name: "Back" }).click();
  await expect(dialog.getByLabel("Title")).toHaveValue("My Book"); // from the file name
  await dialog.getByRole("button", { name: "Next" }).click();
  await dialog.getByRole("button", { name: "Import", exact: true }).click();

  const report = page.getByRole("dialog", { name: "Import report" });
  await expect(report).toBeVisible();
  await expect(report).toContainText("Imported 2 chapters from My_Book.md.");
  await expect(report).toContainText("1 image added.");
  await expect(report.getByRole("region", { name: "Import warnings" })).toContainText("Raw HTML"); // the raw HTML was kept as text
  await expect(report.getByRole("button", { name: "Copy report" })).toBeVisible();
  await report.getByRole("button", { name: "Done" }).click();
  await expect(report).toBeHidden();
  await expect(chapterNav(page).getByRole("button", { name: "Alpha", exact: true })).toBeVisible();
  await expect(chapterNav(page).getByRole("button", { name: "Beta", exact: true })).toBeVisible();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Alpha");
  await expect(page.locator(".ProseMirror img")).toHaveCount(1);


  const result = await page.evaluate(() => {
    const w = window as any;
    return {
      sources: w.__sources as Record<string, number[]>,
      files: Object.keys(w.__disk) as string[],
      sourceWrites: (w.__calls as { cmd: string; args: any }[]).filter((c) => /^(write|create|import_asset|trash)/.test(c.cmd) && JSON.stringify(c.args).includes("/src/")).length,
    };
  });
  expect(Buffer.from(result.sources["/src/My_Book.md"]!).toString()).toBe(TINY_MD);
  expect(result.sourceWrites).toBe(0);
  expect(result.files).toEqual(expect.arrayContaining(["cadabra.json", "manuscript/001-alpha.json", "manuscript/002-beta.json", "assets/pixel.png"]));
  expect(result.files.every((f) => f === "cadabra.json" || f.startsWith("manuscript/") || f.startsWith("assets/"))).toBe(true);
});

test("importing a DOCX works the same way", async ({ page }) => {
  await fakeTauri(page, "docx");
  const dialog = await startImport(page);
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  const report = page.getByRole("dialog", { name: "Import report" });
  await expect(report).toContainText("Imported 2 chapters from book.docx.");
  await report.getByRole("button", { name: "Done" }).click();
  await expect(chapterNav(page).getByRole("button", { name: "Dawn", exact: true })).toBeVisible();
  await expect(chapterNav(page).getByRole("button", { name: "Dusk", exact: true })).toBeVisible();
});

test("importing an HTML file keeps headings and bold text, drops scripts and reports what was lost", async ({ page }) => {
  await fakeTauri(page, "html");
  const dialog = await startImport(page);
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  const report = page.getByRole("dialog", { name: "Import report" });
  await expect(report).toContainText("Imported 1 chapter from page.html.");
  await expect(report.getByRole("region", { name: "Import warnings" })).toContainText("Unsupported HTML elements");
  await report.getByRole("button", { name: "Done" }).click();
  await expect(chapterNav(page).getByRole("button", { name: "Gamma", exact: true })).toBeVisible();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Gamma");
  await expect(page.locator(".ProseMirror strong")).toHaveText("strong");
  const saved = await page.evaluate(() => JSON.stringify((window as any).__disk));
  expect(saved).not.toContain("stealCookies");
});

test("an unreadable file shows the error in the dialog and creates no project", async ({ page }) => {
  await fakeTauri(page, "broken");
  const dialog = await startImport(page);
  await expect(dialog.getByRole("alert")).toContainText("does not look like a valid .docx");
  await expect(dialog).toBeVisible();
  const created = await page.evaluate(() => Object.keys((window as any).__disk).length);
  expect(created).toBe(0);
});

test("the preview step lets the author rename and skip chapters before anything is written", async ({ page }) => {
  await fakeTauri(page, "md");
  const dialog = await startImport(page);
  await expect(dialog.getByLabel("Title of chapter 1")).toHaveValue("Alpha");
  expect(await page.evaluate(() => Object.keys((window as any).__disk).length)).toBe(0); // nothing written yet
  await dialog.getByLabel("Title of chapter 1").fill("Prologue");
  await dialog.getByLabel("Include chapter 2").uncheck();
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await page.getByRole("dialog", { name: "Import report" }).getByRole("button", { name: "Done" }).click();
  await expect(chapterNav(page).getByRole("button", { name: "Prologue", exact: true })).toBeVisible();
  await expect(chapterNav(page).getByRole("button", { name: "Beta", exact: true })).toHaveCount(0);
});
