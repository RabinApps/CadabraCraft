import type { Page } from "@playwright/test";
import { expect, test } from "../support/coverage";
import { fakeTauri } from "../support/fakeTauri";
import { screens } from "../support/a11yScreens";
import { SHIFT_TAB, TAB } from "../support/helpers";

// Shell key audit: on every screen, Tab, Shift+Tab, the arrow keys and Escape must reach the browser's default action
// (focus movement, scrolling, caret) unless the focused element sits inside a widget that owns that key. A global
// shortcut, menu accelerator or page-level handler that calls preventDefault on one of these keys would break keyboard
// and screen reader navigation everywhere, so this spec records `defaultPrevented` after the event has been fully
// dispatched and fails on any key that is prevented outside the allowlist below.

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

type Key = "Tab" | "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Escape";
const ARROWS: Key[] = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];

/**
 * Widgets that own a key: if the focused element is inside one of these selectors, preventDefault on that key is the widget's job.
 * Anything not listed here must leave the key alone.
 */
const OWNERS: Record<"Tab" | "Arrow" | "Escape", { selector: string; why: string }[]> = {
  Tab: [
    {
      selector: ".ProseMirror",
      why: "the editor types a tab, indents lists and moves between table cells (Escape first lets the next Tab leave)",
    },
    {
      selector: "[role=dialog]",
      why: "a modal dialog traps focus: Tab at its first or last control wraps instead of leaving",
    },
    {
      selector: "[role=menu]",
      why: "an open menu keeps focus inside until it closes",
    },
  ],
  Arrow: [
    { selector: ".ProseMirror", why: "the editor moves the caret and selects across blocks" },
    {
      selector: "input:not([type=checkbox]):not([type=radio]), textarea, [contenteditable=true]",
      why: "text fields move the caret",
    },
    { selector: "select, [role=combobox], [role=listbox], [role=option]", why: "pickers" },
    { selector: "[role=menu], [role=menuitem]", why: "menus move between items" },
    {
      selector: "[aria-haspopup=menu]",
      why: "ArrowDown on a menu button opens its menu (Radix, per the APG menu button pattern)",
    },
    {
      selector: "[role=menuitemradio], [role=menuitemcheckbox]",
      why: "menu items move like other menu items",
    },
    { selector: "[role=radiogroup], [role=radio]", why: "radio groups move the selection" },
    { selector: "[role=tablist], [role=tab]", why: "tabs use a roving tabindex" },
    { selector: "[role=toolbar]", why: "the formatting toolbar uses a roving tabindex" },
    { selector: "[role=slider], [role=spinbutton], input[type=range]", why: "value widgets" },
    {
      selector: "[role=listitem] [aria-roledescription], [data-drag-handle], [aria-grabbed]",
      why: "drag handles reorder with the arrow keys",
    },
    {
      selector: "[data-grip]",
      why: "a reorder grip moves its page one place with the arrow keys, the keyboard alternative to dragging (2.5.7)",
    },
    {
      selector: "[data-testid=toc-preview-page], [role=region][aria-label=Preview]",
      why: "the spread preview pages with the arrow keys",
    },
  ],
  Escape: [
    { selector: "[role=dialog]", why: "closes the dialog" },
    {
      selector: "body:has([role=dialog])",
      why: "an open dialog closes on Escape wherever focus is (in Safari, Option+Tab can move focus out of a dialog)",
    },
    { selector: "[role=menu]", why: "closes the menu" },
    {
      selector: "body:has([role=tooltip])",
      why: "an open tooltip closes on Escape before anything else does (1.4.13 dismissible)",
    },
    {
      selector: "input, textarea, [role=combobox], [role=search], .ProseMirror",
      why: "cancels an inline edit, closes a suggestion list or the find bar, or clears a field",
    },
  ],
};

type Press = { key: string; shift: boolean; prevented: boolean; owner: string; focus: string };

/** Records every keydown (capture phase, before any handler) and reads defaultPrevented once the dispatch is over. */
async function record(page: Page) {
  await page.evaluate((owners) => {
    const w = window as unknown as { __presses: Press[] };
    w.__presses = [];
    const ownerOf = (key: string, el: Element | null): string => {
      const list = owners[key === "Tab" ? "Tab" : key === "Escape" ? "Escape" : "Arrow"];
      const hit = list.find((o) => el?.closest(o.selector));
      return hit?.selector ?? "";
    };
    const describe = (el: Element | null) =>
      el
        ? `${el.tagName.toLowerCase()}${el.getAttribute("role") ? `[role=${el.getAttribute("role")}]` : ""}${
            el.getAttribute("aria-label") ? ` "${el.getAttribute("aria-label")}"` : ""
          }`
        : "none";
    window.addEventListener(
      "keydown",
      (e) => {
        // The element that has focus when the key is pressed, before any handler moves it.
        const from = document.activeElement;
        const entry: Press = {
          key: e.key,
          shift: e.shiftKey,
          prevented: false,
          owner: ownerOf(e.key, from),
          focus: describe(from),
        };
        w.__presses.push(entry);
        // A task runs after the whole dispatch (all listeners, React's included) has finished.
        setTimeout(() => {
          entry.prevented = e.defaultPrevented;
        }, 0);
      },
      true,
    );
  }, OWNERS);
}

for (const screen of screens) {
  test(`${screen.name}: Tab, arrows and Escape are not swallowed by the shell`, async ({
    page,
  }) => {
    await screen.open(page);
    await record(page);
    // Tab twice first so the focus is on a control and not on the page, then the keys under test. Escape goes last
    // because it can close the screen.
    const keys: string[] = [TAB, TAB, SHIFT_TAB, ...ARROWS, "Escape"];
    for (const key of keys) {
      await page.keyboard.press(key);
      await page.waitForTimeout(20);
    }
    const presses = await page.evaluate(
      () => (window as unknown as { __presses: Press[] }).__presses,
    );
    expect(presses.filter((p) => p.key === "Tab").length).toBeGreaterThanOrEqual(3);
    const offenders = presses
      .filter((p) => p.prevented && !p.owner)
      .map((p) => `${p.shift ? "Shift+" : ""}${p.key} prevented while focus was on ${p.focus}`);
    expect(offenders, "keys swallowed outside a widget that owns them").toEqual([]);
  });
}

test("the allowlist names a reason for every owner", () => {
  for (const list of Object.values(OWNERS))
    for (const o of list) expect(o.why.length).toBeGreaterThan(5);
});
