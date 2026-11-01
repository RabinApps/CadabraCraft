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

async function capped<T>(what: string, work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const stuck = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`VoiceOver did not finish "${what}" in ${STEP_MS} ms`)),
      STEP_MS,
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

test.setTimeout(90_000);

test("the home screen is announced with a heading and named buttons", async ({
  page,
  voiceOver,
}) => {
  await fakeTauri(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "New project" })).toBeVisible();
  await capped("navigateToWebContent", voiceOver.navigateToWebContent());
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
  await page.getByRole("button", { name: "New project" }).click();
  await expect(page.getByRole("dialog", { name: "New book" })).toBeVisible();
  await capped("navigateToWebContent", voiceOver.navigateToWebContent());
  // VoiceOver starts on the focused field, below the dialog's title: go back until the name is heard.
  const before = await walk(voiceOver, "previous", 10, /New book/);
  const after = await walk(voiceOver, "next", 10);
  const said = [...before, ...after].join("\n");
  expect(said, "the dialog's name is read").toMatch(/New book/);
  expect(said, "VoiceOver says it is a dialog").toMatch(/dialog/i);
  // Nothing from the page behind the dialog is read.
  expect(said).not.toMatch(/Settings/);
  expect(bareRole([...before, ...after])).toEqual([]);
});
