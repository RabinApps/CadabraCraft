import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";

// Settings page controls and the audio section's voice list, including the failures the fake backend can inject.

/** Test hooks on top of the shared fake backend (registered after it, so `orig` is the fake). */
interface Hooks {
  __deleteError?: boolean;
  __voicesError?: boolean;
  __voicesGate?: Promise<void>;
  __openGate?: () => void;
}
type W = Window & Hooks;

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
  await page.addInitScript(() => {
    const w = window as unknown as W;
    const orig = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = async (cmd, a, opts) => {
      if (cmd === "audio_delete_pack") {
        if (w.__deleteError) throw { kind: "io", message: "Could not delete" };
        const packs = (await orig("audio_packs", a, opts)) as NonNullable<typeof w.__audioPacks>;
        w.__audioPacks = packs.map((p) => (p.id === a.pack ? { ...p, installed: false } : p));
        return null;
      }
      if (cmd === "audio_voices") {
        await w.__voicesGate;
        if (w.__voicesError) throw { kind: "io", message: "Voices unavailable" };
      }
      return orig(cmd, a, opts);
    };
  });
});

const openSettings = async (page: Page) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
};

test("every preference control saves and the section buttons scroll", async ({ page }) => {
  await openSettings(page);
  const sections = page.getByRole("navigation", { name: "Settings sections" });
  for (const name of ["Appearance", "General", "Editor", "Audio", "Backups", "Shortcuts"])
    await sections.getByRole("button", { name }).click();

  await page.getByRole("switch", { name: "Typewriter scrolling" }).click();
  await page.getByLabel("Session word goal").fill("500");
  await page.getByLabel("When pasting HTML").selectOption("convert");
  await page.getByRole("switch", { name: "Check for updates on launch" }).click();
  await expect(page.getByRole("switch", { name: "Check for updates on launch" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await expect(page.getByLabel("When pasting HTML")).toHaveValue("convert");
  await expect(page.getByLabel("Session word goal")).toHaveValue("500");
});

test("snapshots to keep is applied on blur and clamped", async ({ page }) => {
  await openSettings(page);
  const keep = page.getByLabel("Snapshots to keep per chapter");
  await keep.fill("2");
  await keep.blur();
  await expect(keep).not.toHaveValue("2"); // clamped to the minimum
  await keep.fill("40");
  await keep.blur();
  await expect(keep).toHaveValue("40");
});

test("audio defaults: voice and formats, and the last format cannot be unticked", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__audioVoices = [
      { id: "kokoro-heart", engine: "kokoro", installed: true, languages: ["en"] },
      { id: "piper-amy", engine: "piper", installed: true, languages: ["en"] },
      { id: "piper-libritts-0", engine: "piper", installed: true, languages: ["en"] },
      { id: "other-voice", engine: "piper", installed: true, languages: ["en"] },
      { id: "kokoro-uninstalled", engine: "kokoro", installed: false, languages: ["en"] },
    ];
  });
  await openSettings(page);
  const voice = page.getByLabel("Default voice");
  await expect(voice.locator("option")).toHaveText([
    "Best installed voice",
    "Kokoro · Heart (best quality)",
    "Piper · Amy (fast)",
    "Piper · LibriTTS (fast)",
    "other-voice",
  ]);
  await voice.selectOption("piper-amy");
  await expect(voice).toHaveValue("piper-amy");

  const formats = page.getByRole("group", { name: "Default formats" });
  const opus = formats.getByRole("checkbox", { name: "Opus" });
  await expect(opus).toBeChecked();
  await opus.uncheck({ force: true }).catch(() => {}); // refused: it is the only format ticked
  await expect(opus).toBeChecked();
  await formats.getByRole("checkbox", { name: "FLAC" }).check();
  await opus.uncheck();
  await expect(opus).not.toBeChecked();
  await expect(formats.getByRole("checkbox", { checked: true })).toHaveCount(1);
});

test("a voice pack can be deleted after confirming, or kept", async ({ page }) => {
  await openSettings(page);
  const kokoro = page.getByText("Kokoro: Heart", { exact: true }).locator("xpath=../..");
  await kokoro.getByRole("button", { name: "Delete", exact: true }).click();
  await kokoro.getByRole("button", { name: "Keep" }).click();
  await expect(kokoro.getByRole("button", { name: "Delete", exact: true })).toBeVisible();
  await kokoro.getByRole("button", { name: "Delete", exact: true }).click();
  await kokoro.getByRole("button", { name: "Delete voices" }).click();
  await expect(kokoro).toContainText("Not installed. Download it from the Audiobook export.");
  await expect(kokoro.getByRole("button")).toHaveCount(0);
});

test("a failed pack deletion is shown", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as W).__deleteError = true;
  });
  await openSettings(page);
  const piper = page.getByText("Piper voices: Amy and LibriTTS").locator("xpath=../..");
  await piper.getByRole("button", { name: "Delete", exact: true }).click();
  await piper.getByRole("button", { name: "Delete voices" }).click();
  await expect(page.getByRole("alert")).toHaveText(/Could not delete/);
});

test("a voice list that cannot be read is reported", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as W).__voicesError = true;
  });
  await openSettings(page);
  await expect(page.getByRole("alert")).toHaveText(/Voices unavailable/);
});

test("leaving Settings before the voice list arrives drops the answer", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as W;
    w.__voicesGate = new Promise<void>((r) => {
      w.__openGate = r;
    });
  });
  await openSettings(page);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
  await page.evaluate(() => (window as unknown as W).__openGate?.());
  // Same again with a failing list: the late error is dropped too.
  await page.evaluate(() => {
    const w = window as unknown as W;
    w.__voicesError = true;
    w.__voicesGate = new Promise<void>((r) => {
      w.__openGate = r;
    });
  });
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.evaluate(() => (window as unknown as W).__openGate?.());
  await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("the nav scrolls only the content, reaches the last section and follows hand scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openSettings(page);
  const nav = page.getByRole("navigation", { name: "Settings sections" });
  const state = () =>
    page.evaluate(() => {
      const main = document.querySelector("main")!;
      const top = (id: string) =>
        document.getElementById(id)!.getBoundingClientRect().top - main.getBoundingClientRect().top;
      return {
        pageScroll: document.scrollingElement!.scrollTop,
        pageHeight: document.scrollingElement!.scrollHeight,
        backups: top("backups"),
        active: document.querySelector('nav[aria-label="Settings sections"] [aria-current]')
          ?.textContent,
      };
    });
  // Jumping scrolls the content, not the page behind it (that would push the header away).
  await nav.getByRole("button", { name: "Editor", exact: true }).click();
  await expect.poll(async () => (await state()).active).toBe("Editor");
  await page.waitForTimeout(1000);
  expect(await state()).toMatchObject({ pageScroll: 0, pageHeight: 800 });
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeInViewport();
  // The last section can be brought to the top like the others.
  await nav.getByRole("button", { name: "Backups", exact: true }).click();
  await expect.poll(async () => Math.round((await state()).backups)).toBe(16);
  expect((await state()).active).toBe("Backups");
  // Scrolling by hand moves the highlight.
  await page.locator("main").evaluate((m) => (m.scrollTop = 0));
  await expect.poll(async () => (await state()).active).toBe("Appearance");
  await page.locator("main").evaluate((m) => (m.scrollTop = 560));
  await expect.poll(async () => (await state()).active).toBe("Editor");
});
