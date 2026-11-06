import { expect, type Locator, type Page } from "./coverage";

export const pm = (page: Page) => page.locator(".ProseMirror");
export const run = (page: Page, id: string) =>
  page.evaluate(async (c) => {
    (await import("/src/state/commands.ts" as string)).runCommand(c);
  }, id);

/** Types `text` in the last paragraph and selects it. */
export async function typeAndSelect(page: Page, text: string) {
  await pm(page).locator("p").last().click();
  await page.keyboard.type(text);
  await page.evaluate(() => {
    const r = document.createRange();
    r.selectNodeContents([...document.querySelectorAll(".ProseMirror p")].pop()!);
    const sel = getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
  });
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
}

/** A text or pattern matched anywhere in an accessible description (which joins the message and the hint). */
export const contains = (text: string | RegExp) =>
  typeof text === "string" ? new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) : text;

/** The message is words a person can read, announced as an alert. */
export async function expectAlert(alert: Locator, message: string | RegExp) {
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(message);
  expect((await alert.innerText()).trim().split(/\s+/).length).toBeGreaterThan(2);
}

/**
 * A refused field: the alert says what is wrong, the field is aria-invalid and described by the message (plus its hint,
 * which holds the fix when the message does not), and focus is on the field. `fix` is what the description must offer.
 */
export async function expectFieldError(
  field: Locator,
  alert: Locator,
  message: string | RegExp,
  fix: string | RegExp,
) {
  await expectAlert(alert, message);
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toHaveAccessibleDescription(contains(message));
  await expect(field).toHaveAccessibleDescription(contains(fix));
  await expect(field).toBeFocused();
}
