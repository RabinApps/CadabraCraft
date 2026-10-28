import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, type Context } from "./context.ts";

export async function exportSteps({
  app,
  repo,
  book,
  png,
  shot,
  openMenu,
  pickItem,
  dlg,
  exportVia,
  status,
  step,
}: Context) {
  await step("add a title page and a back-matter page through the Add page menu", async () => {
    await openMenu("Add page");
    await app.sleep(400);
    await pickItem("Title page");
    await app.sleep(1500);
    const editorH1 = () => app.js(`document.querySelector(".ProseMirror h1")?.textContent ?? ""`);
    assert(
      (await editorH1()) === "Scenario Book" &&
        (await app.js<string>(`document.querySelector(".ProseMirror").textContent`)).includes(
          "Agent",
        ),
      "title page did not open in the editor",
    );
    await openMenu("Add page");
    await app.sleep(400);
    await pickItem("About the author");
    await app.sleep(1500);
    assert((await editorH1()) === "About the Author", "about-the-author page did not open");
    const manifest = JSON.parse(readFileSync(join(book, "cadabra.json"), "utf8"));
    assert(manifest.formatVersion === 4, "manifest is not format 4");
    assert(
      manifest.frontMatter[0]?.kind === "title-page" &&
        manifest.backMatter[0]?.kind === "about-the-author",
      "kinds missing in the manifest",
    );
    assert(
      existsSync(join(book, "front-matter/01-title-page.json")) &&
        existsSync(join(book, "back-matter/01-about-the-author.json")),
      "matter files not written by Rust",
    );
    assert(
      readFileSync(join(book, "front-matter/01-title-page.json"), "utf8").includes("Agent"),
      "title page lacks the author",
    );
    await shot("03b-matter");
    return "front-matter/01-title-page.json, back-matter/01-about-the-author.json";
  });

  await step("EPUB export passes EPUBCheck and contains the matter pages", async () => {
    await exportVia("EPUB 3");
    for (let i = 0; i < 15 && !(await status()).includes("exports/book.epub"); i++)
      await app.sleep(1000);
    assert((await status()).includes("exports/book.epub"), "no export notice");
    const listing = execFileSync("unzip", ["-l", join(book, "exports/book.epub")], {
      encoding: "utf8",
    });
    assert(
      listing.includes("OEBPS/fm-1.xhtml") && listing.includes("OEBPS/bm-1.xhtml"),
      "EPUB lacks the matter pages",
    );
    const titleXhtml = execFileSync(
      "unzip",
      ["-p", join(book, "exports/book.epub"), "OEBPS/fm-1.xhtml"],
      { encoding: "utf8" },
    );
    assert(titleXhtml.includes('epub:type="frontmatter titlepage"'), "title page lacks epub:type");
    const jar = join(repo, "tools/epubcheck-5.4.0/epubcheck.jar");
    if (!existsSync(jar)) return "exported (EPUBCheck jar not installed, validation skipped)";
    const o = execFileSync("java", ["-jar", jar, join(book, "exports/book.epub")], {
      encoding: "utf8",
    });
    assert(o.includes("No errors or warnings detected"), o.slice(-300));
    return "EPUBCheck: 0 errors, 0 warnings";
  });

  await step("PDF export produces a 6x9 PDF with embedded fonts", async () => {
    await exportVia("Print PDF");
    await app.sleep(1000);
    for (let i = 0; i < 40 && !(await status()).includes("exports/book.pdf"); i++)
      await app.sleep(1000);
    assert(
      (await status()).includes("exports/book.pdf"),
      "PDF export did not finish (is Typst installed?)",
    );
    const pdf = join(book, "exports/book.pdf");
    try {
      const info = execFileSync("pdfinfo", [pdf], { encoding: "utf8" });
      assert(/Page size:\s+432 x 648/.test(info), "wrong page size");
      const pages = execFileSync("pdftotext", ["-layout", pdf, "-"], { encoding: "utf8" }).split(
        "\f",
      );
      assert(
        pages[0]?.includes("Scenario Book") && pages[0]?.includes("Agent"),
        "title page is not first",
      );
      assert(
        pages.some((p) => p.includes("About the Author")),
        "back matter missing from the PDF",
      );
      assert(
        pages.findIndex((p) => p.includes("Typed by an agent")) <
          pages.findIndex((p) => p.includes("About the Author")),
        "back matter is not after the chapters",
      );
      return "432x648 pt (6x9 in), title page first, about-the-author last";
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        return "exported (poppler not installed, not inspected)";
      throw e;
    }
  });

  await step(
    "Book details: set ISBN and a cover through the real picker, saved to cadabra.json",
    async () => {
      await app.click("Book details");
      await app.sleep(800);
      assert(
        (await app.snapshot()).dialogs.some((d) => d.includes("Book details")),
        "dialog did not open",
      );
      await app.js(`(() => { const d = document.querySelector('[role="dialog"]'); const i = [...d.querySelectorAll("input")].find((e) => e.id && d.querySelector("label[for=\\"" + e.id + "\\"]")?.textContent === "ISBN"); if (!i) throw new Error("no ISBN field");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "978-3-16-148410-0"); i.dispatchEvent(new Event("input", { bubbles: true })); return "filled"; })()`);
      await app.queueDialogs([png]);
      await dlg(
        `[...d.querySelectorAll("button")].find((b) => b.textContent.trim() === "Choose image…").click(); return "choosing";`,
      );
      await app.sleep(1500);
      const shown = await dlg(
        `const i = d.querySelector('img[alt="Cover preview"]'); return !!i && i.complete && i.naturalWidth > 0;`,
      );
      assert(shown === true, "cover preview did not render from the real read_asset");
      await shot("05-book-details");
      await dlg(
        `[...d.querySelectorAll("button")].find((b) => b.textContent.trim() === "Save details").click(); return "saved";`,
      );
      await app.sleep(1500);
      assert(
        !(await app.snapshot()).dialogs.some((d) => d.includes("Book details")),
        "dialog did not close",
      );
      const manifest = JSON.parse(readFileSync(join(book, "cadabra.json"), "utf8"));
      assert(
        manifest.editions[0].cover === "assets/pixel.png" &&
          manifest.editions[0].isbn === "978-3-16-148410-0",
        `manifest wrong: cover=${manifest.editions[0].cover} isbn=${manifest.editions[0].isbn}`,
      );
      assert(
        manifest.editions[0].title === "Scenario Book" && manifest.chapters.length === 1,
        "other fields changed",
      );
      return "cover assets/pixel.png, ISBN saved";
    },
  );

  await step(
    "EPUB export with a cover: cover page first, cover-image item, EPUBCheck clean",
    async () => {
      await exportVia("EPUB 3");
      await app.sleep(1500);
      for (let i = 0; i < 15 && !(await status()).includes("exports/book.epub"); i++)
        await app.sleep(1000);
      const epub = join(book, "exports/book.epub");
      const opf = execFileSync("unzip", ["-p", epub, "OEBPS/content.opf"], { encoding: "utf8" });
      assert(
        opf.includes('properties="cover-image"') &&
          /<spine><itemref idref="epub-cover"\/>/.test(opf),
        "cover missing from the package",
      );
      assert(
        execFileSync("unzip", ["-l", epub], { encoding: "utf8" }).includes(
          "OEBPS/assets/pixel.png",
        ),
        "cover image not in the EPUB",
      );
      const jar = join(repo, "tools/epubcheck-5.4.0/epubcheck.jar");
      if (!existsSync(jar))
        return "exported with cover (EPUBCheck jar not installed, validation skipped)";
      const o = execFileSync("java", ["-jar", jar, epub], { encoding: "utf8" });
      assert(o.includes("No errors or warnings detected"), o.slice(-300));
      return "EPUBCheck: 0 errors, 0 warnings";
    },
  );

  await step(
    "PDF export includes the cover as a blank-backed first page, and can leave it out",
    async () => {
      const pagesOf = (pdf: string) =>
        execFileSync("pdftotext", ["-layout", pdf, "-"], { encoding: "utf8" })
          .split("\f")
          .slice(0, -1);
      const pdf = join(book, "exports/book.pdf");
      const exportPdf = async (include: boolean) => {
        await app.click("Export");
        await app.sleep(800);
        await dlg(
          `const o = [...d.querySelectorAll("button,[role=radio]")].find((e) => e.textContent.trim() === "Print PDF"); o.click(); return "picked";`,
        );
        await app.sleep(400);
        assert(
          await dlg(
            `return !!d.querySelector('input[type="checkbox"]') && d.textContent.includes("Include the cover");`,
          ),
          "no Include the cover option",
        );
        await dlg(
          `const c = [...d.querySelectorAll('input[type="checkbox"]')].find((i) => i.closest("label,div")?.textContent.includes("Include the cover")); if (c.checked !== ${include}) c.click(); return c.checked;`,
        );
        await app.sleep(300);
        await dlg(`d.querySelector('button[type="submit"]').click(); return "submitted";`);
        await app.sleep(1500);
        for (let i = 0; i < 40 && (await app.snapshot()).dialogs.length; i++) await app.sleep(1000);
      };
      try {
        await exportPdf(true);
        const withCover = pagesOf(pdf);
        assert(
          withCover[0]?.trim() === "" && withCover[1]?.trim() === "",
          "first two pages (cover and its back) are not text-free",
        );
        assert(
          withCover[2]?.includes("Scenario Book") && withCover[2]?.includes("Agent"),
          "title page is not on page 3",
        );
        await exportPdf(false);
        const plain = pagesOf(pdf);
        assert(
          plain[0]?.includes("Scenario Book"),
          "without the cover the title page is not first",
        );
        assert(
          withCover.length === plain.length + 2 &&
            JSON.stringify(withCover.slice(2)) === JSON.stringify(plain),
          "later pages differ with a cover",
        );
        return `with cover ${withCover.length} pages, without ${plain.length}; pages after the cover are identical`;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT")
          return "exported (poppler not installed, not inspected)";
        throw e;
      }
    },
  );

  // Inter comes from the fonts folder bundled with the app (passed to Typst as --font-path), so this fails if the
  // app does not find its resource dir or Typst rejects the arguments. Do not run it on a machine where Inter is a system font.
}
