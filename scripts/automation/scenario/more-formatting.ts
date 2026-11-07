import { assert, type Context } from "./context.ts";

/** The toolbar's More formatting menu (WCAG 3.1.2 discoverability): Language of selection from the menu marks the text in the real app. */
export async function moreFormattingSteps({ app, dlg, shot, step }: Context) {
  const html = () => app.js<string>(`document.querySelector('.ProseMirror').innerHTML`);
  // Radix opens a menu button on pointerdown, as chapter-icons does for the row menu.
  const openMore = () =>
    app.js(
      `(() => { const b = document.querySelector('[role=toolbar] button[aria-label="More formatting"]'); if (!b) throw new Error("no More formatting button"); b.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" })); return b.getAttribute("aria-label"); })()`,
    );
  const clickItem = (name: string) =>
    app.js(
      `(() => { const i = [...document.querySelectorAll('[role=menuitem],[role=menuitemcheckbox]')].find((i) => i.textContent.trim().startsWith(${JSON.stringify(name)})); if (!i) throw new Error("no menu item: ${name}"); i.click(); return "clicked"; })()`,
    );

  await step(
    "More formatting: the toolbar menu lists Language of selection and the rarely used marks",
    async () => {
      await app.js(
        `(() => { const ed = document.querySelector('.ProseMirror'); ed.focus(); const s = getSelection(); s.selectAllChildren(ed); s.collapseToEnd(); document.execCommand('insertText', false, ' Bonjour tout le monde.'); const text = s.anchorNode; const r = document.createRange(); r.setStart(text, text.textContent.indexOf('Bonjour')); r.setEnd(text, text.textContent.length); s.removeAllRanges(); s.addRange(r); })()`,
      );
      await app.sleep(400);
      await openMore();
      await app.sleep(500);
      const names = await app.js<string[]>(
        `[...document.querySelectorAll('[role=menu] [role^=menuitem]')].map((i) => i.textContent.trim())`,
      );
      for (const n of ["Strikethrough", "Language of selection…", "Clear language", "Task list"])
        assert(
          names.some((x) => x.startsWith(n)),
          `menu lacks ${n}: ${names.join(" | ")}`,
        );
      await shot("14-more-formatting");
      return `${names.length} items`;
    },
  );

  await step("More formatting: Language of selection marks the selection as French", async () => {
    await clickItem("Language of selection…");
    await app.sleep(600);
    await dlg(
      `const s = d.querySelector("select"); if (!s) throw new Error("no language select"); s.value = "fr"; s.dispatchEvent(new Event("change", { bubbles: true })); return "fr";`,
    );
    await app.sleep(200);
    await dlg(
      `const b = [...d.querySelectorAll("button")].find((b) => b.textContent.trim() === "Apply"); if (!b) throw new Error("no Apply"); b.click(); return "applied";`,
    );
    await app.sleep(600);
    const doc = await html();
    assert(
      /<span[^>]*lang="fr"[^>]*>Bonjour tout le monde\.<\/span>/.test(doc),
      `no fr span: ${doc}`,
    );
    return 'span lang="fr"';
  });
}
