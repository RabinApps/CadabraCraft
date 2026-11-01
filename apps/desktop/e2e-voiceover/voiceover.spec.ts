import { voiceOverTest as test } from "@guidepup/playwright";
import { expect } from "@playwright/test";
import { fakeTauri } from "../e2e/support/fakeTauri";

/**
 * What VoiceOver says on the screens that matter most. The phrases are VoiceOver's own wording (macOS version
 * dependent), so the assertions match the parts that carry the meaning: the name and the role. Every VoiceOver command
 * takes about a second, so each test keeps to a few dozen of them, and each one is capped so a stuck command fails the
 * test with a message instead of hanging the run.
 */
interface Reader {
  next: () => Promise<void>;
  previous: () => Promise<void>;
  lastSpokenPhrase: () => Promise<string>;
}

const STEP_MS = 10_000;
/** Moving VoiceOver into the browser's web content is slow: it takes 10 to 20 s on the first run. */
const NAVIGATE_MS = 45_000;

async function capped<T>(what: string, work: Promise<T>, limit = STEP_MS): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const stuck = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`VoiceOver did not finish "${what}" in ${limit} ms`)),
      limit,
    );
  });
  try {
    return await Promise.race([work, stuck]);
  } finally {
    clearTimeout(timer);
  }
}

/** Moves `steps` times in a direction and returns what was said after each move. */
async function walk(vo: Reader, direction: "next" | "previous", steps: number, until?: RegExp) {
  const said: string[] = [];
  for (let i = 0; i < steps; i++) {
    await capped(direction, vo[direction]());
    const phrase = await capped("lastSpokenPhrase", vo.lastSpokenPhrase());
    said.push(phrase);
    if (until?.test(phrase)) break;
  }
  return said;
}

/** Lines that are a bare role: a control VoiceOver read without a name. */
const bareRole = (lines: string[]) =>
  lines.filter((l) => /^\s*(button|pop up button|check box|switch|edit text|link)\s*$/i.test(l));

test.setTimeout(150_000);

test("the home screen is announced with a heading and named buttons", async ({
  page,
  voiceOver,
}) => {
  await fakeTauri(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "New project" })).toBeVisible();
  await capped("navigateToWebContent", voiceOver.navigateToWebContent(), NAVIGATE_MS);
  const said = await walk(voiceOver, "next", 15);
  expect(said.join("\n")).toMatch(/heading/i);
  expect(said.join("\n")).toMatch(/New project/);
  expect(bareRole(said)).toEqual([]);
});

test("the New book dialog is announced as a dialog and keeps VoiceOver inside it", async ({
  page,
  voiceOver,
}) => {
  await fakeTauri(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "New project" })).toBeVisible();
  // Move VoiceOver into the page first: with a modal open, Guidepup's helper cannot reach the web content (the dialog
  // traps focus and hides the page, so VoiceOver's item chooser never settles). Then open the dialog and listen.
  await capped("navigateToWebContent", voiceOver.navigateToWebContent(), NAVIGATE_MS);
  await page.getByRole("button", { name: "New project" }).click();
  await expect(page.getByRole("dialog", { name: "New book" })).toBeVisible();
  // VoiceOver follows the focus into the dialog. Its log only fills for commands the test sends, so read what it last
  // said, then step back from the focused field to the dialog's name and role.
  await page.waitForTimeout(4000);
  const first = await capped("lastSpokenPhrase", voiceOver.lastSpokenPhrase());
  const before = await walk(voiceOver, "previous", 6, /dialog/i);
  const opened = [first, ...before].join("\n");
  expect(opened, "VoiceOver follows focus into the dialog").toMatch(/Title|New book/);
  expect(opened, "the dialog's name is read").toMatch(/New book/);
  expect(opened, "VoiceOver says it is a dialog").toMatch(/dialog/i);
  // Walking on stays inside the dialog and every control has a name.
  const walked = await walk(voiceOver, "next", 12);
  expect(walked.join("\n")).not.toMatch(/Settings/);
  expect(bareRole(walked)).toEqual([]);
});
