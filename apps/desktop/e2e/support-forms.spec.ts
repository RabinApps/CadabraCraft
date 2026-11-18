import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";

// Settings > Help: the Contact and Feedback forms from the support desk, shown in a dialog.

const FORM = (name: string) => `<!doctype html><title>${name}</title><body><h1>${name} form</h1>`;
// What the real form does on render: it tells the dialog how tall it is.
const REPORT_HEIGHT = `<script>parent.postMessage({type:"supdesk:height",height:520},"*")</script>`;

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
    return route.fulfill({ contentType: "text/html", body: FORM("Contact") + REPORT_HEIGHT });
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

test("the feedback form opens in its own dialog and the form is taller than the height it reports", async ({
  page,
}) => {
  await page.route("https://support.cadabracraft.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: FORM("Feedback") + REPORT_HEIGHT,
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

test("a form page that loads but never reports its height (blocked from framing) offers the browser", async ({
  page,
}) => {
  await page.clock.install();
  // A page that refuses to be framed still fires the frame's load event with an empty document.
  await page.route("https://support.cadabracraft.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>blocked</title>" }),
  );
  await openHelp(page);
  await page.getByRole("button", { name: "Contact", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Contact CadabraCraft" });
  await expect(dialog.getByTestId("support-form-loading")).toBeVisible();
  await page.clock.fastForward(13_000);
  await expect(dialog.getByRole("alert")).toContainText("could not load");
  await expect(dialog.getByTestId("support-form-loading")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Open in browser" })).toBeVisible();
});

test("a loading indicator shows until the form reports its height, and no privacy footnote is shown", async ({
  page,
}) => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("https://support.cadabracraft.com/**", async (route) => {
    await gate;
    await route.fulfill({ contentType: "text/html", body: FORM("Contact") + REPORT_HEIGHT });
  });
  await openHelp(page);
  await page.getByRole("button", { name: "Contact", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Contact CadabraCraft" });
  const loading = dialog.getByRole("status");
  await expect(loading).toContainText("Loading the form");
  await expect(dialog.locator("iframe")).not.toBeVisible();
  await expect(dialog).not.toContainText("Nothing is sent until you submit");
  release();
  await expect(loading).toHaveCount(0);
  await expect(dialog.locator("iframe")).toBeVisible();
  await expect(dialog.frameLocator("iframe").getByRole("heading")).toHaveText("Contact form");
  await expect(dialog).not.toContainText("Nothing is sent until you submit");
});

test("the loading indicator is not shown when the form cannot load", async ({ page }) => {
  await page.route("https://support.cadabracraft.com/**", (route) => route.abort());
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "onLine", { value: false });
  });
  await openHelp(page);
  await page.getByRole("button", { name: "Give feedback", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Feedback for CadabraCraft" });
  await expect(dialog.getByRole("alert")).toContainText("could not load");
  await expect(dialog.getByTestId("support-form-loading")).toHaveCount(0);
});
