import { expect, test } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { newProject } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
});

const divider = (page: import("@playwright/test").Page) =>
  page.getByRole("separator", { name: "Resize chapter list" });
const width = async (page: import("@playwright/test").Page) =>
  Number(await divider(page).getAttribute("aria-valuenow"));

test("the chapter list divider moves with the arrow keys, Home and End, and ignores other keys", async ({
  page,
}) => {
  await newProject(page);
  const start = await width(page);
  await divider(page).focus();
  await page.keyboard.press("ArrowRight");
  expect(await width(page)).toBe(start + 16);
  await page.keyboard.press("ArrowLeft");
  expect(await width(page)).toBe(start);
  await page.keyboard.press("a");
  expect(await width(page)).toBe(start);
  await page.keyboard.press("Home");
  const min = await width(page);
  await page.keyboard.press("End");
  expect(await width(page)).toBeGreaterThan(min);
});

test("the divider grows the other way in a right-to-left page", async ({ page }) => {
  await newProject(page);
  await page.evaluate(() => (document.documentElement.dir = "rtl"));
  await divider(page).focus();
  const start = await width(page);
  await page.keyboard.press("ArrowLeft");
  expect(await width(page)).toBe(start + 16);
  await page.keyboard.press("ArrowRight");
  expect(await width(page)).toBe(start);
});

test("dragging the divider resizes the list; other buttons and pointers do not", async ({
  page,
}) => {
  await newProject(page);
  const box = (await divider(page).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const start = await width(page);

  // A right click starts nothing.
  await page.mouse.move(x, y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(x + 60, y);
  await page.mouse.up({ button: "right" });
  expect(await width(page)).toBe(start);

  // A drag with the left button follows the pointer, and the body shows the resize cursor while it is held.
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 40, y, { steps: 4 });
  expect(await page.evaluate(() => document.body.style.cursor)).toBe("col-resize");
  expect(await width(page)).toBe(start + 40);
  await page.mouse.up();
  expect(await page.evaluate(() => document.body.style.cursor)).toBe("");

  // After the drop, moving the pointer changes nothing.
  await page.mouse.move(x + 200, y);
  expect(await width(page)).toBe(start + 40);

  // Events from another pointer are ignored while one drag is under way.
  await page.evaluate(() => {
    const el = document.querySelector('[role="separator"][aria-label="Resize chapter list"]')!;
    el.setPointerCapture = () => {}; // a synthetic pointer is not a real one the browser could capture
    const fire = (type: string, id: number, clientX: number, button = 0) =>
      el.dispatchEvent(
        new PointerEvent(type, { pointerId: id, clientX, button, bubbles: true, cancelable: true }),
      );
    fire("pointerdown", 7, 100);
    fire("pointermove", 8, 300);
    fire("pointerup", 8, 300);
    fire("pointerup", 7, 100);
  });
  expect(await width(page)).toBe(start + 40);
});
