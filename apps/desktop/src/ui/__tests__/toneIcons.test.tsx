import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@lingui/react";
import { i18n } from "@lingui/core";
import { Badge, badgeIcons, type BadgeTone } from "../Badge";
import { Notice, noticeIcons, type NoticeTone } from "../Notice";
import { checkIcons } from "../../app/export/CheckList";

// WCAG 1.4.1: the tone of a badge, notice or check is shown by a shape of its own, not by colour alone.

const distinct = (icons: Record<string, unknown>) =>
  expect(new Set(Object.values(icons)).size).toBe(Object.keys(icons).length);

describe("tone icons", () => {
  it("gives every Badge tone its own icon", () => distinct(badgeIcons));
  it("gives every Notice tone its own icon", () => distinct(noticeIcons));
  it("gives every check tone its own icon, so a warning differs from an error", () =>
    distinct(checkIcons));

  it("renders a different icon per Badge tone", () => {
    const tones: BadgeTone[] = ["success", "warn", "danger"];
    const html = tones.map((tone) => renderToStaticMarkup(<Badge tone={tone}>Label</Badge>));
    expect(new Set(html.map((h) => h.replace(/<span class="[^"]*">/, ""))).size).toBe(3);
  });

  it("renders a different icon and a tone word per Notice tone", () => {
    i18n.load("en", {});
    i18n.activate("en");
    const tones: NoticeTone[] = ["danger", "warn", "success", "accent"];
    const html = tones.map((tone) =>
      renderToStaticMarkup(
        <I18nProvider i18n={i18n}>
          <Notice tone={tone}>Message</Notice>
        </I18nProvider>,
      ),
    );
    expect(new Set(html.map((h) => /<svg[^>]*>.*?<\/svg>/.exec(h)?.[0])).size).toBe(4);
    for (const h of html) expect(h).toMatch(/class="sr-only"/);
  });
});
