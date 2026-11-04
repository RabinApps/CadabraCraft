import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { addPage, newProject, sidebar } from "./support/helpers";

// The writing surface is always the formatted book: pages at md+ width, the reflowed page look on a phone. There is no toggle or
// menu command (the dev build exposes what each native menu item runs); this covers the zoom select and the surface by width.

type MenuRun = { run: (id: string) => boolean };
const menu = async (page: Page, id: string) => {
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __cadabraMenu?: MenuRun }).__cadabraMenu),
  );
  return page.evaluate(
    (i) => (window as unknown as { __cadabraMenu: MenuRun }).__cadabraMenu.run(i),
    id,
  );
};
const zoom = (page: Page) => page.getByLabel("Page zoom");

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

test("a new book opens on pages, with no Page view button or menu command", async ({ page }) => {
  await newProject(page);
  await expect(page.locator(".page").first()).toBeVisible();
  await expect(zoom(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Page view", exact: true })).toHaveCount(0);
  expect(await menu(page, "view.pageView")).toBe(false); // no such command any more
});

test("the zoom select offers Fit width, 75%, 100% and 125% and is remembered", async ({ page }) => {
  await newProject(page);
  await expect(zoom(page)).toHaveValue("fit");
  await expect(zoom(page).locator("option")).toHaveText(["Fit width", "75%", "100%", "125%"]);
  await zoom(page).selectOption({ label: "125%" });
  await page.reload();
  await page.getByRole("button", { name: "Open folder" }).click();
  await expect(zoom(page)).toHaveValue("1.25");
  await zoom(page).selectOption({ label: "Fit width" });
  await expect(zoom(page)).toHaveValue("fit");
});

test("Read mode draws its own pages, and Write mode comes back to the page surface", async ({
  page,
}) => {
  await newProject(page);
  await page.getByRole("radio", { name: "Read" }).click();
  await expect(page.locator(".ProseMirror")).toHaveAttribute("contenteditable", "false");
  await expect(zoom(page)).toBeVisible(); // the reading footer has the same zoom select
  await expect(page.locator(".page").first()).toBeVisible();
  await expect(page.locator(".prose-reading")).toHaveCount(0);
  await page.getByRole("radio", { name: "Write" }).click();
  await expect(zoom(page)).toBeVisible();
  await expect(page.locator(".page").first()).toBeVisible();
});

test("a phone gets the reflowed page look: no page cards or zoom, the template's type", async ({
  page,
}) => {
  await newProject(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("reflow-scroll")).toBeVisible();
  await expect(page.locator(".prose-reflow")).toBeVisible();
  await expect(page.locator(".page")).toHaveCount(0);
  await expect(page.locator(".page-chip")).toHaveCount(0);
  await expect(zoom(page)).toBeHidden();
  // The book's own type: the novel template's serif, justified, with no extra width cap.
  const look = await page.evaluate(() => {
    const el = document.querySelector(".prose-reflow .ProseMirror")!;
    const cs = getComputedStyle(el);
    return { align: cs.textAlign, width: el.getBoundingClientRect().width, font: cs.fontFamily };
  });
  expect(look.align).toBe("justify");
  expect(look.width).toBeGreaterThan(330);
  expect(look.width).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator(".page").first()).toBeVisible();
  await expect(page.locator(".prose-reflow")).toHaveCount(0);
});

// The copyright page is the PDF's `copyright-page`: its printer's imprint at the foot of the text box, in 0.85 em with 0.7 em between
// paragraphs, flush. Page view draws the page the print book will have, not the text at the top in the body's size.
test("the copyright page sets its imprint at the foot, small and flush, as the print page does", async ({
  page,
}) => {
  await newProject(page);
  await addPage(page, "Copyright page");
  await expect(page.locator(".ProseMirror p").first()).toContainText("©");
  await zoom(page).selectOption({ label: "100%" });
  await expect(page.locator(".page-copyright")).toBeVisible();
  const imprint = await page.evaluate(() => {
    const stack = document.querySelector("body .page-stack") as HTMLElement;
    const pm = stack.querySelector(".ProseMirror") as HTMLElement;
    const cs = getComputedStyle(stack);
    const n = (name: string) => parseFloat(cs.getPropertyValue(name));
    const zoom = Number(stack.getAttribute("data-zoom"));
    const r = stack.getBoundingClientRect();
    const card = stack.querySelector(".page-card")!.getBoundingClientRect();
    const pageTop = (card.top - r.top) / zoom;
    const ps = [...pm.querySelectorAll("p")];
    const first = ps[0]!;
    const last = ps[ps.length - 1]!;
    const pcs = getComputedStyle(first);
    return {
      size: parseFloat(getComputedStyle(pm).fontSize),
      body: n("--page-font-size"),
      indent: pcs.textIndent,
      align: pcs.textAlign,
      space: parseFloat(getComputedStyle(ps[1] ?? first).marginBottom),
      textSize: parseFloat(pcs.fontSize),
      firstTop: (first.getBoundingClientRect().top - r.top) / zoom,
      lastBottom: (last.getBoundingClientRect().bottom - r.top) / zoom,
      boxTop: pageTop + n("--page-mt"),
      boxBottom: pageTop + card.height / zoom - n("--page-mb"),
    };
  });
  expect(imprint.size).toBeCloseTo(imprint.body * 0.85, 1); // 0.85 em, not the body's 10.5 pt
  expect(imprint.indent).toBe("0px");
  expect(imprint.align).toBe("start");
  // 0.7 em at that size, net of the leading a line box already holds (novel: 1.28 em pitch − 0.66 em cap = 0.62 em leading).
  expect(imprint.space).toBeCloseTo(imprint.textSize * (0.7 - 0.62), 1);
  // The imprint's last line sits on the bottom margin, and the first line is nowhere near the top one.
  expect(Math.abs(imprint.lastBottom - imprint.boxBottom)).toBeLessThan(2);
  expect(imprint.firstTop).toBeGreaterThan(imprint.boxTop + 100);
});

// Chapter opening (novel: ornament above the title, drop cap on the first paragraph). The pseudo-elements fill the space
// `--page-chapter-extra` reserves, so the title keeps its place and the first paragraph keeps at least three lines of height.
test("a novel chapter draws its ornament and a drop cap on the page, and keeps them when it reflows", async ({
  page,
}) => {
  await newProject(page);
  await page.evaluate(() => {
    window.__disk["manuscript/001-chapter-one.json"] = JSON.stringify({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Chapter One" }] },
        { type: "paragraph", content: [{ type: "text", text: "Short opening." }] },
      ],
    });
    sessionStorage.setItem("disk", JSON.stringify(window.__disk));
  });
  await page.reload();
  await page.getByRole("button", { name: "Open folder" }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter One");
  const style = () =>
    page.evaluate(() => {
      const h1 = document.querySelector(".ProseMirror h1")!;
      const p = h1.nextElementSibling!;
      const orn = getComputedStyle(h1, "::before");
      return {
        ornament: orn.content,
        ornamentPos: orn.position,
        ornamentTop: parseFloat(orn.top),
        label: getComputedStyle(h1, "::after").content,
        capFloat: getComputedStyle(p, "::first-letter").float,
        paraH: p.getBoundingClientRect().height,
        linePitch: parseFloat(getComputedStyle(p).lineHeight),
        extra: parseFloat(
          getComputedStyle(h1.closest(".page-stack") ?? document.body).getPropertyValue(
            "--page-chapter-extra",
          ),
        ),
      };
    });
  await zoom(page).selectOption({ label: "100%" });
  await expect(page.locator(".page").first()).toBeVisible();
  const on = await style();
  expect(on.ornament).toContain("⁂");
  expect(on.ornamentPos).toBe("absolute");
  expect(on.label).toBe("none"); // the novel has no chapter label
  expect(on.capFloat).toBe("left");
  expect(on.paraH).toBeGreaterThanOrEqual(3 * on.linePitch - 1); // a one-line paragraph still holds the cap
  expect(-on.ornamentTop).toBeCloseTo(on.extra, 0); // drawn inside the reserved space
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".prose-reflow")).toBeVisible();
  const reflowed = await style();
  expect(reflowed.ornament).toContain("⁂");
  expect(reflowed.capFloat).toBe("left");
});

/** The first content block of the open page (a blank verso before the page is a page-break spacer, not content). */
const firstBlock = (page: Page) =>
  page.evaluate(() => {
    const pm = document.querySelector("body .ProseMirror")!;
    const block = [...pm.children].find((el) => !el.classList.contains("pv-gap"))!;
    const stack = block.closest(".page-stack") as HTMLElement;
    const cs = getComputedStyle(stack);
    return {
      ornament: getComputedStyle(block, "::before").content,
      position: getComputedStyle(block).position,
      marginTop: parseFloat(getComputedStyle(block).marginTop),
      centreTop: parseFloat(
        getComputedStyle(block.closest(".prose-page")!).getPropertyValue("--page-centre-top"),
      ),
      sink:
        parseFloat(cs.getPropertyValue("--page-chapter-sink")) +
        parseFloat(cs.getPropertyValue("--page-chapter-extra")),
      classes: block.closest(".prose-page")!.className,
      cards: [...document.querySelectorAll('[data-testid="page-scroll"] .page')].map((c) => ({
        blank: (c as HTMLElement).dataset.blank === "true",
      })),
    };
  });

// The blank verso the book puts before a page is the editor's first child, so the "first block" rules have to look past it: the
// chapter opening keeps its sink, ornament and drop cap, and a page laid out without one still has none.
test("a chapter that opens after a blank verso keeps its sink, ornament and drop cap", async ({
  page,
}) => {
  await newProject(page);
  await page.getByRole("button", { name: "Add chapter" }).click();
  // Chapter One is one page, so Chapter 2 is pushed to a right-hand page: a blank left-hand page comes first.
  await sidebar(page).getByRole("button", { name: "Chapter 2", exact: true }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter 2");
  await expect.poll(async () => (await firstBlock(page)).cards.length).toBe(2);
  const opening = await firstBlock(page);
  expect(opening.cards[0]?.blank).toBe(true);
  expect(opening.ornament).toContain("⁂");
  expect(opening.position).toBe("relative");
  expect(opening.marginTop).toBeCloseTo(opening.sink, 0);
  const capFloat = await page.evaluate(
    () => getComputedStyle(document.querySelector(".ProseMirror h1 + p")!, "::first-letter").float,
  );
  expect(capFloat).toBe("left");
});

test("a centred matter page that opens on a heading after a blank verso shows no chapter opening", async ({
  page,
}) => {
  await newProject(page);
  await addPage(page, "Title page");
  await addPage(page, "Dedication");
  // The author's dedication, written with a heading first.
  await page.evaluate(() => {
    const m = JSON.parse(window.__disk["cadabra.json"] as string);
    const entry = m.frontMatter.find((e: { kind: string }) => e.kind === "dedication");
    const file = entry.files[Object.keys(entry.files)[0]!] as string;
    window.__disk[file] = JSON.stringify({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "In memory" }] },
        { type: "paragraph", content: [{ type: "text", text: "Of …" }] },
      ],
    });
    sessionStorage.setItem("disk", JSON.stringify(window.__disk));
  });
  await page.reload();
  await page.getByRole("button", { name: "Open folder" }).click();
  // The row keeps the page's title from the manifest; the page itself is the document written above.
  await sidebar(page).getByRole("button", { name: "Dedication", exact: true }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("In memory");
  await expect.poll(async () => (await firstBlock(page)).cards.length).toBe(2);
  const page1 = await firstBlock(page);
  // A dedication opens on a right-hand page, after the title page: the blank left-hand page comes first.
  expect(page1.cards[0]?.blank).toBe(true);
  expect(page1.classes).toContain("page-bare");
  expect(page1.ornament).toBe("none");
  // No chapter sink above it either: the space above the heading is the centring offset, not the opening's drop.
  expect(page1.marginTop).toBeCloseTo(page1.centreTop, 0);
  expect(page1.marginTop).not.toBeCloseTo(page1.sink, 0);
});
