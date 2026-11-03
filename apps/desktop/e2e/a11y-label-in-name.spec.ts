import type { Page } from "@playwright/test";
import { expect, test } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { screens } from "./support/a11yScreens";

// WCAG 2.5.3 Label in Name: a control with visible text has an accessible name that contains that text, so a
// Voice Control or Dragon user can say what they see. The name is computed in the page (aria-labelledby, aria-label,
// native labels, content, title), which is the part of accname the app's controls use.

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

type Mismatch = { control: string; visible: string; name: string };

/** Controls with visible text (`checked`) and those whose visible text is not in their accessible name. */
async function audit(page: Page): Promise<{ checked: number; bad: Mismatch[] }> {
  return page.evaluate(() => {
    const SELECTOR = [
      "button",
      "a[href]",
      "input:not([type=hidden])",
      "select",
      "textarea",
      "[role=button]",
      "[role=link]",
      "[role=menuitem]",
      "[role=menuitemradio]",
      "[role=menuitemcheckbox]",
      "[role=tab]",
      "[role=radio]",
      "[role=checkbox]",
      "[role=switch]",
      "[role=combobox]",
      "[role=option]",
    ].join(",");
    const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
    const shown = (el: Element) => {
      const s = getComputedStyle(el);
      return s.display !== "none" && s.visibility !== "hidden";
    };
    /** Text a sighted user reads: no aria-hidden, no sr-only, no hidden parts. */
    const visibleText = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
      if (!(node instanceof Element)) return "";
      if (node.getAttribute("aria-hidden") === "true" || node.matches(".sr-only") || !shown(node))
        return "";
      // Form controls inside a label do not add their own value to the label.
      if (node.matches("input, select, textarea, svg")) return "";
      return [...node.childNodes]
        .map(visibleText)
        .join(node.matches("div, p, li") || getComputedStyle(node).display === "block" ? " " : "");
    };
    /** Text of a node for the name: like visibleText but sr-only text counts. */
    const nameText = (node: Node, viaLabelledby = false): string => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
      if (!(node instanceof Element)) return "";
      if (!viaLabelledby && (!shown(node) || node.getAttribute("aria-hidden") === "true"))
        return "";
      if (node.matches("input, select, textarea")) return "";
      const label = node.getAttribute("aria-label");
      if (label && viaLabelledby) return label;
      return [...node.childNodes]
        .map((c) => nameText(c))
        .join(node.matches("div, p, li") ? " " : "");
    };
    const accessibleName = (el: HTMLElement): string => {
      const by = el.getAttribute("aria-labelledby");
      if (by) {
        return by
          .split(/\s+/)
          .map((id) => document.getElementById(id))
          .filter((n): n is HTMLElement => !!n)
          .map((n) => nameText(n, true))
          .join(" ");
      }
      const label = el.getAttribute("aria-label");
      if (label?.trim()) return label;
      const labels = "labels" in el ? [...((el as HTMLInputElement).labels ?? [])] : [];
      if (labels.length) return labels.map((l) => nameText(l)).join(" ");
      const own = el.matches("button, a, [role]") ? nameText(el) : "";
      if (own.trim()) return own;
      return el.getAttribute("title") ?? el.getAttribute("placeholder") ?? "";
    };
    /** What is printed on or next to the control. */
    const visibleLabel = (el: HTMLElement): string => {
      if (el.matches("input, select, textarea")) {
        const labels = [...((el as HTMLInputElement).labels ?? [])];
        return labels.map((l) => visibleText(l)).join(" ");
      }
      return visibleText(el);
    };
    const out: { control: string; visible: string; name: string }[] = [];
    let checked = 0;
    for (const el of document.querySelectorAll<HTMLElement>(SELECTOR)) {
      if (!shown(el) || el.closest("[aria-hidden=true], [inert]") || el.hidden) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const visible = norm(visibleLabel(el));
      // Text with no letter or digit (icons drawn as glyphs such as "×", "…", arrows) is a symbol, not a word
      // anyone says: Voice Control uses the name given by the author for those, and there is nothing to match.
      if (!/[\p{L}]/u.test(visible)) continue;
      checked++;
      const name = norm(accessibleName(el));
      if (name.includes(visible)) continue;
      out.push({
        control: `${el.tagName.toLowerCase()}${el.getAttribute("role") ? `[role=${el.getAttribute("role")}]` : ""}`,
        visible,
        name,
      });
    }
    return { checked, bad: out };
  });
}

for (const { name, open, noText } of screens) {
  test(`label in name (2.5.3): visible text is in the accessible name on ${name}`, async ({
    page,
  }) => {
    await open(page);
    const { checked, bad } = await audit(page);
    if (!noText) expect(checked, "the audit found no controls with text").toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });
}
