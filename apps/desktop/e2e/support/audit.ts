import type { Page } from "@playwright/test";

// Shared by the phone layout specs: what is wrong with the screen as it is now.
export interface Issue {
  kind: string;
  what: string;
}

/** What is wrong with the screen as it is now: overflow, clipped controls, small targets, dialogs outside the viewport. */
export async function audit(page: Page): Promise<Issue[]> {
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
