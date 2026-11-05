import { expect, test } from "../support/coverage";
import { fakeTauri } from "../support/fakeTauri";
import { screens } from "../support/a11yScreens";
import { applyE2eLocale, clippedText, inLocaleRun } from "../support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

/** WCAG 1.4.12 text spacing: the overrides a reader may apply, !important like a user style sheet. */
const TEXT_SPACING = `* {
  line-height: 1.5 !important;
  letter-spacing: 0.12em !important;
  word-spacing: 0.16em !important;
}
p { margin-bottom: 2em !important; }`;

for (const { name, open } of screens) {
  test(`text spacing (1.4.12): nothing is cut off on ${name}`, async ({ page }) => {
    await open(page);
    await applyE2eLocale(page);
    const before = await clippedText(page);
    await page.addStyleTag({ content: TEXT_SPACING });
    const after = (await clippedText(page)).filter((c) => !before.includes(c));
    expect(after).toEqual([]);
  });

  test(`reflow (1.4.10): ${name} fits 320 CSS px without horizontal scrolling`, async ({
    page,
  }) => {
    await open(page);
    await applyE2eLocale(page);
    await page.setViewportSize({ width: 320, height: 640 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test(`target size (2.5.8): controls on ${name} are at least 24 by 24 CSS px`, async ({
    page,
  }) => {
    await open(page);
    await applyE2eLocale(page);
    const small = await page.evaluate(() => {
      const out: string[] = [];
      const sel =
        "button, [role=button], [role=menuitem], input:not([type=hidden]), select, summary";
      for (const el of document.querySelectorAll<HTMLElement>(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        // Behind a modal dialog the page is hidden from the user (aria-hidden or inert), so it is not a target.
        if (el.closest("[aria-hidden=true], [inert]")) continue;
        if (r.width >= 24 && r.height >= 24) continue;
        // The press area counts, not the drawn box: a pseudo-element or the control's label can extend it.
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const labels = "labels" in el ? [...((el as HTMLInputElement).labels ?? [])] : [];
        const hit = (x: number, y: number) => {
          const at = document.elementFromPoint(x, y);
          return !!at && (el.contains(at) || labels.some((l) => l.contains(at)));
        };
        if (
          [
            [cx - 11, cy],
            [cx + 11, cy],
            [cx, cy - 11],
            [cx, cy + 11],
          ].every(([x, y]) => hit(x!, y!))
        )
          continue;
        // Spacing exception: a 24 px circle centred on the target touches no other target.
        const targets = document.querySelectorAll<HTMLElement>(`${sel}, a[href], label`);
        const crowded = [...targets].some((o) => {
          if (o === el || labels.includes(o as HTMLLabelElement)) return false;
          const b = o.getBoundingClientRect();
          if (b.width === 0 || b.height === 0) return false;
          const dx = Math.max(b.left - cx, 0, cx - b.right);
          const dy = Math.max(b.top - cy, 0, cy - b.bottom);
          return Math.hypot(dx, dy) < 12;
        });
        if (!crowded) continue;
        out.push(
          `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`,
        );
      }
      return out;
    });
    expect(small).toEqual([]);
  });
}

// Only in the locale runs (`pnpm test:a11y:locales`): longer text (pseudo) or mirrored text (he, ar) must not
// push the page sideways or cut text off at the normal window size.
if (inLocaleRun) {
  for (const { name, open } of screens) {
    test(`locale overflow: ${name} has no horizontal overflow and no clipped text`, async ({
      page,
    }) => {
      await open(page);
      const before = await clippedText(page);
      await applyE2eLocale(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      expect((await clippedText(page)).filter((c) => !before.includes(c))).toEqual([]);
    });
  }
}
