import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { chapterAction, frenchWithOneChapter, newProject, seedSnapshot } from "./support/helpers";

// Phone layouts: no horizontal scroll, controls reachable and at least 44px on touch, dialogs that scroll inside the
// viewport, and the editor with the soft keyboard open (emulated by shrinking the viewport height).
const SIZES = [
  { name: "390x844", width: 390, height: 844 },
  { name: "360x740", width: 360, height: 740 },
  { name: "844x390", width: 844, height: 390 },
] as const;

interface Issue {
  kind: string;
  what: string;
}

/** What is wrong with the screen as it is now: overflow, clipped controls, small targets, dialogs outside the viewport. */
async function audit(page: Page): Promise<Issue[]> {
  // Dialogs scale in; measure them at rest.
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))),
  );
  return page.evaluate(() => {
    const issues: { kind: string; what: string }[] = [];
    const vw = window.innerWidth;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const name = (el: Element) =>
      `${el.tagName.toLowerCase()}[${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)}]`;
    if (document.documentElement.scrollWidth > vw)
      issues.push({ kind: "scroll-x", what: `${document.documentElement.scrollWidth} > ${vw}` });
    const scrollsX = (start: Element | null) => {
      for (let el = start; el; el = el.parentElement) {
        const o = getComputedStyle(el).overflowX;
        if ((o === "auto" || o === "scroll") && el.scrollWidth > el.clientWidth) return true;
      }
      return false;
    };
    const sel =
      "button, a[href], input:not([type=hidden]), select, textarea, [role=menuitem], [role=radio], [role=tab], [role=switch], summary";
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === "hidden") continue;
      if (el.closest(".sr-only, [inert], [aria-hidden=true]")) continue;
      if (!scrollsX(el) && (r.right > vw + 0.5 || r.left < -0.5))
        issues.push({
          kind: "clipped",
          what: `${name(el)} ${Math.round(r.left)}..${Math.round(r.right)}`,
        });
      const type = (el as HTMLInputElement).type;
      if (el.tagName === "A" && el.closest("p, li, span")) continue;
      if ((type === "checkbox" || type === "radio") && el.closest("label")) continue;
      // The target is the label for a checkbox that has one, and a pseudo-element that extends the box (the switch).
      const labels = Array.from((el as HTMLInputElement).labels ?? []);
      if (labels.some((l) => l.getBoundingClientRect().height >= 43.5)) continue;
      const reach = parseFloat(getComputedStyle(el, "::after").height) || 0;
      if (cs.position !== "static" && reach >= 43.5 && r.width >= 43.5 - 8) continue;
      if (r.height < 43.5 || (r.width < 43.5 && el.tagName === "BUTTON"))
        issues.push({
          kind: "small",
          what: `${name(el)} ${Math.round(r.width)}x${Math.round(r.height)}`,
        });
    }
    for (const d of document.querySelectorAll("[role=dialog]")) {
      const r = d.getBoundingClientRect();
      if (r.height === 0) continue;
      if (r.bottom > vh + 0.5 || r.top < -0.5)
        issues.push({
          kind: "dialog-clipped",
          what: `${name(d)} ${Math.round(r.top)}..${Math.round(r.bottom)} of ${vh}`,
        });
    }
    for (const el of document.querySelectorAll("h1, h2, h3, .truncate")) {
      const e = el as HTMLElement;
      if (e.closest("[inert], [aria-hidden=true]")) continue;
      if (e.scrollWidth > e.clientWidth + 1 && !e.title && !e.getAttribute("aria-label"))
        issues.push({ kind: "truncated", what: name(el) });
    }
    return issues;
  });
}

const shots = process.env.SHOTS;

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

type Open = (page: Page) => Promise<void>;
const more = (page: Page) => page.getByRole("button", { name: "More actions" });
// Wider than a phone (landscape), the header shows these as buttons instead of the More menu.
const moreItem = async (page: Page, name: string) => {
  if (await more(page).isVisible()) {
    await more(page).click();
    await page.getByRole("menuitem", { name }).click();
  } else await page.getByRole("button", { name, exact: true }).first().click();
};
const editorOpen = async (page: Page) => {
  await newProject(page);
};
const exportFormat =
  (format: string): Open =>
  async (page) => {
    await newProject(page);
    await moreItem(page, "Export");
    await page
      .getByRole("dialog", { name: "Export book" })
      .getByRole("radio", { name: format })
      .click();
  };

const SCREENS: Record<string, Open> = {
  "home without books": async (page) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "New project" })).toBeVisible();
  },
  "home with books": async (page) => {
    await newProject(page);
    await page.reload();
    await expect(page.getByRole("region", { name: "Recent projects" })).toBeVisible();
  },
  "new book dialog": async (page) => {
    await page.goto("/");
    await page.getByRole("button", { name: "New project" }).click();
    await expect(page.getByRole("dialog", { name: "New book" })).toBeVisible();
  },
  "import wizard": async (page) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Import…" }).click();
    await expect(page.getByRole("dialog", { name: "Import a manuscript" })).toBeVisible();
  },
  editor: editorOpen,
  "header menu": async (page) => {
    await newProject(page);
    test.skip(!(await more(page).isVisible()), "the More menu only exists below the md breakpoint");
    await more(page).click();
    await expect(page.getByRole("menuitem", { name: "Focus mode" })).toBeVisible();
  },
  "book details with publishing details": async (page) => {
    await newProject(page);
    await moreItem(page, "Book details");
    const dialog = page.getByRole("dialog", { name: "Book details" });
    await dialog.getByText("Publishing details").click();
    await expect(dialog.getByText("Publishing details")).toBeVisible();
  },
  "export EPUB": exportFormat("EPUB 3"),
  "export PDF": exportFormat("Print PDF"),
  "export audiobook": exportFormat("Audiobook"),
  "export audiobook, two editions": async (page) => {
    await frenchWithOneChapter(page);
    await moreItem(page, "Export");
    const dialog = page.getByRole("dialog", { name: "Export book" });
    await dialog.getByRole("radio", { name: "Audiobook" }).click();
    await expect(dialog.getByLabel("Edition")).toBeVisible();
    await expect(dialog.getByText(/Not translated yet in Français/)).toBeVisible();
    await expect(dialog.getByText(/No voice on this computer reads Français yet/)).toBeVisible();
  },
  "export audiobook, French voice": async (page) => {
    await page.addInitScript(() => {
      window.__audioVoices = [
        { id: "piper-amy", engine: "piper", installed: true, languages: ["en"] },
        { id: "piper-fr", engine: "piper", installed: true, languages: ["fr"] },
      ];
    });
    await frenchWithOneChapter(page);
    await moreItem(page, "Export");
    const dialog = page.getByRole("dialog", { name: "Export book" });
    await dialog.getByRole("radio", { name: "Audiobook" }).click();
    await dialog.getByLabel("Skip untranslated chapters").check();
    await expect(dialog.getByRole("button", { name: "Export audiobook" })).toBeEnabled();
  },
  "export Markdown": exportFormat("Markdown"),
  "export Word": exportFormat("Word"),
  settings: async (page) => {
    await newProject(page);
    await moreItem(page, "Settings");
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  },
  "history dialog": async (page) => {
    await newProject(page);
    await page.locator(".ProseMirror").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type("Marta walked home");
    await page.getByRole("button", { name: "Save" }).or(more(page)).first().click();
    await seedSnapshot(page, "Ilse walked home");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Show chapters" }).click();
    await chapterAction(page, "Chapter One", "History");
    await expect(page.getByRole("dialog", { name: "History · Chapter One" })).toBeVisible();
  },
  "find bar": async (page) => {
    await newProject(page);
    await page.locator(".ProseMirror").click();
    await page.keyboard.press("ControlOrMeta+f");
    await page.keyboard.type("chapter");
    await expect(page.getByRole("search")).toBeVisible();
  },
  "recovery dialog": async (page) => {
    await newProject(page);
    const { file, path } = await seedSnapshot(page, "the newer text");
    await page.evaluate((x) => sessionStorage.setItem("stale", JSON.stringify([x])), {
      path: file,
      snapshot: path,
    });
    await page.reload();
    await page.getByRole("button", { name: "Open folder" }).click();
    await expect(page.getByRole("dialog", { name: /Recover newer text/ })).toBeVisible();
  },
  "sponsor dialog": async (page) => {
    await page.addInitScript(() => {
      if (sessionStorage.getItem("sponsorTest")) return;
      sessionStorage.setItem("sponsorTest", "1");
      localStorage.removeItem("cadabracraft.sponsor");
    });
    await newProject(page);
    await moreItem(page, "Export");
    await page
      .getByRole("dialog", { name: "Export book" })
      .getByRole("button", { name: "Export", exact: true })
      .click();
    await expect(page.getByRole("dialog", { name: "Enjoying CadabraCraft?" })).toBeVisible();
  },
  "project error": async (page) => {
    await page.goto("/");
    await page.evaluate(() =>
      localStorage.setItem(
        "cadabracraft.recents",
        JSON.stringify([{ root: "/gone", title: "Moved Book", openedAt: 1 }]),
      ),
    );
    await page.reload();
    await page
      .getByRole("button", { name: /Moved Book/ })
      .first()
      .click();
    await expect(page.getByText("Folder not found.")).toBeVisible();
  },
};

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height }, hasTouch: true });

    for (const [name, open] of Object.entries(SCREENS)) {
      test(`${name}: no horizontal scroll, nothing clipped, touch targets and dialogs fit`, async ({
        page,
      }) => {
        await open(page);
        if (shots)
          await page.screenshot({ path: `${shots}/${size.name}-${name.replaceAll(" ", "-")}.png` });
        const phone = size.width < 768;
        const issues = (await audit(page)).filter(
          // Landscape phones are wider than the md breakpoint, where the desktop 36px buttons apply.
          (i) => phone || (i.kind !== "small" && i.kind !== "truncated"),
        );
        expect(issues).toEqual([]);
      });
    }
  });
}
