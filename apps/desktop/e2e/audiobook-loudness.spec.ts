import { expect, test } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { newProject } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

/** Exports the audiobook once with the given loudness reported by the fake engine, then waits for the done step. */
async function exportWithLoudness(
  page: Parameters<typeof newProject>[0],
  loudness: {
    integratedLufs: number;
    truePeakDbtp: number;
    targetLufs: number;
    passed: boolean;
  } | null,
) {
  await newProject(page);
  await page.evaluate((l) => {
    if (l) window.__audioLoudness = l;
  }, loudness);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByRole("radio", { name: "Audiobook" }).click();
  await dialog.getByRole("button", { name: "Export audiobook" }).click();
  await expect(dialog.getByText("Your audiobook is ready")).toBeVisible();
  return dialog;
}

test("The done step shows the measured loudness, the target and a passing result in words", async ({
  page,
}) => {
  const dialog = await exportWithLoudness(page, {
    integratedLufs: -19.2,
    truePeakDbtp: -3.4,
    targetLufs: -19,
    passed: true,
  });
  const card = dialog.getByRole("region", { name: "Loudness" });
  await expect(card).toBeVisible();
  await expect(card.getByText("-19.2 LUFS")).toBeVisible();
  await expect(card.getByText("-3.4 dBTP")).toBeVisible();
  await expect(card.getByText("-19 LUFS")).toBeVisible();
  await expect(card.getByText("Within the retail target")).toBeVisible();
  await expect(
    card.getByText("The audio is not changed. Adjust the source to meet the target."),
  ).toBeVisible();
});

test("A true peak above -3 dBTP fails the result and says to lower the peak", async ({ page }) => {
  const dialog = await exportWithLoudness(page, {
    integratedLufs: -19,
    truePeakDbtp: -1.2,
    targetLufs: -19,
    passed: false,
  });
  const card = dialog.getByRole("region", { name: "Loudness" });
  await expect(card.getByText("-1.2 dBTP")).toBeVisible();
  await expect(card.getByText("Above -3 dBTP: lower the peak")).toBeVisible();
  await expect(card.getByText("Within the retail target")).toHaveCount(0);
});

test("An older render with no loudness report shows no loudness card", async ({ page }) => {
  const dialog = await exportWithLoudness(page, null);
  await expect(dialog.getByRole("region", { name: "Loudness" })).toHaveCount(0);
});
