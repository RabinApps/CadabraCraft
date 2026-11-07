import { expect, type Page } from "@playwright/test";
import { newProject, seedChapters } from "./helpers";

const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const heading = (text: string) => ({
  type: "heading",
  attrs: { level: 1 },
  content: [{ type: "text", text }],
});
const scene = (id: string, title: string, attrs: Record<string, unknown>) => ({
  type: "scene",
  attrs: { id, title, ...attrs },
  content: [para(`${title} words here`)],
});
const doc = (...content: unknown[]) =>
  ({ type: "doc", content }) as unknown as { content: never[] };

/**
 * A book to filter. Chapter One: Arrival (Mara, draft, label Past, Sep 3), Bargain (Ada, revised, label Past, no date), Chase
 * (mara in lower case, no status, label Dream, Sep 2). Chapter Two: Dawn (no POV, final, no label, Sep 4) and loose text.
 */
export async function filterBook(page: Page) {
  await newProject(page);
  await seedChapters(page, [
    doc(
      heading("Chapter One"),
      scene("a", "Arrival", {
        pov: "Mara",
        status: "draft",
        label: "Past",
        synopsis: "Mara reaches the quay.",
        date: "1893-09-03T18:40",
      }),
      scene("b", "Bargain", { pov: "Ada", status: "revised", label: "Past" }),
      scene("c", "Chase", { pov: "mara", label: "Dream", date: "1893-09-02" }),
    ),
    doc(
      heading("Chapter Two"),
      scene("d", "Dawn", { status: "final", date: "1893-09-04" }),
      para("Loose words after the last scene."),
    ),
  ]);
}

/** Runs a menu command by id (the phone hides the header buttons). */
const run = (page: Page, id: string) =>
  page.evaluate(
    (c) =>
      (window as never as { __cadabraMenu: { run: (id: string) => void } }).__cadabraMenu.run(c),
    id,
  );

export const openBoard = async (page: Page) => {
  await run(page, "view.board");
  await expect(page.getByRole("heading", { name: "Scene board", level: 1 })).toBeVisible();
};
export const openTimeline = async (page: Page) => {
  await run(page, "view.timeline");
  await expect(page.getByRole("heading", { name: "Timeline", level: 1 })).toBeVisible();
};

/** The facet button by its word ("POV"), whatever the badge says. */
export const facetButton = (page: Page, facet: "POV" | "Status" | "Label") =>
  page.getByRole("button", { name: new RegExp(`^${facet}( \\d+ selected)?$`) });

/** Opens a facet menu, ticks the values and closes the menu again. */
export async function pick(page: Page, facet: "POV" | "Status" | "Label", values: string[]) {
  await facetButton(page, facet).click();
  for (const v of values) await page.getByRole("menuitemcheckbox", { name: v }).click();
  await page.keyboard.press("Escape");
}

export const count = (page: Page) => page.locator("[data-scene-count]");
export const filterBar = (page: Page) => page.getByRole("region", { name: "Filter scenes" });
export const search = (page: Page) => page.getByRole("searchbox", { name: "Search scenes" });
