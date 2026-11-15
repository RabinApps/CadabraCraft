import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assert, type Context } from "../context.ts";
import { linkAndNoteSteps } from "./links.ts";

const PDF =
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R 4 0 R]/Count 2>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\n4 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R/Size 5>>\n%%EOF";

export async function referencesSteps(ctx: Context) {
  const { app, book, src, shot, step } = ctx;
  const manifest = () => JSON.parse(readFileSync(join(book, "cadabra.json"), "utf8"));
  const pdf = join(src, "Lighthouse history.pdf");
  const exe = join(src, "setup.exe");
  writeFileSync(pdf, PDF);
  writeFileSync(exe, "MZ");
  const clickLabelled = (label: string) =>
    app.js(
      `(() => { const b = [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === ${JSON.stringify(label)} || b.textContent.trim() === ${JSON.stringify(label)} || b.querySelector("[data-title]")?.textContent.trim() === ${JSON.stringify(label)});
      if (!b) throw new Error("no button: ${label}"); b.click(); return "clicked"; })()`,
    );

  /** The Add button is a menu (Radix opens it on pointer down): open it, then choose Add files. */
  const addFiles = async () => {
    await app.js(
      `document.querySelector('section[aria-label="References"] button[aria-haspopup="menu"]')?.dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true }))`,
    );
    await app.sleep(300);
    await app.js(
      `(() => { const i = [...document.querySelectorAll('[role=menuitem]')].find((i) => i.textContent.trim() === "Add files"); if (!i) throw new Error("no Add files item"); i.click(); return "clicked"; })()`,
    );
  };

  await step("references: import a PDF through the real Rust commands and list it", async () => {
    // The panel stays open between runs (it is an app preference), so only open it when it is closed.
    const shown = await app.js<boolean>(
      `!!document.querySelector('section[aria-label="References"]')`,
    );
    if (!shown) await clickLabelled("References");
    await app.sleep(500);
    await app.queueDialogs([pdf]);
    await addFiles();
    await app.sleep(1500);
    assert(existsSync(join(book, "references/Lighthouse-history.pdf")), "the PDF was not copied");
    assert(
      readFileSync(join(book, "references/Lighthouse-history.pdf"), "utf8") === PDF,
      "the copy differs",
    );
    const m = manifest();
    assert(m.references?.length === 1, "the manifest does not list the reference");
    assert(m.references[0].title === "Lighthouse history", "wrong title");
    assert(existsSync(pdf), "the source file was touched");
    await shot("11-references");
    return "references/Lighthouse-history.pdf";
  });

  await step("references: a program is refused and nothing is left behind", async () => {
    await app.queueDialogs([exe]);
    await addFiles();
    await app.sleep(1000);
    const text = await app.js<string>(
      `document.querySelector('section[aria-label="References"]')?.textContent ?? ""`,
    );
    assert(text.includes("cannot be added as a reference"), "no refusal message");
    assert(
      !readdirSync(join(book, "references")).some((f) => f.includes("setup")),
      "the program was copied",
    );
    assert(manifest().references.length === 1, "the refused file was listed");
    return "setup.exe refused";
  });

  await step("references: the PDF is drawn page by page from ranged reads", async () => {
    await clickLabelled("Dismiss");
    await clickLabelled("Lighthouse history");
    await app.sleep(2500);
    const drawn = await app.js<number>(
      `(document.querySelector('canvas[aria-label^="PDF page"]')?.width ?? 0)`,
    );
    assert(drawn > 100, `the PDF page was not drawn (canvas width ${drawn})`);
    await clickLabelled("Next page");
    await app.sleep(800);
    const label = await app.js<string>(
      `document.querySelector('canvas[aria-label^="PDF page"]')?.getAttribute("aria-label")`,
    );
    assert(label === "PDF page 2", `still on ${label}`);
    await shot("12-pdf-viewer");
    return "2 pages";
  });

  await step(
    "references: removing it moves the file to the trash and keeps the folder tidy",
    async () => {
      await clickLabelled("Remove from book");
      await app.sleep(1200);
      assert(manifest().references.length === 0, "still listed");
      assert(
        !existsSync(join(book, "references/Lighthouse-history.pdf")),
        "the file is still in references/",
      );
      const trashed = readdirSync(join(book, ".cadabra/trash")).filter((f) =>
        f.endsWith("references__Lighthouse-history.pdf"),
      );
      assert(trashed.length === 1, "the file is not in the trash");
      return trashed[0];
    },
  );
  await linkAndNoteSteps(ctx);
}
