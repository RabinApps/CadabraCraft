import type { VoiceOverPlaywright } from "@guidepup/playwright";
import type { Page } from "@playwright/test";

/**
 * Helpers for the VoiceOver suite. What the first runs taught (docs/accessibility.md, "Real VoiceOver"):
 * - A VoiceOver command takes about a second, so an area makes at most about 30 of them.
 * - Each command is capped, so a stuck one fails its area with a message instead of hanging the run.
 * - `navigateToWebContent` is slow (10 to 30 s), cannot run while a modal dialog is open (the dialog traps focus), and
 *   a second call in a run can stall: call `enter` once per area, on a page with no dialog open.
 * - `spokenPhraseLog` only records the commands the test sends; `lastSpokenPhrase` can be empty right after a page
 *   change, so wait a moment first and read it only after a command.
 * - Stepping by item reads names and roles of controls and headings, not the role of a container such as a dialog.
 */
export interface Ctx {
  page: Page;
  vo: VoiceOverPlaywright;
  /** Moves VoiceOver into the page's web content, on its first item. Call it once the area's screen is ready. */
  enter: () => Promise<void>;
  /** Moves `steps` times and returns what was said after each move; stops early at the first phrase matching `until`. */
  walk: (direction: "next" | "previous", steps: number, until?: RegExp) => Promise<string[]>;
  /** Moves forward until a phrase matches, and returns everything said on the way (the match is last). Fails after `max`. */
  find: (match: RegExp, max?: number) => Promise<string[]>;
  /** Runs a VoiceOver command with the per-command cap. */
  cap: <T>(what: string, work: Promise<T>, limit?: number) => Promise<T>;
}

export interface Area {
  name: string;
  run: (ctx: Ctx) => Promise<void>;
}

export const STEP_MS = 10_000;
export const NAVIGATE_MS = 45_000;

export async function cap<T>(what: string, work: Promise<T>, limit = STEP_MS): Promise<T> {
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

/** Phrases that are a bare role: a control VoiceOver read without a name. */
export const bareRole = (lines: string[]) =>
  lines.filter((l) =>
    /^\s*(button|pop up button|check box|switch|edit text|link|radio button|text field|slider|combo box)\s*$/i.test(
      l,
    ),
  );

export function makeCtx(page: Page, vo: VoiceOverPlaywright): Ctx {
  const walk: Ctx["walk"] = async (direction, steps, until) => {
    const said: string[] = [];
    for (let i = 0; i < steps; i++) {
      await cap(direction, vo[direction]());
      const phrase = await cap("lastSpokenPhrase", vo.lastSpokenPhrase());
      said.push(phrase);
      if (until?.test(phrase)) break;
    }
    return said;
  };
  return {
    page,
    vo,
    cap,
    walk,
    enter: async () => {
      // The item chooser stalls now and then (the status bar area did once in a full run and passed on its own): retry once.
      try {
        await cap("navigateToWebContent", vo.navigateToWebContent(), NAVIGATE_MS);
      } catch {
        await page.waitForTimeout(3000);
        await cap("navigateToWebContent", vo.navigateToWebContent(), NAVIGATE_MS);
      }
    },
    find: async (match, max = 30) => {
      const said = await walk("next", max, match);
      if (!match.test(said.at(-1) ?? "")) {
        throw new Error(
          `VoiceOver never said ${match} in ${max} steps. It said:\n${said.join("\n")}`,
        );
      }
      return said;
    },
  };
}
