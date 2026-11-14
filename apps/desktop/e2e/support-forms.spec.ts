import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";

// Settings > Help: the Contact and Feedback forms from the support desk, shown in a dialog.

const FORM = (name: string) => `<!doctype html><title>${name}</title><body><h1>${name} form</h1>`;

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

const openHelp = async (page: Page) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: "Help" })
    .click();
};

test("nothing is requested from the support desk until a form is opened", async ({ page }) => {
  const requests: string[] = [];
  await page.route("https://support.cadabracraft.com/**", (route) => {
    requests.push(route.request().url());
    return route.fulfill({ contentType: "text/html", body: FORM("Contact") });
  });
  await openHelp(page);
  expect(requests).toEqual([]);
  await page.getByRole("button", { name: "Contact", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Contact CadabraCraft" });
  await expect(dialog.locator("iframe")).toHaveAttribute(
    "src",
    "https://support.cadabracraft.com/embed/contact",
  );
  await expect(dialog.frameLocator("iframe").getByRole("heading")).toHaveText("Contact form");
  // Keys pressed inside the form belong to the form; Escape works from the dialog itself.
  await dialog.getByRole("button", { name: "Close" }).focus();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Contact", exact: true })).toBeFocused();
});

test("the feedback form opens in its own dialog and the form can set its height", async ({
  page,
}) => {
  await page.route("https://support.cadabracraft.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `${FORM("Feedback")}<script>parent.postMessage({type:"supdesk:height",height:700},"*")</script>`,
    }),
  );
  await openHelp(page);
  await page.getByRole("button", { name: "Give feedback", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Feedback for CadabraCraft" });
  await expect(dialog.locator("iframe")).toHaveAttribute("src", /\/embed\/feedback$/);
  await expect(dialog.locator("iframe")).toHaveCSS("height", "700px");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
});

test("a form that cannot load says so and offers the browser", async ({ page }) => {
  await page.route("https://support.cadabracraft.com/**", (route) => route.abort());
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "onLine", { value: false });
  });
  await openHelp(page);
  await page.getByRole("button", { name: "Contact", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Contact CadabraCraft" });
  await expect(dialog.getByRole("alert")).toContainText("could not load");
  await expect(dialog.locator("iframe")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Open in browser" }).click();
});
