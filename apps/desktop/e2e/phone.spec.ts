import { expect, test, type Page } from "./support/coverage";
import { audit } from "./support/audit";
import { fakeImportSources } from "./support/fakeImport";
import { fakeTauri } from "./support/fakeTauri";
import { chapterAction, newProject, seedSnapshot } from "./support/helpers";

// Phone layouts: no horizontal scroll, controls reachable and at least 44px on touch, dialogs that scroll inside the
// viewport, and the editor with the soft keyboard open (emulated by shrinking the viewport height).
const SIZES = [
  { name: "390x844", width: 390, height: 844 },
  { name: "360x740", width: 360, height: 740 },
  { name: "844x390", width: 844, height: 390 },
] as const;

const shots = process.env.SHOTS;

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

type Open = (page: Page) => Promise<void>;
const more = (page: Page) => page.getByRole("button", { name: "More actions" });
// Wider than a phone (landscape), the header shows these as buttons instead of the More menu.
const moreItem = async (page: Page, name: string) => {
  if (await more(page).isVisible()) {
    await more(page).click();
    await page.getByRole("menuitem", { name }).click();
  } else await page.getByRole("button", { name, exact: true }).first().click();
};
const editorOpen = async (page: Page) => {
  await newProject(page);
};
const exportFormat =
  (format: string): Open =>
  async (page) => {
    await newProject(page);
    await moreItem(page, "Export");
    await page
      .getByRole("dialog", { name: "Export book" })
      .getByRole("radio", { name: format })
      .click();
  };

const SCREENS: Record<string, Open> = {
  "home without books": async (page) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "New project" })).toBeVisible();
  },
  "home with books": async (page) => {
    await newProject(page);
    await page.reload();
    await expect(page.getByRole("region", { name: "Recent projects" })).toBeVisible();
  },
  "new book dialog": async (page) => {
    await page.goto("/");
    await page.getByRole("button", { name: "New project" }).click();
    await expect(page.getByRole("dialog", { name: "New book" })).toBeVisible();
  },
  "import wizard": async (page) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Import…" }).click();
    await expect(page.getByRole("dialog", { name: "Import a manuscript" })).toBeVisible();
  },
  "import wizard preview with merged chapters": async (page) => {
    await fakeImportSources(page, "md3");
    await page.goto("/");
    await page.getByRole("button", { name: "Import…" }).click();
    const dialog = page.getByRole("dialog", { name: "Import a manuscript" });
    await dialog.getByRole("button", { name: "Choose file…" }).click();
    await dialog.getByRole("button", { name: "Choose…" }).click();
    await dialog.getByRole("button", { name: "Next" }).click();
    await dialog.getByRole("button", { name: "Merge chapter 2 into the previous one" }).click();
    await expect(dialog.getByRole("button", { name: /^Split chapter 1/ })).toBeVisible();
  },
  "import into this book": async (page) => {
    await fakeImportSources(page, "md3", false);
    await newProject(page);
    if (await more(page).isVisible()) await moreItem(page, "Import into this book");
    else {
      // Wider than a phone the File menu has it (there is no header button for it).
      await page.waitForFunction(() => "__cadabraMenu" in window);
      await page.evaluate(() =>
        (window as never as { __cadabraMenu: { run: (id: string) => boolean } }).__cadabraMenu.run(
          "file.importInto",
        ),
      );
    }
    const dialog = page.getByRole("dialog", { name: "Import into this book" });
    await dialog.getByRole("button", { name: "Choose file…" }).click();
    await dialog.getByRole("button", { name: "Next" }).click();
    await expect(dialog.getByLabel("Title of chapter 3")).toBeVisible();
  },
  editor: editorOpen,
  "header menu": async (page) => {
    await newProject(page);
    test.skip(!(await more(page).isVisible()), "the More menu only exists below the md breakpoint");
    await more(page).click();
    await expect(page.getByRole("menuitem", { name: "Focus mode" })).toBeVisible();
  },
  "book details with publishing details": async (page) => {
    await newProject(page);
    await moreItem(page, "Book details");
    const dialog = page.getByRole("dialog", { name: "Book details" });
    await dialog.getByText("Publishing details").click();
    await expect(dialog.getByText("Publishing details")).toBeVisible();
  },
  "export EPUB": exportFormat("EPUB 3"),
  "export PDF": exportFormat("Print PDF"),
  "export audiobook": exportFormat("Audiobook"),
  "export Markdown": exportFormat("Markdown"),
  "export Word": exportFormat("Word"),
  settings: async (page) => {
    await newProject(page);
    await moreItem(page, "Settings");
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  },
  "history dialog": async (page) => {
    await newProject(page);
    await page.locator(".ProseMirror").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type("Marta walked home");
    await page.getByRole("button", { name: "Save" }).or(more(page)).first().click();
    await seedSnapshot(page, "Ilse walked home");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Show chapters" }).click();
    await chapterAction(page, "Chapter One", "History");
    await expect(page.getByRole("dialog", { name: "History · Chapter One" })).toBeVisible();
  },
  "find bar": async (page) => {
    await newProject(page);
    await page.locator(".ProseMirror").click();
    await page.keyboard.press("ControlOrMeta+f");
    await page.keyboard.type("chapter");
    await expect(page.getByRole("search")).toBeVisible();
  },
  "recovery dialog": async (page) => {
    await newProject(page);
    const { file, path } = await seedSnapshot(page, "the newer text");
    await page.evaluate((x) => sessionStorage.setItem("stale", JSON.stringify([x])), {
      path: file,
      snapshot: path,
    });
    await page.reload();
    await page.getByRole("button", { name: "Open folder" }).click();
    await expect(page.getByRole("dialog", { name: /Recover newer text/ })).toBeVisible();
  },
  "sponsor dialog": async (page) => {
    await page.addInitScript(() => {
      if (sessionStorage.getItem("sponsorTest")) return;
      sessionStorage.setItem("sponsorTest", "1");
      localStorage.removeItem("cadabracraft.sponsor");
    });
    await newProject(page);
    await moreItem(page, "Export");
    await page
      .getByRole("dialog", { name: "Export book" })
      .getByRole("button", { name: "Export", exact: true })
      .click();
    await expect(page.getByRole("dialog", { name: "Enjoying CadabraCraft?" })).toBeVisible();
  },
  "project error": async (page) => {
    await page.goto("/");
    await page.evaluate(() =>
      localStorage.setItem(
        "cadabracraft.recents",
        JSON.stringify([{ root: "/gone", title: "Moved Book", openedAt: 1 }]),
      ),
    );
    await page.reload();
    await page
      .getByRole("button", { name: /Moved Book/ })
      .first()
      .click();
    await expect(page.getByText("Folder not found.")).toBeVisible();
  },
};

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height }, hasTouch: true });

    for (const [name, open] of Object.entries(SCREENS)) {
      test(`${name}: no horizontal scroll, nothing clipped, touch targets and dialogs fit`, async ({
        page,
      }) => {
        await open(page);
        if (shots)
          await page.screenshot({ path: `${shots}/${size.name}-${name.replaceAll(" ", "-")}.png` });
        const phone = size.width < 768;
        const issues = (await audit(page)).filter(
          // Landscape phones are wider than the md breakpoint, where the desktop 36px buttons apply.
          (i) => phone || (i.kind !== "small" && i.kind !== "truncated"),
        );
        expect(issues).toEqual([]);
      });
    }
  });
}
