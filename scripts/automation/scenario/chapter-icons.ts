import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, type Context } from "./context.ts";

/** Chapter icon and per-chapter first letter: picked from the sidebar row menu and written to cadabra.json by the real app. */
export async function chapterIconsSteps({ app, book, shot, step }: Context) {
  const chapter = () => JSON.parse(readFileSync(join(book, "cadabra.json"), "utf8")).chapters[0];
  const openRowMenu = () =>
    app.js(
      `(() => { const b = document.querySelector('button[aria-label="Actions for Chapter One"]'); if (!b) throw new Error("no row menu"); b.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" })); return b.getAttribute("aria-label"); })()`,
    );
  const clickItem = (role: string, name: string) =>
    app.js(
      `(() => { const i = [...document.querySelectorAll('[role="${role}"]')].find((i) => i.textContent.trim().startsWith(${JSON.stringify(name)})); if (!i) throw new Error("no ${role}: ${name}"); i.click(); return "clicked"; })()`,
    );
  const waitFor = async (ok: () => boolean) => {
    for (let i = 0; i < 20 && !ok(); i++) await app.sleep(300);
    return ok();
  };

  await step(
    "chapter icon: picked in a dialog, shown in the sidebar and written to cadabra.json",
    async () => {
      await openRowMenu();
      await app.sleep(400);
      await clickItem("menuitem", "Change icon");
      await app.sleep(600);
      await app.js(
        `(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === "Moon" || b.getAttribute("aria-label") === "Moon"); if (!b) throw new Error("no Moon button"); b.click(); return "picked"; })()`,
      );
      assert(await waitFor(() => chapter().icon === "moon"), `icon not saved: ${chapter().icon}`);
      const shown = await app.js<number>(
        `document.querySelector('button[aria-label="Actions for Chapter One"]')?.parentElement?.querySelectorAll("svg[aria-hidden='true']").length ?? 0`,
      );
      await shot("13-chapter-icon");
      return `icon "moon" on disk; ${shown} decorative icons in the row`;
    },
  );

  await step("chapter first letter: Big from the row menu is written to disk", async () => {
    await openRowMenu();
    await app.sleep(400);
    await clickItem("menuitemradio", "Big");
    assert(
      await waitFor(() => chapter().dropCap === true),
      `dropCap not saved: ${chapter().dropCap}`,
    );
    return "dropCap true";
  });
}
