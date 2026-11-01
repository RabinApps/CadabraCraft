import { expect, type Page } from "@playwright/test";
import { chapterDoc, focusEnd, newProject, seedChapters } from "../../e2e/support/helpers";
import { bareRole, type Area } from "../support";

/**
 * The writing and reading surfaces: the Find and replace bar, the header's save state and notices, the Write/Read switch,
 * Read mode, and the error alerts. Live regions (role=status, role=alert) are not reliably observable through VoiceOver,
 * so their text and roles are asserted in the DOM and VoiceOver only confirms the controls around them are reachable by name.
 * Find has no button: it opens with Cmd/Ctrl+F, pressed through Playwright BEFORE `enter`, because VoiceOver's cursor does
 * not follow shortcuts sent after it is in the page.
 */
const pm = (page: Page) => page.locator(".ProseMirror");
const bar = (page: Page) => page.getByRole("search", { name: "Find and replace" });
const status = (page: Page) => page.getByRole("banner").getByRole("status");
const modeRadio = (page: Page, name: "Write" | "Read") =>
  page.getByRole("radiogroup", { name: "Write or read" }).getByRole("radio", { name, exact: true });

const findBar: Area = {
  name: "find and replace bar: fields, buttons, chips and count",
  run: async ({ page, enter, find, walk, cap, vo }) => {
    await newProject(page);
    await focusEnd(page);
    await page.keyboard.type(" The cat sat. The cat ran. A cat slept.");
    await page.keyboard.press("ControlOrMeta+f");
    await expect(bar(page).getByLabel("Find", { exact: true })).toBeFocused();
    await page.keyboard.type("cat");
    // Match case is on before VoiceOver arrives, so its pressed state is spoken.
    await bar(page).getByRole("button", { name: "Match case" }).click();
    await expect(bar(page).getByRole("button", { name: "Match case" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(bar(page).getByText("1 of 3")).toBeVisible();
    // The count line is a polite live region.
    await expect(bar(page).locator("[aria-live=polite]")).toHaveText("1 of 3");
    await enter();

    const toField = await find(/Find\b/, 45);
    expect(toField.at(-1)).toMatch(/edit|text|search|Find/i);
    const rest = await walk("next", 16, /Match case/);
    const heard = rest.join("\n");
    expect(heard).toMatch(/1 of 3/);
    for (const name of [
      /Previous match/,
      /Next match/,
      /Close/,
      /Replace with/,
      /Replace all/,
      /Match case/,
    ])
      expect(heard, `VoiceOver never said ${name}`).toMatch(name);
    expect(heard).toMatch(/button/i);
    // The chip is a toggle that is on.
    expect(rest.at(-1) ?? "").toMatch(/pressed|\bon\b|selected|checked|1/i);
    expect(bareRole([...toField, ...rest])).toEqual([]);
    const more = await walk("next", 3);
    expect(more.join("\n")).toMatch(/Whole word|All chapters|Regex/);

    // Stepping the match with a click updates the live count in the DOM.
    await bar(page).getByRole("button", { name: "Next match" }).click();
    await expect(bar(page).locator("[aria-live=polite]")).toHaveText("2 of 3");

    // Close with VoiceOver itself: focus returns to the text.
    await walk("previous", 12, /^Close/);
    await cap("act", vo.act());
    await expect(bar(page)).toHaveCount(0);
    await expect(pm(page)).toBeFocused();
  },
};

const headerNotices: Area = {
  name: "header: Saved badge, status notice and Dismiss message",
  run: async ({ page, enter, find, cap, vo }) => {
    await newProject(page);
    await pm(page).click();
    await page.keyboard.type(" more");
    // Autosave ends in a polite status "Saved" and the badge says Saved.
    await expect(status(page)).toHaveText("Saved", { timeout: 6000 });
    await expect(
      page.getByRole("banner").getByText("Saved", { exact: true }).first(),
    ).toBeVisible();
    await expect(status(page)).toHaveAttribute("role", "status");
    // A notice that stays until it is dismissed: undoing a new chapter.
    await page.getByRole("button", { name: "Add chapter" }).click();
    await page
      .getByRole("navigation", { name: "Chapters" })
      .getByRole("button", { name: /^Undo/ })
      .click();
    await expect(status(page)).toContainText("Undid:");
    await enter();

    // The badge comes first, then the (live) notice, then its Dismiss button, which has a name.
    const said = await find(/Dismiss message/, 45);
    const heard = said.join("\n");
    expect(heard).toMatch(/Saved|Unsaved/);
    expect(heard).toMatch(/button/i);
    expect(bareRole(said)).toEqual([]);

    await cap("act", vo.act());
    await expect(status(page)).toHaveText("");
    await expect(page.getByRole("button", { name: "Dismiss message" })).toHaveCount(0);
  },
};

const writeReadToggle: Area = {
  name: "Write or read switch: selected state and the move to Read",
  run: async ({ page, enter, find, walk, cap, vo }) => {
    await newProject(page);
    await expect(modeRadio(page, "Write")).toHaveAttribute("aria-checked", "true");
    await enter();

    const toWrite = await find(/Write/, 45);
    const write = toWrite.at(-1) ?? "";
    expect(write).toMatch(/radio/i);
    expect(write).toMatch(/selected|checked|\bon\b|1 of 2/i);
    const [read] = await walk("next", 1);
    expect(read).toMatch(/Read/);
    expect(read).toMatch(/radio/i);
    expect(read, "the state of the two radios is spoken differently").not.toEqual(
      write.replace("Write", "Read"),
    );

    await cap("act", vo.act());
    await expect(modeRadio(page, "Read")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("reading-scroll")).toBeVisible();
    // The switch lives on in the header, so the context is still there: focus is not dropped on the page body.
    await expect(modeRadio(page, "Read")).toBeFocused();
    await page.waitForTimeout(1500);
    const after = await walk("previous", 1);
    expect(after.join("\n")).toMatch(/Read|Write/);
    expect(bareRole(after)).toEqual([]);
  },
};

const readMode: Area = {
  name: "Read mode: headings, text, chapter buttons, progress and Reading settings",
  run: async ({ page, enter, find, walk }) => {
    await newProject(page);
    await seedChapters(page, [
      chapterDoc("Chapter One", 2, 12, 0),
      chapterDoc("Chapter Two", 2, 12, 3),
      chapterDoc("Chapter Three", 2, 12, 5),
    ]);
    await modeRadio(page, "Read").click();
    await expect(page.getByTestId("reading-scroll")).toBeVisible();
    await expect(page.getByRole("progressbar", { name: "Book progress" })).toHaveAttribute(
      "aria-valuenow",
      /\d+/,
    );
    await enter();

    // The read-only text is plain web content: the chapter heading, then its paragraphs, in order.
    const toHeading = await find(/heading.*Chapter One|Chapter One.*heading/i, 45);
    expect(toHeading.at(-1)).toMatch(/heading/i);
    const body = await walk("next", 2);
    expect(body.join("\n")).toMatch(/quiet|garden|river|stone|letter|morning|lantern|orchard/);

    // The footer: the chapter turn button names its target, then the book progress bar.
    const toFooter = await find(/Next chapter|Next page/, 45);
    expect(toFooter.at(-1)).toMatch(/Chapter Two/);
    expect(toFooter.at(-1)).toMatch(/button/i);
    const footerText = (await walk("previous", 4, /Book progress/)).join("\n");
    expect(footerText).toMatch(/Book progress/);
    expect(footerText).toMatch(/progress|%|indicator/i);
    expect(bareRole([...toHeading, ...body, ...toFooter])).toEqual([]);

    // Reading settings is a button that opens a menu; step back to its first label, then through its items.
    await page.getByRole("button", { name: "Reading settings" }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.waitForTimeout(3000);
    const before = await walk("previous", 8, /Text size/);
    expect(before.join("\n")).toMatch(/Text size/);
    const items = await walk("next", 12);
    const heard = items.join("\n");
    for (const name of [/Smaller text/, /Larger text/, /Narrow page|Wide page/])
      expect(heard, `VoiceOver never said ${name}`).toMatch(name);
    expect(bareRole(items)).toEqual([]);
    await page.keyboard.press("Escape");
  },
};

const linkError: Area = {
  name: "Link dialog: invalid address shows an alert and keeps the controls named",
  run: async ({ page, enter, walk }) => {
    await newProject(page);
    await pm(page).locator("p").last().click();
    await page.keyboard.type("click me");
    await pm(page).locator("p").last().click({ clickCount: 3 });
    await enter();

    await page
      .getByRole("toolbar", { name: "Formatting" })
      .getByRole("button", { name: "Link", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Add link" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Address").fill("javascript:alert(1)");
    await dialog.getByRole("button", { name: "Apply" }).click();
    // The error is a role=alert; VoiceOver's reading of it is not observable, so the DOM is checked.
    const alert = dialog.getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("can't be used as a link");
    await expect(dialog).toBeVisible();

    // The dialog stays usable: heading, field and both buttons are reachable by name.
    await page.waitForTimeout(3000);
    const before = await walk("previous", 8, /Add link/);
    expect(before.join("\n")).toMatch(/Add link/);
    const said = await walk("next", 8, /Apply/);
    const heard = said.join("\n");
    expect(heard).toMatch(/Address/);
    expect(heard).toMatch(/Cancel/);
    expect(heard).toMatch(/Apply/);
    expect(bareRole(said)).toEqual([]);

    // Editing the address clears the alert.
    await dialog.getByLabel("Address").fill("https://example.com");
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await page.keyboard.press("Escape");
  },
};

export const writing: Area[] = [findBar, headerNotices, writeReadToggle, readMode, linkError];
