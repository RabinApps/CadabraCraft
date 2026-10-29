import { expect, test } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { frenchWithOneChapter, newProject, noVoices } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

test("Export audiobook renders the chapters with the chosen voice and formats and says when it is ready", async ({
  page,
}) => {
  await newProject(page);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByRole("radio", { name: "Audiobook" }).click();
  await expect(dialog.getByLabel("Voice")).toHaveValue("kokoro-heart");
  await dialog.getByLabel("Voice").selectOption("piper-amy");
  await dialog.getByRole("radio", { name: "1.1×" }).click();
  await dialog.getByLabel("FLAC").check();
  await dialog.getByRole("button", { name: "Export audiobook" }).click();
  await expect(dialog.getByText("Your audiobook is ready")).toBeVisible();
  const call = await page.evaluate(() => window.__audioCalls[0]!);
  expect(call).toMatchObject({
    voice: "piper-amy",
    speed: 1.1,
    formats: ["opus", "flac"],
    root: "/proj",
  });
  expect(call.base).toMatch(/^exports\/en\/audio\/01-/);
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toHaveCount(0);
});

test("M4B packs the whole book into one file with chapters, after the chapters are rendered", async ({
  page,
}) => {
  await newProject(page);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByRole("radio", { name: "Audiobook" }).click();
  await dialog.getByLabel("Voice").selectOption("piper-amy");
  await dialog.getByLabel("M4B audiobook").check();
  await dialog.getByRole("button", { name: "Export audiobook" }).click();
  await expect(dialog.getByText("Your audiobook is ready")).toBeVisible();
  const chapter = await page.evaluate(() => window.__audioCalls[0]!);
  expect(chapter.formats).toEqual(["opus"]);
  expect(chapter.part).toMatch(/^\.cadabra\/audio\/parts\/.+\.flac$/);
  const m4b = await page.evaluate(() => window.__m4bCalls);
  expect(m4b).toHaveLength(1);
  expect(m4b[0]!.base).toMatch(/^exports\/en\/audio\/[a-z0-9-]+$/);
  expect(m4b[0]!.chapters.map((c) => c.part)).toEqual([chapter.part]);
  await expect(dialog.getByText(/2 files/)).toBeVisible();
});

test("Hear a sample renders a few sentences with the chosen voice, writes nothing and shows failures", async ({
  page,
}) => {
  await newProject(page);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByRole("radio", { name: "Audiobook" }).click();
  await dialog.getByLabel("Voice").selectOption("piper-amy");
  await dialog.getByRole("button", { name: "Hear a sample" }).click();
  await expect.poll(() => page.evaluate(() => window.__sampleCalls?.length ?? 0)).toBe(1);
  const call = await page.evaluate(() => window.__sampleCalls[0]!);
  expect(call).toMatchObject({ voice: "piper-amy", speed: 1 });
  expect(call.chunks.length).toBeGreaterThan(0);
  await expect(dialog.getByRole("button", { name: "Hear a sample" })).toBeVisible();
  expect(
    await page.evaluate(() => Object.keys(window.__disk).filter((k) => k.startsWith("exports/"))),
  ).toEqual([]);
  await page.evaluate(() => {
    window.__sampleError = { kind: "synth", message: "engine broke" };
  });
  await dialog.getByRole("button", { name: "Hear a sample" }).click();
  await expect(dialog.getByRole("alert")).toContainText("engine broke");
});

test("Audiobook can be closed while it runs, shows a header chip, and Cancel stops it", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__audioHold = true;
  });
  await newProject(page);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByRole("radio", { name: "Audiobook" }).click();
  await dialog.getByRole("button", { name: "Export audiobook" }).click();
  await expect(dialog.getByRole("progressbar")).toBeVisible();
  await dialog.getByRole("button", { name: "Keep working" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: /^Audiobook \d+%$/ }).click();
  await page
    .getByRole("dialog", { name: "Export book" })
    .getByRole("button", { name: "Cancel export" })
    .click();
  await expect(page.getByText("The audiobook was cancelled")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Audiobook \d+%$/ })).toHaveCount(0);
});

test("Audiobook offers to download the voices when none are installed, then shows the options", async ({
  page,
}) => {
  await page.addInitScript(noVoices);
  await newProject(page);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByRole("radio", { name: "Audiobook" }).click();
  await expect(dialog.getByText("Voices are not installed")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Export audiobook" })).toHaveCount(0);
  await expect(dialog.getByLabel(/Piper voices/)).toBeChecked();
  await expect(dialog.getByLabel(/Kokoro/)).not.toBeChecked();
  await dialog.getByRole("button", { name: "Download selected (148 MB)" }).click();
  await expect(dialog.getByLabel("Voice")).toBeVisible();
  expect(await page.evaluate(() => window.__downloads)).toEqual(["piper"]);
  await expect(dialog.getByRole("button", { name: "Export audiobook" })).toBeEnabled();
});

test("A voice download shows progress and can be cancelled, then tried again", async ({ page }) => {
  await page.addInitScript(() => {
    noVoicesInit();
    window.__downloadHold = true;
    function noVoicesInit() {
      window.__audioVoices = [
        { id: "piper-amy", engine: "piper", installed: false, languages: ["en"] },
      ];
      window.__audioPacks = [
        { id: "piper", voices: ["piper-amy"], bytes: 147993194, installed: false },
      ];
    }
  });
  await newProject(page);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByRole("radio", { name: "Audiobook" }).click();
  await dialog.getByRole("button", { name: /Download selected/ }).click();
  await expect(dialog.getByRole("progressbar", { name: "Download progress" })).toHaveAttribute(
    "aria-valuenow",
    "50",
  );
  await expect(dialog.getByText("74 of 148 MB")).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel download" }).click();
  await expect(dialog.getByText(/Stopped\./)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("Audiobook reads one edition: pick it, skip what is untranslated, files go to that language's folder", async ({
  page,
}) => {
  // The shipped voices read English only; a French voice stands in for one that will exist.
  await page.addInitScript(() => {
    window.__audioVoices = [
      { id: "piper-amy", engine: "piper", installed: true, languages: ["en"] },
      { id: "piper-fr", engine: "piper", installed: true, languages: ["fr"] },
    ];
  });
  await frenchWithOneChapter(page);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByRole("radio", { name: "Audiobook" }).click();
  // The open edition is preselected; the other one is listed with its progress.
  const edition = dialog.getByLabel("Edition");
  await expect(edition).toHaveValue("fr");
  await expect(edition.locator("option")).toHaveText([
    "English: 2 of 2 chapters",
    "Français: 1 of 2 chapters",
  ]);
  const submit = dialog.getByRole("button", { name: "Export audiobook" });
  await expect(dialog.getByText(/Not translated yet in Français: /)).toBeVisible();
  await expect(submit).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Hear a sample" })).toBeDisabled();
  await dialog.getByLabel("Skip untranslated chapters").check();
  await expect(dialog.getByText("Reads 1 chapter, as one audio file.")).toBeVisible();
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(dialog.getByText("Your audiobook is ready")).toBeVisible();
  await expect(dialog.getByText(/Saved in exports\/fr\/audio/)).toBeVisible();
  const calls = await page.evaluate(() => window.__audioCalls);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.base).toMatch(/^exports\/fr\/audio\/01-/);
  expect(calls[0]!.voice).toBe("piper-fr");
  expect(calls[0]!.chunks.map((c) => c.text).join(" ")).toContain("Bonjour");
  await dialog.getByRole("button", { name: "Done" }).click();

  // The English edition is complete: no warning, its files go to exports/en/audio.
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await dialog.getByRole("radio", { name: "Audiobook" }).click();
  await dialog.getByLabel("Edition").selectOption("en");
  await expect(dialog.getByText(/Not translated yet/)).toHaveCount(0);
  await expect(dialog.getByText("Reads 2 chapters, one audio file each.")).toBeVisible();
  await dialog.getByRole("button", { name: "Export audiobook" }).click();
  await expect(dialog.getByText("Your audiobook is ready")).toBeVisible();
  const all = await page.evaluate(() => window.__audioCalls);
  expect(all.slice(1).map((c) => c.base.split("/").slice(0, 3).join("/"))).toEqual([
    "exports/en/audio",
    "exports/en/audio",
  ]);
});

test("Audiobook offers an edition only the voices that read its language, and says so when there are none", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__audioVoices = [
      { id: "kokoro-heart", engine: "kokoro", installed: true, languages: ["en"] },
      { id: "piper-amy", engine: "piper", installed: true, languages: ["en"] },
      { id: "piper-fr", engine: "piper", installed: true, languages: ["fr"] },
    ];
  });
  await frenchWithOneChapter(page);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByRole("radio", { name: "Audiobook" }).click();
  // French lists only the voice that reads French; English lists the English ones and remembers the pick.
  await expect(dialog.getByLabel("Voice").locator("option")).toHaveCount(1);
  await dialog.getByLabel("Edition").selectOption("en");
  await expect(dialog.getByLabel("Voice").locator("option")).toHaveCount(2);
  await dialog.getByLabel("Voice").selectOption("piper-amy");
  await dialog.getByLabel("Edition").selectOption("fr");
  await dialog.getByLabel("Edition").selectOption("en");
  await expect(dialog.getByLabel("Voice")).toHaveValue("piper-amy");
  // Without the French voice the dialog says so and cannot start.
  await page.evaluate(() => {
    window.__audioVoices = window.__audioVoices!.filter((v) => v.id !== "piper-fr");
  });
  await dialog.getByRole("radio", { name: "EPUB 3" }).click();
  await dialog.getByRole("radio", { name: "Audiobook" }).click();
  await dialog.getByLabel("Edition").selectOption("fr");
  await expect(dialog.getByText(/No voice on this computer reads Français yet/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Export audiobook" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Hear a sample" })).toBeDisabled();
});
