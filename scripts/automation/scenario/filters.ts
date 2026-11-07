import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { assert, type Context } from "./context.ts";
import { diskHelpers, featureBookRoot, reopenFeatureBook, until } from "./feature-book.ts";

const q = (v: unknown) => JSON.stringify(v);

const scene = (id: string, title: string, pov: string, status: string, label: string) => ({
  type: "scene",
  attrs: { id, title, pov, status, label },
  content: [{ type: "paragraph", content: [{ type: "text", text: `${title} happens.` }] }],
});

/** Scene board and Timeline filters: POV and Status menus, the count, the move controls, what is remembered and Clear. */
export async function filterSteps(ctx: Context) {
  const { app, step, shot, runMenu } = ctx;
  const root = featureBookRoot(ctx);
  const disk = diskHelpers(root);
  const count = () =>
    app.js<string>(`document.querySelector("[data-scene-count]")?.textContent?.trim() ?? ""`);
  const grips = () => app.js<number>(`document.querySelectorAll("[data-grip-for]").length`);
  const caption = () =>
    app.js<boolean>(
      `document.body.innerText.includes("Moving scenes is off while a filter is on")`,
    );
  const saved = async () => {
    const raw = await app.js<string | null>(`localStorage.getItem("cadabracraft.sceneFilters")`);
    const all = raw ? JSON.parse(raw) : {};
    return all[root] as
      { filter: { pov: string[]; status: string[]; label: string[]; query: string } } | undefined;
  };
  /** Opens a facet menu (Radix opens on pointerdown) and ticks the value whose text starts with `word`. */
  const tick = async (facet: string, word: string) => {
    await app.js(
      `(() => { const b = document.querySelector('[data-facet=${q(facet)}]'); if (!b) throw new Error("no ${facet} menu"); b.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" })); return "opened"; })()`,
    );
    await app.sleep(400);
    await app.js(
      `(() => { const i = [...document.querySelectorAll('[role="menuitemcheckbox"]')].find((i) => i.textContent.trim().startsWith(${q(word)})); if (!i) throw new Error("no value ${word}: " + [...document.querySelectorAll('[role="menuitemcheckbox"]')].map((i) => i.textContent).join(" | ")); i.click(); return "ticked"; })()`,
    );
    await app.sleep(300);
    await app.js(
      `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`,
    );
    await app.sleep(300);
  };
  const openBoard = async () => {
    await runMenu("view.board");
    await until(
      ctx,
      async () => (await count()).endsWith("scenes"),
      "the board shows no scene count",
    );
    await app.sleep(800);
  };

  await step(
    "scene board filters: POV and Status narrow the count ('N of M scenes'), moving is off with its caption, the filter is remembered after reopening, Clear brings everything back",
    async () => {
      // Four scenes in a chapter that is not open, written like any outside tool would; the book is opened again to read them.
      const file = join(root, disk.chapterNamed("Imported Two").files.en!);
      const doc = JSON.parse(disk.read(disk.chapterNamed("Imported Two").files.en!));
      doc.content.push(
        scene("sc-a1", "Dawn arrival", "Ana", "draft", "Act 1"),
        scene("sc-a2", "Quiet harbour", "Ana", "final", "Act 1"),
        scene("sc-b1", "The letter", "Ben", "draft", "Act 2"),
        scene("sc-b2", "Night watch", "Ben", "outline", "Act 2"),
      );
      writeFileSync(file, JSON.stringify(doc));
      await reopenFeatureBook(ctx);
      await openBoard();
      await until(ctx, async () => (await grips()) === 4, `expected 4 grips, got ${await grips()}`);
      assert((await count()) === "4 scenes", `unfiltered count: "${await count()}"`);
      assert(!(await caption()), "the caption shows without a filter");
      await app.js(`localStorage.removeItem("cadabracraft.sceneFilters")`);

      await tick("POV", "Ana");
      assert((await count()) === "2 of 4 scenes", `after POV Ana: "${await count()}"`);
      await tick("Status", "Draft");
      assert((await count()) === "1 of 4 scenes", `after Ana + Draft: "${await count()}"`);
      assert(await caption(), "no 'Moving scenes is off' caption while a filter is on");
      assert((await grips()) === 0, `${await grips()} drag grips are still shown while filtering`);
      assert(
        (await app.snapshot()).buttons.includes("Clear"),
        "no Clear button while a filter is on",
      );
      assert(
        (await app.js<string>(`document.body.innerText`)).includes("Dawn arrival") &&
          !(await app.js<string>(`document.body.innerText`)).includes("Night watch"),
        "the board does not show only the scene that passes",
      );
      await shot("26-board-filter");
      const stored = await saved();
      assert(
        stored?.filter.pov.join().toLowerCase() === "ana" &&
          stored.filter.status.join() === "draft",
        `the filter was not remembered in localStorage: ${JSON.stringify(stored)}`,
      );

      // Remembered per book, so it is still on after the page and the book are opened again.
      await reopenFeatureBook(ctx);
      await openBoard();
      assert((await count()) === "1 of 4 scenes", `after reopening: "${await count()}"`);
      assert(await caption(), "the caption is gone after reopening");

      // The Timeline shares the same filter.
      await app.click("Back");
      await app.sleep(800);
      await runMenu("view.timeline");
      await until(
        ctx,
        async () => (await count()).includes("of 4"),
        "the timeline lost the filter",
      );
      assert((await count()) === "1 of 4 scenes", `timeline count: "${await count()}"`);
      await app.click("Back");
      await app.sleep(800);
      await openBoard();

      await app.click("Clear");
      await app.sleep(500);
      assert((await count()) === "4 scenes", `after Clear: "${await count()}"`);
      assert(!(await caption()), "the caption stays after Clear");
      await until(ctx, async () => (await grips()) === 4, "the drag grips did not come back");
      const cleared = await saved();
      assert(
        cleared?.filter.pov.length === 0 && cleared.filter.status.length === 0,
        `Clear was not remembered: ${JSON.stringify(cleared)}`,
      );
      await app.click("Back").catch(() => {});
      await app.sleep(800);
      return "4 scenes; Ana -> 2 of 4; Ana + Draft -> 1 of 4, no grips, caption; remembered after reopening and on the timeline; Clear -> 4 scenes with grips";
    },
  );
}
