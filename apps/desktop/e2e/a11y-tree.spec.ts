import { expect, test } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { newProject } from "./support/helpers";

// What assistive technology is given: roles, names, states and order, read from the browser's accessibility tree.
// This is not speech (docs/accessibility.md, "Screen readers"), but a missing name or a lost state shows up here.

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

test("home: one h1 and named actions", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("main")).toMatchAriaSnapshot(`
    - main:
      - heading "Write your first book" [level=1]
      - button "New project"
      - button "Open folder"
      - button "Import…"
  `);
});

test("New book dialog: every field has a name and Create waits for a folder", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New project" }).click();
  await expect(page.getByRole("dialog", { name: "New book" })).toMatchAriaSnapshot(`
    - dialog "New book":
      - heading "New book" [level=2]
      - textbox "Title"
      - textbox "Author"
      - combobox "Trim size"
      - textbox "Folder"
      - button "Choose…"
      - button "Cancel"
      - button "Create book" [disabled]
  `);
});

test("editor: toolbar, chapter list and heading expose names and states", async ({ page }) => {
  await newProject(page);
  await expect(page.getByRole("toolbar", { name: "Formatting" })).toMatchAriaSnapshot(`
    - toolbar "Formatting":
      - group:
        - button "Undo" [disabled]
        - button "Redo" [disabled]
      - group:
        - button "Bold"
        - button "Italic"
        - button "Underline"
        - button "Small caps"
        - button "Link"
      - group:
        - button "Heading 1" [pressed]
        - button "Heading 2"
        - button "Heading 3"
      - group:
        - button "Block quote"
        - button "Bulleted list"
        - button "Numbered list"
      - group:
        - button "Scene break"
        - button "Image"
        - button "Image details" [disabled]
        - button "Footnote"
  `);
  await expect(page.getByRole("navigation", { name: "Chapters" })).toMatchAriaSnapshot(`
    - navigation "Chapters":
      - region "Chapters":
        - heading "Chapters" [level=2]
        - list:
          - listitem:
            - button "Chapter One"
            - button "Actions for Chapter One"
      - button "Add chapter"
      - button "Trash"
  `);
  // The page ornament and the chapter label are decoration: they are not part of the heading's name.
  await expect(page.getByRole("textbox", { name: "Page text" })).toMatchAriaSnapshot(`
    - textbox "Page text":
      - heading "Chapter One" [level=1]
  `);
});

test("Export dialog: formats are one radio group and each option is a named checkbox", async ({
  page,
}) => {
  await newProject(page);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await expect(dialog).toMatchAriaSnapshot(`
    - dialog "Export book":
      - heading "Export book" [level=2]
      - radiogroup "Format":
        - radio "EPUB 3" [checked]
        - radio "Print PDF"
        - radio "Markdown"
        - radio "Word (.docx)"
        - radio "Rich Text (.rtf)"
        - radio "Audiobook"
      - list "Checks"
      - button "Cancel"
      - button "Export"
  `);
  await dialog.getByRole("radio", { name: "Print PDF" }).click();
  await expect(dialog).toMatchAriaSnapshot(`
    - dialog "Export book":
      - radiogroup "Format":
        - radio "Print PDF" [checked]
      - combobox "Template"
      - combobox "Body font"
      - combobox "Heading font"
      - checkbox "PDF/A (archival)"
      - checkbox "PDF/UA (accessible)"
      - checkbox "Add bleed (0.125 in)"
      - checkbox "Crop marks"
      - button "Print preview"
      - button "Export"
  `);
});

test("Add image dialog and images: a described image has a name, a decorative one is hidden", async ({
  page,
}) => {
  await newProject(page);
  const toolbar = page.getByRole("toolbar", { name: "Formatting" });
  await page.locator(".ProseMirror p").last().click();
  await toolbar.getByRole("button", { name: "Image", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add image" });
  await expect(dialog).toMatchAriaSnapshot(`
    - dialog "Add image":
      - heading "Add image" [level=2]
      - textbox "Image file"
      - textbox "Description (alt text)"
      - checkbox "This image is decorative"
      - textbox "Caption"
      - button "Cancel"
      - button "Insert"
  `);
  await dialog.getByLabel("Description (alt text)").fill("A single pixel");
  await dialog.getByRole("button", { name: "Insert" }).click();
  // The new image is selected; a second insert would replace it, so put the caret in the next paragraph.
  await page.locator(".ProseMirror p").last().click();
  await toolbar.getByRole("button", { name: "Image", exact: true }).click();
  await dialog.getByLabel("This image is decorative").check();
  await dialog.getByRole("button", { name: "Insert" }).click();

  const editor = page.getByRole("textbox", { name: "Page text" });
  await expect(editor.getByRole("img", { name: "A single pixel" })).toHaveCount(1);
  await expect(editor.getByRole("img")).toHaveCount(1);
});

test("chapter row menu: the First letter group and its three choices are named", async ({
  page,
}) => {
  await newProject(page);
  await page.getByRole("button", { name: "Actions for Chapter One" }).click();
  await expect(page.getByRole("menu")).toMatchAriaSnapshot(`
    - menu "Actions for Chapter One":
      - menuitem "Rename"
      - menuitem "Change icon…"
      - menuitem "Move up" [disabled]
      - menuitem "Move down" [disabled]
      - separator
      - group "First letter":
        - menuitemradio "Default" [checked]
        - menuitemradio "Big"
        - menuitemradio "Normal"
      - separator
      - menuitem "History"
      - menuitem "Move to trash"
  `);
});

test("chapter icon picker: one pressed choice, named by its icon", async ({ page }) => {
  await newProject(page);
  await page.getByRole("button", { name: "Actions for Chapter One" }).click();
  await page.getByRole("menuitem", { name: "Change icon…" }).click();
  const dialog = page.getByRole("dialog", { name: "Icon for “Chapter One”" });
  await expect(dialog.getByRole("button", { name: "None" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(dialog.getByRole("button", { pressed: true })).toHaveCount(1);
  await expect(dialog.getByRole("button", { name: "Moon" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("templates panel: the big first letter is one named radio group", async ({ page }) => {
  await newProject(page);
  await page.getByRole("button", { name: "Change template" }).click();
  const group = page.getByRole("radiogroup", { name: "Big first letter" });
  await expect(group.getByRole("radio")).toHaveText(["Template default (on)", "On", "Off"]);
  await expect(group.getByRole("radio", { checked: true })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Big first letter" })).toBeVisible();
  await group.getByRole("radio", { name: "On", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Big first letter: on" })).toBeAttached();
});
