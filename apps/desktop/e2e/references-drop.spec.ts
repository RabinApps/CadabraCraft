import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { manifestOf, newProject } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

const panel = (page: Page) => page.getByRole("region", { name: "References" });
const titles = (page: Page) =>
  panel(page)
    .getByRole("listitem")
    .evaluateAll((li) => li.map((x) => x.querySelector("[data-title]")!.textContent));

async function openPanel(page: Page) {
  await newProject(page);
  await page.getByRole("button", { name: "References", exact: true }).first().click();
  await expect(panel(page)).toBeVisible();
}

/** Drops web data on the panel the way the browser reports it: dragenter, dragover, drop with a DataTransfer. */
async function dropWeb(
  page: Page,
  data: Record<string, string>,
  type: "drop" | "leave" | "enter" = "drop",
) {
  await panel(page).evaluate(
    (el, { data, type }) => {
      const dt = new DataTransfer();
      for (const [k, v] of Object.entries(data)) dt.setData(k, v);
      const fire = (name: string, related?: Element | null) =>
        el.dispatchEvent(
          new DragEvent(name, {
            dataTransfer: dt,
            bubbles: true,
            cancelable: true,
            relatedTarget: related ?? null,
          }),
        );
      fire("dragenter");
      fire("dragover");
      if (type === "drop") fire("drop");
      if (type === "leave") fire("dragleave", document.body);
    },
    { data, type },
  );
}

test.describe("dropping on the references panel", () => {
  test("shows that files over the window will be added, and stops when they leave", async ({
    page,
  }) => {
    await openPanel(page);
    await expect(panel(page)).not.toHaveAttribute("data-drop-active", "true");
    await expect(
      panel(page).getByRole("button", { name: "Drop files, links or text here" }),
    ).toBeVisible();
    await page.evaluate(() =>
      window.__emit!("tauri://drag-enter", { paths: ["/a.pdf"], position: { x: 0, y: 0 } }),
    );
    await expect(panel(page)).toHaveAttribute("data-drop-active", "true");
    await expect(
      panel(page).getByRole("button", { name: "Release to add files, links or text" }),
    ).toBeVisible();
    await page.evaluate(() => window.__emit!("tauri://drag-over", { position: { x: 0, y: 0 } }));
    await expect(panel(page)).toHaveAttribute("data-drop-active", "true");
    await page.evaluate(() => window.__emit!("tauri://drag-leave", {}));
    await expect(panel(page)).not.toHaveAttribute("data-drop-active", "true");
  });

  test("a file drop adds the file and clears the highlight", async ({ page }) => {
    await openPanel(page);
    await page.evaluate(() => {
      window.__emit!("tauri://drag-enter", {
        paths: ["/refs/dropped.pdf"],
        position: { x: 0, y: 0 },
      });
      window.__emit!("tauri://drag-drop", {
        paths: ["/refs/dropped.pdf"],
        position: { x: 0, y: 0 },
      });
    });
    await expect.poll(() => titles(page)).toEqual(["dropped"]);
    await expect(panel(page)).not.toHaveAttribute("data-drop-active", "true");
    expect((await manifestOf(page)).references[0]).toMatchObject({
      kind: "file",
      file: "references/dropped.pdf",
    });
  });

  test("an address dragged in becomes a link", async ({ page }) => {
    await openPanel(page);
    await dropWeb(page, {
      "text/uri-list": "# from a page\nhttps://saltmarsh.example.org/guide\n",
      "text/plain": "https://saltmarsh.example.org/guide",
    });
    await expect.poll(() => titles(page)).toEqual(["saltmarsh.example.org"]);
    expect((await manifestOf(page)).references[0]).toMatchObject({
      kind: "link",
      url: "https://saltmarsh.example.org/guide",
    });
    await expect(panel(page)).not.toHaveAttribute("data-drop-active", "true");
  });

  test("text dragged in becomes a note, and several addresses become several links", async ({
    page,
  }) => {
    await openPanel(page);
    await dropWeb(page, {
      "text/plain": "The wall is older than the gate.\nNobody picks fruit early.",
    });
    await expect.poll(() => titles(page)).toEqual(["The wall is older than the gate."]);
    await dropWeb(page, { "text/plain": "https://a.example.org/\nhttps://b.example.org/" });
    await expect
      .poll(() => titles(page))
      .toEqual(["The wall is older than the gate.", "a.example.org", "b.example.org"]);
    expect((await manifestOf(page)).references.map((r: { kind: string }) => r.kind)).toEqual([
      "note",
      "link",
      "link",
    ]);
  });

  test("shows the highlight while an address is over the panel and hides it on leave", async ({
    page,
  }) => {
    await openPanel(page);
    await dropWeb(page, { "text/plain": "x" }, "enter");
    await expect(panel(page)).toHaveAttribute("data-drop-active", "true");
    await dropWeb(page, { "text/plain": "x" }, "leave");
    await expect(panel(page)).not.toHaveAttribute("data-drop-active", "true");
    expect((await manifestOf(page)).references).toEqual([]);
  });

  test("a repeated address and a drag with no web data are reported or ignored", async ({
    page,
  }) => {
    await openPanel(page);
    await dropWeb(page, { "text/plain": "https://a.example.org/" });
    await expect.poll(() => titles(page)).toEqual(["a.example.org"]);
    await dropWeb(page, { "text/plain": "https://a.example.org/" });
    await expect(panel(page).getByRole("status")).toContainText(
      "This address is already in this book.",
    );
    await panel(page).getByRole("button", { name: "Dismiss" }).click();
    await dropWeb(page, { "text/x-custom": "nothing" });
    await dropWeb(page, { "text/plain": "   " });
    await dropWeb(page, { "text/uri-list": "file:///Users/me/a.pdf" });
    expect((await manifestOf(page)).references).toHaveLength(1);
  });

  test("text that is too long for a note is refused with a message", async ({ page }) => {
    await openPanel(page);
    await dropWeb(page, { "text/plain": "x".repeat(20_001) });
    await expect(panel(page).getByRole("alert")).toContainText("too long for a note");
    expect((await manifestOf(page)).references).toEqual([]);
  });
});
