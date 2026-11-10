import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { menu } from "../e2e/support/a11yScreenHelpers";
import { fakeTauri } from "../e2e/support/fakeTauri";
import { dayKey, seedWritingStats } from "../e2e/support/writingStats";

// Generates the website's product screenshots from the real UI (in-memory fake backend, sample book "The Salt Orchard").
//   pnpm screenshots:website                      all shots, light and dark, into apps/website/public/screens
//   SHOTS=editor,export pnpm screenshots:website  only these shots
//   SCREENSHOT_DIR=/tmp/shots SCALE=1 pnpm screenshots:website
// Add a shot by adding an entry to SHOTS below; the file name is `<name>-<light|dark>.png`.

const OUT = path.resolve(
  process.env.SCREENSHOT_DIR ?? path.join(import.meta.dirname, "../../website/public/screens"),
);
const SCALE = Number(process.env.SCALE) || 2;
const ONLY = process.env.SHOTS?.split(",").map((s) => s.trim());
const SCHEMES = ["light", "dark"] as const;
const VIEWPORT = { width: 1440, height: 900 };

const chapter = (title: string, paragraphs: string[]) => ({
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: title }] },
    ...paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
  ],
});

const CHAPTERS = [
  chapter("The Lantern", [
    "Nell found the lantern on the last day of October, hanging from a hook that had not been there the night before.",
    "It was cold to the touch and smelled faintly of salt, though the sea was a long day's walk behind the hills.",
  ]),
  chapter("A Door in the Hedge", [
    "The hedge had been trimmed flat for forty years, which was why nobody had noticed the door until the rain washed the moss from its hinges.",
    "Nell set the lantern on the step and listened. Behind the wood, something was humming a tune she almost knew.",
    "She had come to the orchard to forget the letter in her pocket. The door, it seemed, had other plans.",
    "When she lifted the latch, the humming stopped, and the whole hedge seemed to hold its breath.",
  ]),
  chapter("What the River Kept", [
    "The river had kept the bottle for a hundred winters before it let go.",
  ]),
  chapter("Salt and Ink", ["By the third week the pages smelled of the sea."]),
  chapter("Midwinter", ["Snow settled on the orchard wall and stayed."]),
] satisfies { content: unknown[] }[];

/** Creates the sample book, opens the second chapter and waits for fonts. */
async function openSampleBook(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New project" }).click();
  const dialog = page.getByRole("dialog", { name: "New book" });
  await dialog.getByLabel("Title").fill("The Salt Orchard");
  await dialog.getByLabel("Author").fill("Mara Quill");
  await dialog.getByRole("button", { name: "Choose…" }).click();
  await dialog.getByRole("button", { name: "Create book" }).click();
  await expect(page.locator(".ProseMirror h1")).toBeVisible();
  await page.evaluate((docs) => {
    const disk = window.__disk;
    const m = JSON.parse(disk["cadabra.json"] as string);
    const lang = Object.keys(m.chapters[0].files)[0]!;
    const first = m.chapters[0].files[lang] as string;
    m.chapters = docs.map((d, i) => {
      const file = i === 0 ? first : `manuscript/${String(i + 1).padStart(3, "0")}-chapter.json`;
      disk[file] = JSON.stringify(d);
      const title = (d.content[0] as { content: { text: string }[] }).content[0]!.text;
      return { id: `chapter-${i + 1}`, titles: { [lang]: title }, files: { [lang]: file } };
    });
    disk["cadabra.json"] = JSON.stringify(m);
    sessionStorage.setItem("disk", JSON.stringify(disk));
  }, CHAPTERS);
  await page.reload();
  await page.getByRole("button", { name: "Open folder" }).click();
  await page.getByRole("navigation", { name: "Chapters" }).getByText("A Door in the Hedge").click();
  await expect(page.locator(".ProseMirror h1").first()).toHaveText("A Door in the Hedge");
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator(".page").first()).toBeVisible();
  await page.waitForTimeout(1500);
  await page.locator(".ProseMirror h1").first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.mouse.move(0, 0);
}

type Shot = { name: string; prepare: (page: Page) => Promise<void> };

const SHOTS: Shot[] = [
  { name: "editor", prepare: async () => {} },
  {
    name: "export",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Export", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Export book" })).toBeVisible();
    },
  },
  {
    name: "history",
    prepare: async (page) => {
      const days: Record<string, number> = {};
      for (let i = 0; i < 60; i++) if (i % 7 !== 3) days[dayKey(-i)] = 250 + ((i * 137) % 900);
      await seedWritingStats(page, days);
      await menu(page, "file.writingHistory");
      await expect(page.getByRole("dialog", { name: "History" })).toBeVisible();
    },
  },
];

test.use({ viewport: VIEWPORT, deviceScaleFactor: SCALE });

for (const scheme of SCHEMES) {
  for (const shot of SHOTS.filter((s) => !ONLY || ONLY.includes(s.name))) {
    test(`${shot.name} (${scheme})`, async ({ page }) => {
      mkdirSync(OUT, { recursive: true });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await fakeTauri(page);
      await openSampleBook(page);
      await shot.prepare(page);
      await page.screenshot({ path: path.join(OUT, `${shot.name}-${scheme}.png`) });
    });
  }
}
