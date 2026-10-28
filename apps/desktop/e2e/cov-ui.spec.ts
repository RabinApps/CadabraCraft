import { expect, test } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { chapterAction, newProject } from "./support/helpers";

// Coverage note: V8 counters are lost on page.reload(), so these specs never reload after the interaction they cover.

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

test("home: untitled recents, a failing folder picker, an author left empty and Cancel", async ({
  page,
}) => {
  await page.addInitScript(() => {
    // Wraps the fake backend (registered first): the folder picker can be made to fail.
    const real = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = (cmd, a, o) =>
      cmd === "plugin:dialog|open" && sessionStorage.getItem("pickFails")
        ? Promise.reject({ kind: "io", message: "picker broke" })
        : real(cmd, a, o);
    if (!localStorage.getItem("cadabracraft.recents"))
      localStorage.setItem(
        "cadabracraft.recents",
        JSON.stringify([{ root: "/proj", title: "", openedAt: 1 }]),
      );
  });
  await page.goto("/");
  const recent = page.getByRole("region", { name: "Recent projects" });
  await expect(recent.getByText("Untitled")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove /proj from recent projects" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "New project" }).click();
  const dialog = page.getByRole("dialog", { name: "New book" });
  await expect(dialog.getByRole("button", { name: "Create book" })).toBeDisabled();
  // A disabled submit button blocks Enter, so the form is submitted directly: nothing is created without a title and folder.
  await dialog.locator("form").evaluate((f: HTMLFormElement) => f.requestSubmit());
  await expect(dialog).toBeVisible();

  await page.evaluate(() => sessionStorage.setItem("pickFails", "1"));
  await dialog.getByRole("button", { name: "Choose…" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await page.evaluate(() => sessionStorage.removeItem("pickFails"));
  await dialog.getByRole("button", { name: "Choose…" }).click();
  await expect(dialog.getByLabel("Folder")).toHaveValue("/proj");
  await expect(dialog.getByRole("alert")).toHaveCount(0);

  // Cancel clears the form.
  await dialog.getByLabel("Title").fill("Scratch");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "New project" }).click();
  await expect(dialog.getByLabel("Title")).toHaveValue("");
  await expect(dialog.getByLabel("Folder")).toHaveValue("");

  // No author: the book is made with "Unknown".
  await dialog.getByLabel("Title").fill("Anonymous Book");
  await dialog.getByRole("button", { name: "Choose…" }).click();
  await expect(dialog.getByLabel("Folder")).toHaveValue("/proj");
  await dialog.getByRole("button", { name: "Create book" }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter One");
  expect(await page.evaluate(() => window.__disk["cadabra.json"])).toContain("Unknown");
});

test("the delete confirmation can be cancelled", async ({ page }) => {
  await newProject(page);
  await page.getByRole("button", { name: "Add chapter" }).click();
  await chapterAction(page, "Chapter 2", "Move to trash");
  const dialog = page.getByRole("dialog", { name: /to trash\?/ });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Chapter 2", exact: true })).toBeVisible();
});
