import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { manifestOf, newProject } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

const rail = (page: Page) => page.getByRole("region", { name: "Comments" });
const commentsButton = (page: Page) =>
  page.getByRole("button", { name: "Comments", exact: true }).first();

/** Types a sentence at the end of the open page's heading and selects it. */
async function selectText(page: Page) {
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" The keeper waited.");
  await page.keyboard.press("Shift+Home");
}

test.describe("comments", () => {
  test("shows a page with no comments, and asks for a selection", async ({ page }) => {
    await newProject(page);
    await commentsButton(page).click();
    await expect(rail(page)).toBeVisible();
    await expect(rail(page).getByText("No open comments on this page.")).toBeVisible();
    await expect(rail(page).getByLabel("New comment")).toBeDisabled();
    await expect(rail(page).getByRole("button", { name: "Add comment" })).toBeDisabled();
  });

  test("comments on selected text, replies and resolves, and saves beside the book", async ({
    page,
  }) => {
    await newProject(page);
    await selectText(page);
    await commentsButton(page).click();
    const comment = rail(page).getByLabel("New comment");
    await expect(comment).toBeEnabled();
    await comment.fill("Check the timing here.");
    await rail(page).getByRole("button", { name: "Add comment" }).click();

    const thread = rail(page).getByRole("listitem").first();
    await expect(thread).toContainText("Check the timing here.");
    await expect(thread).toContainText("keeper waited");
    await expect(rail(page).getByText("1 open")).toBeVisible();
    // Written as the book's author, with the time it was written.
    const m = await manifestOf(page);
    const file = `comments/${m.chapters[0].id}.json`;
    const saved = await page.evaluate((f) => JSON.parse(window.__disk[f] as string), file);
    expect(saved.threads).toHaveLength(1);
    expect(saved.threads[0]).toMatchObject({ author: "Tester", resolved: false, replies: [] });

    await rail(page).getByRole("button", { name: "Reply" }).click();
    await rail(page).getByLabel("Reply to Tester").fill("Agreed, moving it later.");
    await rail(page).getByRole("button", { name: "Reply", exact: true }).click();
    await expect(thread).toContainText("Agreed, moving it later.");

    await rail(page).getByRole("button", { name: "Resolve", exact: true }).click();
    await expect(rail(page).getByText("No open comments on this page.")).toBeVisible();
    await rail(page).getByRole("button", { name: "Resolved", exact: true }).click();
    await expect(rail(page).getByRole("listitem").first()).toContainText(
      "Agreed, moving it later.",
    );
    await expect(rail(page).getByRole("button", { name: "Reopen", exact: true })).toBeVisible();
    const after = await page.evaluate((f) => JSON.parse(window.__disk[f] as string), file);
    expect(after.threads[0].resolved).toBe(true);
    expect(after.threads[0].replies[0].body).toBe("Agreed, moving it later.");
  });

  test("closes the rail from its own button", async ({ page }) => {
    await newProject(page);
    await commentsButton(page).click();
    await expect(rail(page)).toBeVisible();
    await rail(page).getByRole("button", { name: "Close comments" }).click();
    await expect(rail(page)).toHaveCount(0);
  });
});
