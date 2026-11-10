import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, type Context } from "./context.ts";

/** Link and note references, through the real window and the real Rust commands. */
export async function linkAndNoteSteps({ app, book, shot, step }: Context) {
  const manifest = () => JSON.parse(readFileSync(join(book, "cadabra.json"), "utf8"));
  /** Types into a React-controlled field: the native setter plus an input event. */
  const typeInto = (selector: string, value: string) =>
    app.js(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error("no field: ${selector}");
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true })); return "typed"; })()`,
    );
  const chooseAdd = async (item: string) => {
    await app.js(
      `document.querySelector('section[aria-label="References"] button[aria-haspopup="menu"]')?.dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true }))`,
    );
    await app.sleep(300);
    await app.js(
      `(() => { const i = [...document.querySelectorAll('[role=menuitem]')].find((i) => i.textContent.trim() === ${JSON.stringify(item)}); if (!i) throw new Error("no item: ${item}"); i.click(); return "clicked"; })()`,
    );
    await app.sleep(400);
  };
  const submit = (name: string) => clickInDialog(name);
  const clickInDialog = (name: string) =>
    app.js(
      `(() => { const b = [...document.querySelectorAll('[role=dialog] button[type=submit]')].find((b) => b.textContent.trim() === ${JSON.stringify(name)}); if (!b) throw new Error("no submit: ${name}"); b.click(); return "clicked"; })()`,
    );

  await step("references: a link and a note are added through the real window", async () => {
    await chooseAdd("Add link");
    await typeInto("[role=dialog] input[type=url]", "javascript:alert(1)");
    await submit("Add link");
    await app.sleep(400);
    assert(manifest().references.length === 0, "a javascript: address was kept");
    await typeInto("[role=dialog] input[type=url]", "https://saltmarsh.example.org/guide");
    await submit("Add link");
    await app.sleep(1000);
    await chooseAdd("Add note");
    await typeInto("[role=dialog] textarea", "The wall is older than the gate.\nSecond line.");
    await submit("Add note");
    await app.sleep(1000);
    const m = manifest();
    assert(m.formatVersion === 14, `format version ${m.formatVersion}`);
    assert(
      m.references.length === 2 &&
        m.references[0].kind === "link" &&
        m.references[0].url === "https://saltmarsh.example.org/guide" &&
        m.references[0].title === "saltmarsh.example.org" &&
        !("file" in m.references[0]),
      "the link is not in the manifest as expected",
    );
    assert(
      m.references[1].kind === "note" &&
        m.references[1].title === "The wall is older than the gate.",
      "the note is not in the manifest as expected",
    );
    await shot("13-references-link-note");
    return "link and note saved";
  });

  await step(
    "references: the backend refuses to open anything but an http or https address",
    async () => {
      for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "example.org"]) {
        const out = await app.js<string>(
          `window.__TAURI__.core.invoke("open_reference_url", { url: ${JSON.stringify(bad)} }).then(() => "opened", (e) => JSON.stringify(e))`,
        );
        assert(out.includes("unsupported_reference"), `${bad} was not refused: ${out}`);
      }
      return "3 addresses refused";
    },
  );

  await step("references: removing a link or a note leaves the trash alone", async () => {
    const before = readdirSync(join(book, ".cadabra/trash")).length;
    await app.js(
      `document.querySelector('button[aria-label="Actions for saltmarsh.example.org"]')?.dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true }))`,
    );
    await app.sleep(300);
    await app.js(
      `(() => { const i = [...document.querySelectorAll('[role=menuitem]')].find((i) => i.textContent.trim() === "Remove from book"); i.click(); return "ok"; })()`,
    );
    await app.sleep(1000);
    const m = manifest();
    assert(
      m.references.length === 1 && m.references[0].kind === "note",
      "the link was not removed",
    );
    assert(readdirSync(join(book, ".cadabra/trash")).length === before, "the trash changed");
    return "list entry only";
  });
}
