import { assert, type Context } from "./context.ts";

const ORIGIN = "https://support.cadabracraft.com";

/** Where the dialog and its frame are, as plain numbers, so a step can check they sit in the middle. */
type Frame = {
  src: string;
  height: number;
  left: number;
  right: number;
  dialogLeft: number;
  dialogRight: number;
  vw: number;
};

/** Settings > Help: Contact and Feedback open the support forms in a dialog (the real CSP and navigation guard apply). */
export async function helpDialogsSteps({ app, runMenu, shot, step }: Context) {
  const clickText = (selector: string, text: string) =>
    app.js(
      `(() => { const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find((b) => b.textContent.trim() === ${JSON.stringify(text)}); if (!b) throw new Error(${JSON.stringify("no " + selector + ": " + text)}); b.click(); return "clicked"; })()`,
    );
  const frame = () =>
    app.js<Frame | null>(
      `(() => { const d = document.querySelector('[role="dialog"]'); const f = d?.querySelector("iframe"); if (!d || !f) return null; const r = f.getBoundingClientRect(), g = d.getBoundingClientRect(); return { src: f.src, height: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right), dialogLeft: Math.round(g.left), dialogRight: Math.round(g.right), vw: innerWidth }; })()`,
    );
  const waitFrame = async () => {
    for (let i = 0; i < 20; i++) {
      const f = await frame();
      if (f) return f;
      await app.sleep(300);
    }
    throw new Error("the dialog has no form frame");
  };

  await step("settings: the Help group opens", async () => {
    await runMenu("app.settings");
    await app.sleep(800);
    await clickText("button, a", "Help");
    await app.sleep(500);
    const page = await app.js<string>("document.body.innerText");
    assert(
      page.includes("Contact CadabraCraft") && page.includes("Give feedback"),
      "Help lacks the Contact and Feedback rows",
    );
    return "Contact CadabraCraft and Give feedback rows shown";
  });

  for (const [form, button, title, minHeight] of [
    ["contact", "Contact", "Contact CadabraCraft", 520],
    ["feedback", "Give feedback", "Feedback for CadabraCraft", 700],
  ] as const) {
    await step(
      `help: the ${form} dialog loads the support form, centred, and closes with Close`,
      async () => {
        await clickText("button", button);
        const f = await waitFrame();
        assert(f.src.startsWith(`${ORIGIN}/embed/${form}`), `frame src is ${f.src}`);
        await app.sleep(4000); // the page loads under the real CSP, or the dialog swaps the frame for the offline notice
        const after = await frame();
        assert(
          after,
          "the frame went away: the form could not load (CSP, navigation guard or no network)",
        );
        assert(
          after.height >= minHeight,
          `frame is ${after.height}px, expected at least ${minHeight}`,
        );
        const dialogGap = Math.abs(after.dialogLeft - (after.vw - after.dialogRight));
        assert(dialogGap <= 2, `the dialog is off centre by ${dialogGap}px`);
        const frameGap = Math.abs(
          after.left - after.dialogLeft - (after.dialogRight - after.right),
        );
        assert(frameGap <= 2, `the form frame is off centre in the dialog by ${frameGap}px`);
        const heading = await app.js<string>(
          `document.querySelector('[role="dialog"]')?.getAttribute("aria-label") ?? document.querySelector('[role="dialog"] h2')?.textContent ?? ""`,
        );
        assert(heading.includes(title), `dialog title is "${heading}"`);
        await shot(`help-${form}`);
        await clickText('[role="dialog"] button', "Close");
        await app.sleep(500);
        assert(!(await frame()), "the dialog is still open after Close");
        return `${after.src}, ${after.height}px high, centred (dialog ${dialogGap}px, frame ${frameGap}px off)`;
      },
    );
  }

  await step("settings: back from Help", async () => {
    await app.click("Back").catch(() => {});
    await app.sleep(600);
  });
}
