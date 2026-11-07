import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { assert, type Context } from "./context.ts";
import { diskHelpers, featureBookRoot, typeAtEnd, until } from "./feature-book.ts";

const q = (v: unknown) => JSON.stringify(v);

/** The same size text the dialog prints ("12 KB", "3 MB"), for the sizes this scenario makes (well under a gigabyte). */
const sizeText = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${Math.round(bytes / (1024 * 1024))} MB`
    : `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("en")} KB`;

/** The snapshot files under .cadabra/snapshots, oldest first (a name is `<stamp>` or `<stamp>~<n>`). */
function snapshotFiles(root: string) {
  const { list } = diskHelpers(root);
  const key = (f: string) => {
    const [stamp = "", n = "1"] = f.replace(/\.json$/, "").split("~");
    return `${stamp}~${n.padStart(4, "0")}`;
  };
  return list(".cadabra/snapshots")
    .filter((f) => f.endsWith(".json"))
    .sort((a, b) => key(a).localeCompare(key(b)));
}

/** The header fields of a snapshot file (the page texts are not needed). */
function headerOf(root: string, rel: string) {
  const j = JSON.parse(readFileSync(join(root, rel), "utf8"));
  return { name: j.name as string, automatic: j.automatic as boolean, pinned: j.pinned === true };
}

/** Buttons and fields of the open dialog, found by their accessible name. */
function dialogHelpers(ctx: Context) {
  const { app, dlg } = ctx;
  const clickLabel = (label: string) =>
    dlg(
      `const b = [...d.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === ${q(label)} || b.textContent.trim() === ${q(label)}); if (!b) throw new Error("no button: " + ${q(label)}); b.click(); return "clicked";`,
    );
  const dialogText = () => dlg<string>(`return d.innerText;`);
  const close = async () => {
    await app.js(
      `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`,
    );
    await app.sleep(500);
  };
  return { clickLabel, dialogText, close };
}

/** Sets Settings > Backups > "Book snapshots to keep": the field applies on blur, as a real edit does. */
async function setKeep(ctx: Context, n: number) {
  const { app, runMenu } = ctx;
  await runMenu("app.settings");
  // The field has a visually hidden <label>; the value applies when the field is left, as a real edit does.
  const shown = await app.js<string>(
    `(() => { const l = [...document.querySelectorAll("label")].find((l) => l.textContent.trim() === "Book snapshots to keep"); const el = l && (l.control ?? document.getElementById(l.htmlFor));
    if (!el) throw new Error("no Book snapshots to keep field"); el.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${q(String(n))});
    el.dispatchEvent(new Event("input", { bubbles: true })); el.blur(); return el.value; })()`,
  );
  await app.sleep(400);
  assert(shown === String(n), `the field shows ${shown}, not ${n}`);
  await app.click("Back");
  await app.sleep(1000);
}

export async function snapshotSteps(ctx: Context) {
  await namedSnapshotStep(ctx);
  await pruneStep(ctx);
  await compareStep(ctx);
}

async function namedSnapshotStep(ctx: Context) {
  const { app, step, shot } = ctx;
  const root = featureBookRoot(ctx);
  const { clickLabel, dialogText, close } = dialogHelpers(ctx);
  await step(
    "book snapshots (real Rust): take a named one, Pin it, Rename it with Enter; the files and the '<n> snapshots · <size>' header agree",
    async () => {
      await app.click("Book snapshots");
      await app.sleep(1000);
      assert(
        (await app.snapshot()).dialogs.some((d) => d.includes("History · Whole book")),
        "the Book snapshots button did not open History · Whole book",
      );
      await app.fill("#snapshot-name", "Before the rewrite");
      await app.click("Take snapshot");
      await until(ctx, () => snapshotFiles(root).length === 1, "no snapshot file was written");
      await app.sleep(800);
      const rel = `.cadabra/snapshots/${snapshotFiles(root)[0]}`;
      let head = headerOf(root, rel);
      assert(
        head.name === "Before the rewrite" && !head.automatic && !head.pinned,
        `file header: ${JSON.stringify(head)}`,
      );
      let text = await dialogText();
      assert(text.includes("Before the rewrite") && text.includes("Named"), `row: ${text}`);
      const size = sizeText(statSync(join(root, rel)).size);
      assert(
        text.includes(`1 snapshot · ${size}`),
        `header line should read "1 snapshot · ${size}": ${text.slice(0, 300)}`,
      );

      await clickLabel("Pin Before the rewrite");
      await until(ctx, () => headerOf(root, rel).pinned, "Pin did not reach the snapshot file");
      head = headerOf(root, rel);
      assert(head.name === "Before the rewrite", "pinning changed the name");
      await app.sleep(500);
      text = await dialogText();
      assert(text.includes("Pinned"), "the row has no Pinned badge");

      await clickLabel("Rename Before the rewrite");
      await app.sleep(400);
      await app.fill("#snapshot-rename", "Keeper");
      // Enter in the field submits its form; a synthetic keydown would not, so submit the form the same way Enter does.
      await app.js(`document.querySelector("#snapshot-rename").form.requestSubmit()`);
      await until(
        ctx,
        () => headerOf(root, rel).name === "Keeper",
        "Rename did not reach the file",
      );
      head = headerOf(root, rel);
      assert(head.pinned && !head.automatic, `rename lost the pin: ${JSON.stringify(head)}`);
      assert(snapshotFiles(root).length === 1, "renaming made another snapshot file");
      await app.sleep(500);
      text = await dialogText();
      assert(
        text.includes("Keeper") && !text.includes("Before the rewrite"),
        "the list does not show the new name",
      );
      await shot("21-book-snapshot");
      await close();
      return `snapshot file ${rel}: name Keeper, pinned, not automatic; header "1 snapshot · ${size}"`;
    },
  );
}

async function pruneStep(ctx: Context) {
  const { app, step, shot } = ctx;
  const root = featureBookRoot(ctx);
  const { list } = diskHelpers(root);
  const { dialogText, close } = dialogHelpers(ctx);
  await step(
    "book snapshots: with 'Book snapshots to keep' at 5, the oldest automatic ones move to .cadabra/trash (never deleted), the pinned one stays, and the notice says so",
    async () => {
      await setKeep(ctx, 5);
      const keeper = `.cadabra/snapshots/${snapshotFiles(root)[0]}`;
      // Automatic snapshots are made by restoring a book (the safety copy), which does not prune.
      for (let i = 0; i < 5; i++)
        await app.invoke("restore_book_snapshot", { root, snapshot: keeper });
      const before = snapshotFiles(root);
      assert(before.length === 6, `expected 6 snapshot files, got ${before.length}`);
      const autos = before.filter((f) => headerOf(root, `.cadabra/snapshots/${f}`).automatic);
      assert(autos.length === 5, `expected 5 automatic snapshots, got ${autos.length}`);

      await app.click("Book snapshots");
      await app.sleep(1000);
      await app.fill("#snapshot-name", "Second");
      await app.click("Take snapshot");
      await until(
        ctx,
        () => list(".cadabra/trash").some((f) => f.includes("-snapshot__")),
        "nothing moved to .cadabra/trash",
      );
      await app.sleep(1000);
      const after = snapshotFiles(root);
      assert(after.length === 5, `5 should remain, found ${after.length}: ${after.join(", ")}`);
      const moved = list(".cadabra/trash").filter((f) => f.includes("-snapshot__"));
      assert(moved.length === 2, `2 snapshots should be in the trash: ${moved.join(", ")}`);
      // The two oldest automatic ones went (the trash name is `<stamp>-snapshot__<original name>`).
      const originals = moved.map((f) => f.split("-snapshot__")[1]).sort();
      assert(
        JSON.stringify(originals) === JSON.stringify(autos.slice(0, 2).sort()),
        `the trash holds ${originals.join(", ")}, not the two oldest automatic ones (${autos.slice(0, 2).join(", ")})`,
      );
      for (const f of moved) {
        const j = JSON.parse(readFileSync(join(root, ".cadabra/trash", f), "utf8"));
        assert(
          j.automatic === true && j.pages,
          `${f} in the trash is not an intact automatic snapshot`,
        );
      }
      assert(after.includes(keeper.split("/").pop()!), "the pinned snapshot was moved");
      assert(headerOf(root, keeper).pinned, "the pinned snapshot lost its pin");
      assert(
        after.filter((f) => headerOf(root, `.cadabra/snapshots/${f}`).name === "Second").length ===
          1,
        "the new snapshot is not among the five",
      );
      const status = (await app.snapshot()).status.join(" | ");
      assert(
        status.includes("2 older snapshots moved to .cadabra/trash"),
        `the notice did not show: ${status}`,
      );
      const total = after.reduce(
        (sum, f) => sum + statSync(join(root, ".cadabra/snapshots", f)).size,
        0,
      );
      const text = await dialogText();
      assert(
        text.includes(`5 snapshots · ${sizeText(total)}`),
        `header line should read "5 snapshots · ${sizeText(total)}": ${text.slice(0, 300)}`,
      );
      await shot("22-snapshot-prune");
      await close();
      await setKeep(ctx, 50); // back to the default for the steps after this one
      return `5 kept (pinned Keeper, Second, 3 automatic); 2 oldest automatic in .cadabra/trash; notice shown`;
    },
  );
}

async function compareStep(ctx: Context) {
  const { app, step, shot, openMenu, pickItem, dlg } = ctx;
  const root = featureBookRoot(ctx);
  const { clickLabel, close } = dialogHelpers(ctx);
  await step(
    "History > Whole book from a chapter row: the chapter is compared with the chosen snapshot, word by word",
    async () => {
      await app.click("Chapter One").catch(() => {});
      await app.sleep(800);
      await typeAtEnd(ctx, " Written after the snapshot.");
      const file = diskHelpers(root).chapterNamed("Chapter One").files.en!;
      await until(
        ctx,
        () => readFileSync(join(root, file), "utf8").includes("Written after the snapshot."),
        "the new text was not saved",
      );
      await openMenu("Actions for Chapter One");
      await app.sleep(300);
      await pickItem("History");
      await app.sleep(1200);
      await dlg(
        `const r = [...d.querySelectorAll("button,[role=radio]")].find((e) => e.textContent.trim() === "Whole book"); if (!r) throw new Error("no Whole book choice"); r.click(); return "picked";`,
      );
      await app.sleep(1200);
      // Pick the pinned snapshot's row (a button whose text starts with its name).
      await dlg(
        `const ul = d.querySelector('ul[aria-label="Book snapshots"]'); const b = [...ul.querySelectorAll("li > button")].find((e) => e.textContent.includes("Keeper")); if (!b) throw new Error("Keeper is not listed"); b.click(); return "picked";`,
      );
      await until(
        ctx,
        async () =>
          (await dlg<boolean>(`return !!d.querySelector('[aria-label^="Comparison of"]');`).catch(
            () => false,
          )) === true,
        "no comparison appeared for the chosen snapshot",
      );
      await app.sleep(600);
      const marks = JSON.parse(
        await dlg<string>(
          `const c = d.querySelector('[aria-label^="Comparison of"]'); return JSON.stringify({ label: c.getAttribute("aria-label"), added: [...c.querySelectorAll("ins")].map((e) => e.textContent), removed: [...c.querySelectorAll("del")].map((e) => e.textContent) });`,
        ),
      );
      const all = [...marks.added, ...marks.removed].join(" ");
      assert(
        all.includes("after the snapshot."),
        `the diff does not show the text written after the snapshot: ${JSON.stringify(marks)}`,
      );
      assert(
        marks.label.includes("Chapter One") && marks.label.includes("with the snapshot"),
        `comparison label: ${marks.label}`,
      );
      const restorePage = (await app.snapshot()).buttons.includes("Restore this page only");
      assert(restorePage, "no 'Restore this page only' for a chapter the snapshot holds");
      await shot("23-snapshot-compare");
      await clickLabel("Cancel").catch(() => {});
      await close();
      return `the chapter differs from the snapshot by: ${JSON.stringify(marks)}`;
    },
  );
}
