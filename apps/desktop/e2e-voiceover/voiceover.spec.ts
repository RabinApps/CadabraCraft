import { voiceOverTest as test } from "@guidepup/playwright";
import { fakeTauri } from "../e2e/support/fakeTauri";
import { home } from "./areas/home";
import { makeCtx, type Area } from "./support";

/**
 * The VoiceOver suite: every area is a module in `areas/` that sets up its own screen, enters the page with VoiceOver and
 * checks what VoiceOver says. One test runs all areas in turn, because a second test in the same run stalls
 * `navigateToWebContent`. A failing area does not stop the others: the failures are collected and reported together.
 * Set VO_AREA=<part of a name> to run only the matching areas.
 */
const areas: Area[] = [home];

test.setTimeout(20 * 60_000);

test("VoiceOver reads every screen with names and roles", async ({ page, voiceOver }) => {
  await fakeTauri(page);
  const ctx = makeCtx(page, voiceOver);
  const only = process.env.VO_AREA?.toLowerCase();
  const failures: string[] = [];
  for (const area of areas) {
    if (only && !area.name.toLowerCase().includes(only)) continue;
    await test.step(area.name, async () => {
      try {
        await area.run(ctx);
      } catch (e) {
        failures.push(`${area.name}: ${e instanceof Error ? e.message : String(e)}`);
        // Leave no dialog or menu open for the next area.
        await page.keyboard.press("Escape").catch(() => {});
      }
    });
  }
  if (failures.length)
    throw new Error(`${failures.length} area(s) failed:\n\n${failures.join("\n\n")}`);
});
