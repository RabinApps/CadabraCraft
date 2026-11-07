import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, type Context } from "./context.ts";

/** A second, fresh book for the steps on the newer features (snapshots, import into a book, split, filters, typography). The first book has a French edition by now, which turns splitting off. */
export const featureBookRoot = (ctx: Context) => join(ctx.out, "feature-book");

type Chapter = { id: string; titles: Record<string, string>; files: Record<string, string> };

/** What is on disk: the manifest, the chapters in order and the files of a folder. */
export function diskHelpers(root: string) {
  const manifest = () => JSON.parse(readFileSync(join(root, "cadabra.json"), "utf8"));
  const chapters = (): Chapter[] => manifest().chapters;
  const titles = () => chapters().map((c) => c.titles.en);
  const list = (dir: string) => (existsSync(join(root, dir)) ? readdirSync(join(root, dir)) : []);
  const read = (rel: string) => readFileSync(join(root, rel), "utf8");
  const chapterNamed = (title: string) => {
    const c = chapters().find((x) => x.titles.en === title);
    assert(c, `no chapter "${title}" in the manifest: ${titles().join(", ")}`);
    return c;
  };
  return { manifest, chapters, titles, list, read, chapterNamed };
}

/** Reloads the page and opens the feature book again through the queued folder dialog. */
export async function reopenFeatureBook(ctx: Context) {
  const { app } = ctx;
  await app.js("location.reload()").catch(() => {});
  await app.sleep(3000);
  await app.queueDialogs([featureBookRoot(ctx)]);
  await app.click("Open folder");
  await app.sleep(2500);
}

/** Puts the caret at the end of the open chapter and inserts text there, as the editing steps do. */
export const typeAtEnd = (ctx: Context, text: string) =>
  ctx.app.js(
    `(() => { const ed = document.querySelector('.ProseMirror'); ed.focus(); const s = getSelection(); s.selectAllChildren(ed); s.collapseToEnd(); document.execCommand('insertText', false, ${JSON.stringify(text)}); })()`,
  );

/** Waits until `test` is true (polling every half second) and fails with `why` otherwise. */
export async function until(ctx: Context, test: () => boolean | Promise<boolean>, why: string) {
  for (let i = 0; i < 30; i++) {
    if (await test()) return;
    await ctx.app.sleep(500);
  }
  assert(false, why);
}

export async function featureBookSteps(ctx: Context) {
  const { app, step, shot } = ctx;
  const root = featureBookRoot(ctx);
  const disk = diskHelpers(root);
  await step(
    "feature book: a second book is created through the real dialogs for the steps on snapshots, import into a book, split, filters and typography",
    async () => {
      mkdirSync(root, { recursive: true }); // the folder picker takes an existing, empty folder
      await app.js("location.reload()").catch(() => {});
      await app.sleep(3000);
      await app.queueDialogs([root]);
      await app.click("New project");
      await app.sleep(500);
      await app.click("Choose…");
      await app.sleep(500);
      await app.fill(0, "Feature Book");
      await app.fill(1, "Agent");
      await app.click("Create book");
      await app.sleep(3000);
      const s = await app.snapshot();
      assert(s.headings.includes("Feature Book"), "the feature book did not open");
      await typeAtEnd(ctx, "Opening words of the feature book.");
      await until(
        ctx,
        () => disk.read(disk.chapterNamed("Chapter One").files.en!).includes("Opening words"),
        "the typed text did not reach the chapter file",
      );
      // A second chapter, so "After Chapter One" is not the end of the book.
      await app.js(`window.__cadabraMenu.run("insert.chapter")`);
      await until(ctx, () => disk.chapters().length === 2, "New Chapter did not add a chapter");
      await app.click("Chapter One").catch(() => {});
      await app.sleep(800);
      await shot("20-feature-book");
      return `created ${disk.titles().join(", ")}`;
    },
  );
}
