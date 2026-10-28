import { expect, test } from "@playwright/test";
import { fakeTauri } from "./support/fakeTauri";
import { newProject, noVoices } from "./support/helpers";

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
  expect(call.base).toMatch(/^exports\/audio\/01-/);
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toHaveCount(0);
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
      window.__audioVoices = [{ id: "piper-amy", engine: "piper", installed: false }];
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
