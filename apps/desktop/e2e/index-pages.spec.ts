import { expect, test } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { addPage, manifestOf, newProject, seedChapters, sidebar } from "./support/helpers";

test.use({ viewport: { width: 1280, height: 1000 } });

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

const chapter = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "One" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "The " },
        {
          type: "text",
          text: "orchard wall",
          marks: [{ type: "indexEntry", attrs: { id: "a", term: "Orchard" } }],
        },
      ],
    },
  ],
};

test("an index and a glossary page can be added to the back matter, placed, and read in the editor", async ({
  page,
}) => {
  await newProject(page);
  await seedChapters(page, [chapter]);
  await addPage(page, "About the author");
  await addPage(page, "Index");
  // The list is generated from the marks and cannot be typed into.
  await expect(page.locator(".ProseMirror h1")).toHaveText("Index");
  await expect(page.locator(".ProseMirror")).toContainText("Orchard");
  await expect(page.locator(".ProseMirror")).toHaveAttribute("contenteditable", "false");
  await addPage(page, "Glossary");
  await expect(page.locator(".ProseMirror h1")).toHaveText("Glossary");
  const m = await manifestOf(page);
  expect(m.backMatter.map((e: { kind: string }) => e.kind)).toEqual([
    "about-the-author",
    "index",
    "glossary",
  ]);
  expect(m.formatVersion).toBe(15);
  expect(m.index.enabled).toBe(true);
  expect(m.glossary.enabled).toBe(true);
  // Each is offered once.
  await page.getByRole("button", { name: "Add page" }).click();
  await expect(page.getByRole("menuitem", { name: "Index", exact: true })).toBeDisabled();
  await expect(page.getByRole("menuitem", { name: "Glossary", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(sidebar(page).getByRole("button", { name: "Index", exact: true })).toBeVisible();
});
