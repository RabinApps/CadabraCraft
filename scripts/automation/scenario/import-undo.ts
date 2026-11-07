import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { assert, type Context } from "./context.ts";
import { diskHelpers, featureBookRoot, until } from "./feature-book.ts";

const SOURCE = [
  "# Imported One",
  "",
  "First imported chapter.",
  "",
  "## Imported Sub",
  "",
  "Sub heading text.",
  "",
  "# Imported Two",
  "",
  "Second imported chapter.",
  "",
  "# Imported Three",
  "",
  "Third imported chapter.",
  "",
].join("\n");

const ORDER = ["Chapter One", "Imported One", "Imported Two", "Imported Three", "Chapter 2"];
const SPLIT_ORDER = [
  "Chapter One",
  "Imported One",
  "Imported Sub",
  "Imported Two",
  "Imported Three",
  "Chapter 2",
];

/** The chapter files in the trash that came from pages with these words in their name. */
const trashed = (list: (dir: string) => string[], word: string) =>
  list(".cadabra/trash").filter((f) => f.includes(word));

export async function importUndoSteps(ctx: Context) {
  await importIntoStep(ctx);
  await splitStep(ctx);
}

async function importIntoStep(ctx: Context) {
  const { app, src, step, shot, runMenu, menuState, dlg } = ctx;
  const root = featureBookRoot(ctx);
  const disk = diskHelpers(root);
  await step(
    "import into this book: 'After Chapter One' puts three chapters in place on disk; book Undo moves their files to .cadabra/trash and restores the manifest; Redo brings them back",
    async () => {
      const source = join(src, "feature.md");
      writeFileSync(source, SOURCE);
      const before = disk.titles();
      assert(before.join() === "Chapter One,Chapter 2", `the book starts with ${before}`);
      await app.queueDialogs([source]);
      await runMenu("file.importInto");
      assert(
        (await app.snapshot()).dialogs.some((d) => d.includes("Import into this book")),
        "File > Import into This Book did not open the wizard",
      );
      await app.click("Choose file…");
      await app.sleep(500);
      await app.click("Next");
      await app.sleep(1500);
      // The destination is a native <select>: pick the option by its text.
      const picked = await dlg<string>(
        `const s = [...d.querySelectorAll("select")].find((e) => [...e.options].some((o) => o.textContent.trim() === "After Chapter One")); if (!s) throw new Error("no 'After Chapter One' choice: " + [...d.querySelectorAll("option")].map((o) => o.textContent).join(" | ")); const o = [...s.options].find((o) => o.textContent.trim() === "After Chapter One"); s.value = o.value; s.dispatchEvent(new Event("change", { bubbles: true })); return o.value;`,
      );
      assert(picked.length > 0, "the 'After Chapter One' choice has no entry id");
      assert(
        (await app.snapshot()).buttons.includes("Add to book"),
        "no 'Add to book' button in the preview step",
      );
      await shot("24-import-into-preview");
      await app.click("Add to book");
      await until(ctx, () => disk.chapters().length === 5, "the chapters were not added");
      await app.sleep(1500);
      assert(disk.titles().join() === ORDER.join(), `manifest order: ${disk.titles()}`);
      const files = ORDER.map((t) => disk.chapterNamed(t).files.en!);
      for (const f of files)
        assert(disk.list("manuscript").includes(f.split("/").pop()!), `${f} is missing`);
      const importedOne = disk.read(disk.chapterNamed("Imported One").files.en!);
      assert(
        importedOne.includes("First imported chapter.") && importedOne.includes("Imported Sub"),
        "Imported One lacks its text",
      );
      assert(
        disk
          .read(disk.chapterNamed("Imported Three").files.en!)
          .includes("Third imported chapter."),
        "Imported Three lacks its text",
      );
      const dialogs = (await app.snapshot()).dialogs;
      assert(
        dialogs.some((d) => d.includes("Imported 3 chapters")),
        `no report for 3 chapters: ${JSON.stringify(dialogs)}`,
      );
      await app.click("Done").catch(() => {});
      await app.sleep(500);
      const saved = Object.fromEntries(files.map((f) => [f, disk.read(f)]));
      assert(
        /^Undo Import feature\.md/.test((await menuState()).items.get("edit.bookUndo")?.text ?? ""),
        `Undo should name the import: ${(await menuState()).items.get("edit.bookUndo")?.text}`,
      );

      await runMenu("edit.bookUndo");
      await until(ctx, () => disk.chapters().length === 2, "Undo did not take the chapters out");
      assert(disk.titles().join() === before.join(), `manifest after Undo: ${disk.titles()}`);
      for (const t of ["imported-one", "imported-two", "imported-three"]) {
        assert(
          !disk.list("manuscript").some((f) => f.includes(t)),
          `${t} is still in manuscript/ after Undo`,
        );
        assert(
          trashed(disk.list, t).length >= 1,
          `${t} was not moved to .cadabra/trash: ${disk.list(".cadabra/trash")}`,
        );
      }
      const inTrash = disk.list(".cadabra/trash").length;
      assert(
        (await app.snapshot()).buttons.includes("Chapter One"),
        "the sidebar does not show Chapter One",
      );

      await runMenu("edit.bookRedo");
      await until(ctx, () => disk.chapters().length === 5, "Redo did not bring the chapters back");
      assert(disk.titles().join() === ORDER.join(), `manifest after Redo: ${disk.titles()}`);
      for (const f of files)
        assert(disk.read(f) === saved[f], `${f} changed through Undo and Redo`);
      return `5 chapters in order ${ORDER.join(" > ")}; Undo -> manifest back and ${inTrash} files in .cadabra/trash; Redo restored the same files`;
    },
  );
}

async function splitStep(ctx: Context) {
  const { app, step, shot, runMenu, openMenu, pickItem } = ctx;
  const root = featureBookRoot(ctx);
  const disk = diskHelpers(root);
  await step(
    "split a chapter at a heading: the row menu's 'Split at heading…' makes two chapter files and a manifest entry; Undo puts the chapter back, Redo splits again",
    async () => {
      const oneFile = disk.chapterNamed("Imported One").files.en!;
      const original = disk.read(oneFile);
      assert(
        original.includes("Sub heading text."),
        "Imported One does not hold the text to split",
      );
      await openMenu("Actions for Imported One");
      await app.sleep(300);
      await pickItem("Split at heading…");
      await app.sleep(1500);
      const dialog = (await app.snapshot()).dialogs.find((d) => d.includes("Split “Imported One”"));
      assert(dialog?.includes("Imported Sub"), `the dialog does not list the heading: ${dialog}`);
      await shot("25-split-dialog");
      await app.click("Split chapter");
      await until(ctx, () => disk.chapters().length === 6, "the chapter was not split");
      await app.sleep(1000);
      assert(disk.titles().join() === SPLIT_ORDER.join(), `manifest order: ${disk.titles()}`);
      const first = disk.read(oneFile);
      const second = disk.read(disk.chapterNamed("Imported Sub").files.en!);
      assert(
        first.includes("First imported chapter.") && !first.includes("Sub heading text."),
        "the first half holds the wrong text",
      );
      assert(
        second.includes("Sub heading text.") &&
          second.includes("Imported Sub") &&
          !second.includes("First imported chapter."),
        "the new chapter holds the wrong text",
      );
      assert(
        disk.chapterNamed("Imported Sub").files.en !== oneFile,
        "the new chapter shares the old file",
      );
      assert(
        (await app.snapshot()).buttons.includes("Imported Sub"),
        "the sidebar lacks the new chapter",
      );

      await runMenu("edit.bookUndo");
      await until(ctx, () => disk.chapters().length === 5, "Undo did not rejoin the chapter");
      assert(disk.titles().join() === ORDER.join(), `manifest after Undo: ${disk.titles()}`);
      assert(disk.read(oneFile) === original, "Imported One is not back to its text after Undo");
      assert(
        trashed(disk.list, "imported-sub").length >= 1,
        `the new chapter's file was not moved to .cadabra/trash: ${disk.list(".cadabra/trash")}`,
      );
      await runMenu("edit.bookRedo");
      await until(ctx, () => disk.chapters().length === 6, "Redo did not split again");
      assert(disk.titles().join() === SPLIT_ORDER.join(), `manifest after Redo: ${disk.titles()}`);
      assert(
        disk.read(disk.chapterNamed("Imported Sub").files.en!) === second &&
          disk.read(oneFile) === first,
        "Redo restored different text",
      );
      return "two files after the split, one after Undo (new file in .cadabra/trash), two again after Redo";
    },
  );
}
