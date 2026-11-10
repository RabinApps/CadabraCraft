import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, type Context } from "./context.ts";

const FIELDS = {
  Publisher: "  Quill & Ink Press ",
  Series: " The Gate Cycle ",
  "Number in series": " 2 ",
  "Publication date": "2026-03-15",
  Subjects: " FIC014000 \n\nfantasy gates \n",
  Description: "  A gate, an old tired keeper & a long road.\n  ",
  Rights: " © 2026 A. Writer. All rights reserved. ",
};

const WANT = {
  publisher: "Quill & Ink Press",
  description: "A gate, an old tired keeper & a long road.",
  subjects: ["FIC014000", "fantasy gates"],
  series: "The Gate Cycle",
  seriesNumber: "2",
  rights: "© 2026 A. Writer. All rights reserved.",
  published: "2026-03-15",
};

/** Book details, "Publishing details": fill, save, check cadabra.json (formatVersion 13), export EPUB, check the OPF and EPUBCheck. */
export async function publishingDetailsSteps(ctx: Context) {
  await publishingDetailsPart1(ctx);
  await publishingDetailsPart2(ctx);
}

async function publishingDetailsPart1(ctx: Context) {
  const { app, book, dlg, shot, step } = ctx;
  const manifest = () => JSON.parse(readFileSync(join(book, "cadabra.json"), "utf8"));
  const setField = (label: string, value: string) =>
    dlg(`const l = [...d.querySelectorAll("label")].find((l) => l.textContent.trim().startsWith(${JSON.stringify(label)}));
    if (!l) throw new Error("no label: ${label}"); const el = d.querySelector("#" + CSS.escape(l.htmlFor));
    if (!el) throw new Error("no field for: ${label}");
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true })); return el.value;`);
  const openDetails = async () => {
    await app.click("Book details");
    await app.sleep(800);
    assert(
      (await app.snapshot()).dialogs.some((d) => d.includes("Book details")),
      "dialog did not open",
    );
    await dlg(
      `const s = d.querySelector("details > summary"); if (!s) throw new Error("no Publishing details"); if (!s.parentElement.open) s.click(); return s.textContent;`,
    );
    await app.sleep(300);
  };
  const submit = () =>
    dlg(
      `[...d.querySelectorAll("button")].find((b) => b.textContent.trim() === "Save details").click(); return "saved";`,
    );

  await step(
    "Book details: a wrong series number shows the inline message and writes nothing",
    async () => {
      const before = readFileSync(join(book, "cadabra.json"), "utf8");
      await openDetails();
      await setField("Series", "The Gate Cycle");
      await setField("Number in series", "one");
      await app.sleep(300);
      const text = await dlg<string>(`return d.innerText;`);
      assert(
        text.includes("Use a number such as 1 or 2.5."),
        `no inline message: ${text.slice(0, 200)}`,
      );
      await submit();
      await app.sleep(1200);
      assert(
        (await app.snapshot()).dialogs.some((d) => d.includes("Book details")),
        "the dialog closed on a bad value",
      );
      assert(
        readFileSync(join(book, "cadabra.json"), "utf8") === before,
        "cadabra.json changed after a refused save",
      );
      await app.click("Cancel");
      await app.sleep(600);
      return 'series number "one" refused inline, cadabra.json untouched';
    },
  );

  await step(
    "Book details: Publishing details saved to cadabra.json as formatVersion 13",
    async () => {
      await openDetails();
      for (const [label, value] of Object.entries(FIELDS)) await setField(label, value);
      await app.sleep(400);
      await shot("06-book-details-publishing");
      // The window is shorter than the dialog, so scroll the dialog's own scroller to show the fields below the fold.
      await dlg(
        `for (const e of [d, ...d.querySelectorAll("*")]) if (e.scrollHeight > e.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(e).overflowY)) e.scrollTop = e.scrollHeight; return "scrolled";`,
      );
      await app.sleep(300);
      await shot("06-book-details-publishing-fields");
      await submit();
      await app.sleep(1500);
      assert(
        !(await app.snapshot()).dialogs.some((d) => d.includes("Book details")),
        "dialog did not close",
      );
      const m = manifest();
      assert(m.formatVersion === 13, `formatVersion is ${m.formatVersion}, expected 13`);
      const got = m.editions[0].publishing;
      assert(
        got &&
          JSON.stringify(Object.entries(got).sort()) ===
            JSON.stringify(Object.entries(WANT).sort()),
        `publishing wrong: ${JSON.stringify(got)}`,
      );
      return "formatVersion 13, editions[0].publishing has the 7 trimmed values";
    },
  );
}

async function publishingDetailsPart2(ctx: Context) {
  const { app, book, repo, exportVia, status, step } = ctx;
  await step(
    "EPUB export carries the publishing details in the OPF and passes EPUBCheck",
    async () => {
      await exportVia("EPUB 3");
      await app.sleep(1500);
      for (let i = 0; i < 15 && !(await status()).includes("exports/en/book.epub"); i++)
        await app.sleep(1000);
      const epub = join(book, "exports/en/book.epub");
      const opf = execFileSync("unzip", ["-p", epub, "OEBPS/content.opf"], { encoding: "utf8" });
      const must = [
        "<dc:publisher>Quill &amp; Ink Press</dc:publisher>",
        "<dc:description>A gate, an old tired keeper &amp; a long road.</dc:description>",
        "<dc:subject>FIC014000</dc:subject>",
        "<dc:subject>fantasy gates</dc:subject>",
        "<dc:rights>© 2026 A. Writer. All rights reserved.</dc:rights>",
        "<dc:date>2026-03-15",
        'property="belongs-to-collection"',
        ">The Gate Cycle</meta>",
        'property="group-position">2</meta>',
      ];
      for (const s of must) assert(opf.includes(s), `OPF lacks ${s}:\n${opf.slice(0, 1500)}`);
      assert((opf.match(/<dc:subject>/g) ?? []).length === 2, "expected exactly two dc:subject");
      const jar = join(repo, "tools/epubcheck-5.4.0/epubcheck.jar");
      assert(existsSync(jar), "EPUBCheck jar missing");
      const o = execFileSync("java", ["-jar", jar, epub], { encoding: "utf8" });
      assert(o.includes("No errors or warnings detected"), o.slice(-300));
      return "OPF has publisher, description, 2 subjects, rights, date, series with group-position; EPUBCheck: 0 errors, 0 warnings";
    },
  );
}
