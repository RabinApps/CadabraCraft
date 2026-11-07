import { expect } from "@playwright/test";
import { bareRole, type Area } from "../support";

export const home: Area = {
  name: "home screen and New book dialog",
  run: async ({ page, enter, walk }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "New project" })).toBeVisible();
    await enter();

    // The home screen has a heading and named buttons.
    const said = await walk("next", 15);
    expect(said.join("\n")).toMatch(/heading/i);
    expect(said.join("\n")).toMatch(/New project/);
    expect(bareRole(said)).toEqual([]);

    // The New book dialog is named and keeps VoiceOver inside it.
    await page.getByRole("button", { name: "New project" }).click();
    await expect(page.getByRole("dialog", { name: "New book" })).toBeVisible();
    await page.waitForTimeout(4000);
    const before = await walk("previous", 6, /New book/);
    expect(before.join("\n")).toMatch(/New book/);
    // Whether VoiceOver says "dialog" as focus enters cannot be heard this way (docs/accessibility.md).
    const walked = await walk("next", 12);
    expect(walked.join("\n")).not.toMatch(/Settings/);
    expect(bareRole(walked)).toEqual([]);
  },
};
