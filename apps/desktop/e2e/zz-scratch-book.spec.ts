import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import path from "node:path";
import { test } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";

const BOOK = "/Users/alexrabin/Projects/BipolarToOneness";
const OUT = "/tmp/bip/app";
mkdirSync(OUT, { recursive: true });

function readBook() {
  const files: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const e of readdirSync(path.join(BOOK, dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) walk(rel);
      else if (e.name.endsWith(".json")) files[rel] = readFileSync(path.join(BOOK, rel), "utf8");
    }
  };
  walk("");
  return files;
}

test("scratch: the book's page view", async ({ page }) => {
  test.setTimeout(240_000);
  await fakeTauri(page);
  await page.goto("/");
  const files = readBook();
  await page.evaluate((f) => {
    const disk = window.__disk;
    for (const [k, v] of Object.entries(f)) disk[k] = v;
    sessionStorage.setItem("disk", JSON.stringify(disk));
  }, files);
  await page.reload();
  await page.getByRole("button", { name: "Open folder" }).click();
  await page.locator(".ProseMirror h1").first().waitFor();
  await page.getByLabel("Page zoom").selectOption({ label: "100%" });
  const nav = page.getByRole("navigation", { name: "Chapters" });
  const names = (await nav.locator("li > button").allTextContents()).filter((n) => n.trim());
  console.log("PAGES:", JSON.stringify(names));
  for (const [i, name] of names.entries()) {
    const label = name.trim().replace(/[^\w ]+/g, "").replace(/\s+/g, "-").slice(0, 30);
    await nav.getByRole("button", { name: name.trim(), exact: true }).first().click();
    await page.waitForTimeout(900);
    const cards = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="page-scroll"] .page')].map((c) => {
        const el = c as HTMLElement;
        return {
          blank: el.dataset.blank === "true",
          h: el.getBoundingClientRect().height,
          w: el.getBoundingClientRect().width,
        };
      }),
    );
    const metrics = await page.evaluate(() => {
      const stack = document.querySelector('.page-stack') as HTMLElement;
      const sr = stack.getBoundingClientRect();
      const zoom = Number(stack.dataset.zoom) || 1;
      const cards = [...stack.querySelectorAll('.page')].map((c) => {
        const r = c.getBoundingClientRect();
        return { top: Math.round((r.top - sr.top) / zoom), h: Math.round(r.height / zoom), blank: (c as HTMLElement).dataset.blank === 'true' };
      });
      const pm = document.querySelector('.ProseMirror') as HTMLElement;
      if (!pm) return { cards, column: null, blocks: [], h1: null };
      const cs = getComputedStyle(pm);
      const prr = pm.getBoundingClientRect();
      const blocks = [...pm.children].slice(0, 8).map((el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return {
          tag: el.tagName.toLowerCase(),
          text: (el.textContent ?? '').slice(0, 14),
          top: Math.round((r.top - sr.top) / zoom),
          left: Math.round((r.left - sr.left) / zoom),
          w: Math.round(r.width / zoom),
          h: Math.round(r.height / zoom),
          mt: s.marginTop,
          mb: s.marginBottom,
        };
      });
      return {
        zoom,
        stack: { w: Math.round(sr.width / zoom), h: Math.round(sr.height / zoom) },
        cards,
        column: { left: Math.round((prr.left - sr.left) / zoom), w: Math.round(prr.width / zoom), font: cs.fontSize, lh: cs.lineHeight, align: cs.textAlign, pad: cs.padding },
        outline: (() => {
          const out: string[] = [];
          const walk = (el: Element, d: number) => {
            if (d > 3) return;
            const r = el.getBoundingClientRect();
            out.push(`${'  '.repeat(d)}${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).slice(0, 40)} top=${Math.round((r.top - sr.top) / zoom)} h=${Math.round(r.height / zoom)} w=${Math.round(r.width / zoom)} l=${Math.round((r.left - sr.left) / zoom)}`);
            for (const c of el.children) walk(c, d + 1);
          };
          walk(stack, 0);
          return out;
        })(),
        padTop: parseFloat(getComputedStyle(stack).getPropertyValue('--page-mt')),
        padInside: parseFloat(getComputedStyle(stack).getPropertyValue('--page-ml')),
        padOutside: parseFloat(getComputedStyle(stack).getPropertyValue('--page-mr')),
        blocks,
        h1: (() => {
          const h = pm.querySelector('h1,h2');
          if (!h) return null;
          const s = getComputedStyle(h);
          const r = h.getBoundingClientRect();
          return { top: Math.round((r.top - sr.top) / zoom), left: Math.round((r.left - sr.left) / zoom), size: s.fontSize, mb: s.marginBottom, mt: s.marginTop, align: s.textAlign, lh: s.lineHeight };
        })(),
      };
    });
    console.log(`PAGE ${i} ${label}`, JSON.stringify(cards), JSON.stringify({ ...metrics, outline: undefined }));
    if (process.env.OUTLINE && label.includes(process.env.OUTLINE))
      console.log("OUTLINE\n" + metrics.outline.join("\n"));
    await page.screenshot({ path: `${OUT}/${String(i).padStart(2, "0")}-${label}.png`, fullPage: true });
  }
});
