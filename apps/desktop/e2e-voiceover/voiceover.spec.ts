import { voiceOverTest as test } from "@guidepup/playwright";
import { expect } from "@playwright/test";
import { fakeTauri } from "../e2e/support/fakeTauri";

/**
 * What VoiceOver says, word for word, on the screens that matter most. The phrases are VoiceOver's own wording (macOS
 * version dependent), so the assertions match on the parts that carry the meaning: the name and the role.
 */
async function walk(
  voiceOver: { next: () => Promise<void>; lastSpokenPhrase: () => Promise<string> },
  steps: number,
) {
  const said: string[] = [];
  for (let i = 0; i < steps; i++) {
    await voiceOver.next();
    said.push(await voiceOver.lastSpokenPhrase());
  }
  return said;
}

test("the home screen is announced with a heading and named buttons", async ({
  page,
  voiceOver,
}) => {
  await fakeTauri(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "New project" })).toBeVisible();
  await voiceOver.navigateToWebContent();
  const said = (await walk(voiceOver, 25)).join("\n");
  expect(said).toMatch(/heading/i);
  expect(said).toMatch(/New project/);
  // Every button is announced with a name: "button" alone would show up as a line with nothing before it.
  expect(
    said.split("\n").filter((l) => /^\s*(button|pop up button|check box|switch)\s*$/i.test(l)),
  ).toEqual([]);
});

test("the New book dialog is announced as a dialog and keeps VoiceOver inside it", async ({
  page,
  voiceOver,
}) => {
  await fakeTauri(page);
  await page.goto("/");
  await page.getByRole("button", { name: "New project" }).click();
  await expect(page.getByRole("dialog", { name: "New book" })).toBeVisible();
  await voiceOver.navigateToWebContent();
  // VoiceOver starts on the focused field, which is below the title, so look backwards as well as forwards.
  const after = await walk(voiceOver, 20);
  for (let i = 0; i < 20; i++) await voiceOver.previous();
  const before: string[] = [];
  for (let i = 0; i < 12; i++) {
    await voiceOver.previous();
    before.push(await voiceOver.lastSpokenPhrase());
  }
  const said = [...before, ...after].join("\n");
  expect(said, "the dialog's name is read").toMatch(/New book/);
  expect(said, "VoiceOver says it is a dialog").toMatch(/dialog/i);
  // Nothing from the page behind the dialog is read.
  expect(said).not.toMatch(/Settings/);
});
