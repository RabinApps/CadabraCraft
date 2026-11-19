import { expect, test } from "../support/coverage";
import { fakeTauri } from "../support/fakeTauri";
import { screens } from "../support/a11yScreens";
import { newProject } from "../support/helpers";
import { fresh, screenRuns, sources } from "../support/a11yWcagExtra";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

// ---------------------------------------------------------------------------------------------------------------------------
// 1.3.3 Sensory Characteristics

test.describe("1.3.3 sensory characteristics", () => {
  // Instructions that name only a place, colour or shape ("the button on the right", "the red icon").
  const SENSORY =
    /\b(on the|to the|at the)\s+(left|right|top|bottom)\b|\b(left|right)[- ]hand\b|\b(above|below)\b(?! the)|\b(red|green|blue|yellow|orange)\s+(button|icon|text|dot|badge|line|circle|square)\b|\b(round|square|circular|triangular)\s+(button|icon)\b|\bclick the (?:\w+ )?(?:icon|button|dot)\b/i;
  // Reviewed matches that are names or measurements, not directions to look somewhere: the table commands "Add Row Below" and
  // "Add Column After" name an action, "Right-hand page" is the book term for a recto, and the bleed hint says which edges of the printed page grow.
  const DESCRIPTIVE = [
    /\bAdd (Row|Column) (Above|Below)\b/,
    /on the top, bottom and outside edges/,
    // A kind of page in a printed book (the chapter opener starts on a recto), not a direction to look.
    /^Right-hand page$/,
    // The same book term in the row menu's Page start choice and its announcement.
    /^Start on a right-hand page$/,
    // The Outline format's hint describes the layout of the exported file (a synopsis under its heading), not where to look in the app.
    /^A heading for each chapter and scene, the synopsis below it\.$/,
  ];
  for (const { name, open } of screens) {
    test(`no instruction on ${name} points only by place, colour or shape`, async ({ page }) => {
      await open(page);
      const text = await page.evaluate(() =>
        [
          document.body.innerText,
          ...[...document.querySelectorAll("[aria-label], [title], [placeholder]")].flatMap((e) => [
            e.getAttribute("aria-label"),
            e.getAttribute("title"),
            e.getAttribute("placeholder"),
          ]),
        ]
          .filter(Boolean)
          .join("\n"),
      );
      const hits = text
        .split("\n")
        .filter((l) => SENSORY.test(l) && !DESCRIPTIVE.some((d) => d.test(l)));
      expect(hits).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------------------
// 1.3.5 Identify Input Purpose and 3.3.7 Redundant Entry

/** Field labels that ask for a fact about the person using the app (the WCAG 2.2 list of input purposes). */
const ABOUT_THE_USER =
  /^(name|full name|first name|last name|given name|family name|e-?mail( address)?|phone|telephone|username|password|street address|postal code|zip|city|country|birthday|credit card|card number)$/i;

test.describe("1.3.5 identify input purpose", () => {
  for (const { name, open } of screens) {
    test(`no field on ${name} asks the person for their own details without an autocomplete purpose`, async ({
      page,
    }) => {
      await open(page);
      const fields = await page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLInputElement>(
            "input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea",
          ),
        ].map((el) => ({
          label: (el.labels?.[0]?.textContent ?? el.getAttribute("aria-label") ?? "")
            .replace(/\s+/g, " ")
            .trim(),
          autocomplete: el.getAttribute("autocomplete") ?? "",
        })),
      );
      const bad = fields.filter((f) => ABOUT_THE_USER.test(f.label) && !f.autocomplete);
      expect(bad).toEqual([]);
    });
  }

  test("the book's author field is not a field about the user (it names the book's author)", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "New project" }).click();
    const author = page.getByRole("dialog", { name: "New book" }).getByLabel("Author");
    // The author of a book is often someone else (a client, a translator's source), so no autofill purpose applies.
    expect(await author.getAttribute("autocomplete")).toBeNull();
  });
});

test.describe("3.3.7 redundant entry", () => {
  test("what was typed for the new book is already in every later form that asks for it", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await newProject(page);
    const values: Record<string, string[]> = {};
    const collect = async (where: string) => {
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.waitForTimeout(300); // the form is filled a moment after the dialog opens
      values[where] = await page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLInputElement>(
            "[role=dialog] input:not([type=checkbox]):not([type=radio]):not([type=hidden]), [role=dialog] textarea",
          ),
        ].map(
          (el) =>
            `${(el.labels?.[0]?.textContent ?? el.getAttribute("aria-label") ?? "").trim()}=${el.value}`,
        ),
      );
    };
    await page.getByRole("button", { name: "Book details" }).first().click();
    await collect("Book details");
    await page.keyboard.press("Escape");
    for (const format of ["EPUB 3", "Print PDF", "Audiobook"]) {
      await page.getByRole("button", { name: "Export", exact: true }).click();
      await page
        .getByRole("dialog", { name: "Export book" })
        .getByRole("radio", { name: format })
        .click();
      await collect(`Export ${format}`);
      await page.keyboard.press("Escape");
    }
    // Title and author are asked once, in New book, and show up filled everywhere else.
    expect(values["Book details"]).toEqual(
      expect.arrayContaining(["Title=E2E Book", "Author=Tester"]),
    );
    for (const [where, fields] of Object.entries(values))
      for (const f of fields.filter((x) => /^(Title|Author|Language|Folder)=/.test(x)))
        expect(f, where).not.toMatch(/=$/);
  });

  // Every screen in one test ran past its 300 s ceiling on a loaded CI runner, so the walk is cut into runs of screens. Each
  // run checks its own screens the same way; the runs share no state, so Playwright spreads them over the workers.
  const RUNS = screenRuns(screens, 8);
  for (const [i, run] of RUNS.entries()) {
    test(`no form asks the person to type the same thing twice (screens ${i + 1} of ${RUNS.length})`, async ({
      browser,
      baseURL,
    }) => {
      // A run is an eighth of the walk that outlasted 300 s; this leaves room for a slow runner and still ends.
      test.setTimeout(180_000);
      for (const s of run) {
        const page = await fresh(browser, baseURL);
        await s.open(page);
        const labels = await page.evaluate(() =>
          [
            ...document.querySelectorAll<HTMLInputElement>(
              "input:not([type=hidden]):not([type=checkbox]):not([type=radio])",
            ),
          ].map((el) =>
            (el.getAttribute("aria-label") ?? el.labels?.[0]?.textContent ?? "")
              .trim()
              .toLowerCase(),
          ),
        );
        expect(
          labels.filter((l) => /confirm|repeat|retype|re-enter|again/.test(l)),
          s.name,
        ).toEqual([]);
        expect(
          labels.length - new Set(labels.filter(Boolean)).size,
          `${s.name}: ${labels.join(", ")}`,
        ).toBe(0);
        await page.context().close();
      }
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------------------
// 2.5.2 Pointer Cancellation

test.describe("2.5.2 pointer cancellation", () => {
  test("the only handlers on pointer-down start a reorder drag (the drop happens on release)", async () => {
    const found = sources()
      .flatMap(({ file, text }) =>
        [...text.matchAll(/on(?:Mouse|Pointer|Touch)Down=\{([^}\n]*)\}?/g)].map(
          (m) => `${file}: ${m[0]}`,
        ),
      )
      .filter((l) => !/preventDefault\(\)/.test(l));
    // Reorder grips (TocRow, ReferenceRow, ImportChapterList, EntryList, SceneCard) only pick the row up: the move is committed on release, with Escape to cancel.
    expect(found.map((l) => l.split(":")[0]).sort()).toEqual([
      "src/app/board/SceneCard.tsx",
      "src/app/dialogs/import/ImportChapterList.tsx",
      "src/app/references/ReferenceRow.tsx",
      "src/app/shell/entries/EntryRow.tsx",
      "src/app/shell/sidebar/SidebarResizeHandle.tsx",
      "src/app/toc/TocRow.tsx",
    ]);
  });

  test("pressing a button and releasing off it does not run it", async ({ page }) => {
    await page.goto("/");
    const button = page.getByRole("button", { name: "New project" });
    const box = (await button.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height + 120, { steps: 4 });
    await page.mouse.up();
    await expect(page.getByRole("dialog", { name: "New book" })).toHaveCount(0);
    // And a press-and-release on it does run it.
    await button.click();
    await expect(page.getByRole("dialog", { name: "New book" })).toBeVisible();
  });

  test("a menu or toolbar button run on release, and moving off before release cancels", async ({
    page,
  }) => {
    await newProject(page);
    const bold = page
      .getByRole("toolbar", { name: "Formatting" })
      .getByRole("button", { name: "Bold", exact: true });
    const box = (await bold.boundingBox())!;
    await page.locator(".ProseMirror p").last().click();
    await page.mouse.move(box.x + 4, box.y + 4);
    await page.mouse.down();
    await expect(bold).toHaveAttribute("aria-pressed", "false");
    await page.mouse.move(box.x + 4, box.y + box.height + 200, { steps: 4 });
    await page.mouse.up();
    await expect(bold).toHaveAttribute("aria-pressed", "false");

    const menu = page.getByRole("button", { name: "Actions for Chapter One" });
    const m = (await menu.boundingBox())!;
    await page.mouse.move(m.x + m.width / 2, m.y + m.height / 2);
    await page.mouse.down();
    // A menu is opened by the press (Radix), is not a destructive action and closes with Escape or a click away; the items inside run on release.
    await page.mouse.move(m.x - 300, m.y + 300, { steps: 4 });
    await page.mouse.up();
    const items = page.getByRole("menuitem");
    if ((await items.count()) > 0) {
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.keyboard.press("Escape");
    }
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
