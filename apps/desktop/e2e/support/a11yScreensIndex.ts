import type { Page } from "@playwright/test";
import { dialogOf, shown, type Screen } from "./a11yScreenHelpers";
import { newProject, seedChapters } from "./helpers";

const text = (t: string, marks?: unknown[]) => ({
  type: "text" as const,
  text: t,
  ...(marks ? { marks } : {}),
});
const doc = (...content: unknown[]) => ({
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "One" }] },
    { type: "paragraph", content },
  ] as never,
});

/** A book with one index term (with a sub-entry and a cross-reference that points nowhere) and one glossary term in use. */
const withMarks = async (page: Page) => {
  await newProject(page);
  await seedChapters(page, [
    doc(
      text("magic", [{ type: "indexEntry", attrs: { id: "a1", term: "Magic", sub: "spells" } }]),
      text(" and "),
      text("wizards", [
        { type: "indexEntry", attrs: { id: "a2", term: "Wizards", see: "Sorcery" } },
      ]),
      text(" and an "),
      text("orb", [{ type: "glossaryTerm", attrs: { id: "g1" } }]),
    ),
  ]);
  await page.evaluate(() => {
    const m = JSON.parse(window.__disk["cadabra.json"] as string);
    m.glossary = {
      enabled: true,
      heading: "Glossary",
      order: "alpha",
      inIndex: false,
      markFirstUse: true,
      showUndefined: true,
      entries: [
        { id: "g1", term: "Orb", definition: "A sphere of glass." },
        { id: "g2", term: "Gloom", definition: "" },
      ],
    };
    window.__disk["cadabra.json"] = JSON.stringify(m);
    sessionStorage.setItem("disk", JSON.stringify(window.__disk));
  });
  await page.reload();
  await page.getByRole("button", { name: "Open folder" }).click();
  await shown(page.locator(".ProseMirror h1").first());
};

const selectWords = async (page: Page, words: string) => {
  await page.evaluate((w) => {
    const e = (
      document.querySelector(".ProseMirror") as unknown as {
        editor: {
          state: {
            doc: {
              descendants: (f: (n: { isText: boolean; text?: string }, p: number) => void) => void;
            };
          };
          commands: {
            setTextSelection: (r: { from: number; to: number }) => void;
            focus: () => void;
          };
        };
      }
    ).editor;
    let at = -1;
    e.state.doc.descendants((n, p) => {
      const i = at < 0 && n.isText ? (n.text ?? "").indexOf(w) : -1;
      if (i >= 0) at = p + i;
    });
    e.commands.setTextSelection({ from: at, to: at + w.length });
    e.commands.focus();
  }, words);
};

const open = (name: string) => async (page: Page) => {
  await withMarks(page);
  await page.getByRole("button", { name, exact: true }).first().click();
  await shown(page.getByRole("region", { name }));
};

/** The back-of-book index and the glossary: both panels, their dialogs, and the words marked in the page. */
export const indexScreens: Screen[] = [
  { name: "Index panel", open: open("Index") },
  {
    name: "Index entry dialog",
    open: async (p) => {
      await withMarks(p);
      await selectWords(p, "and");
      await p.keyboard.press("ControlOrMeta+Alt+X");
      await shown(dialogOf(p, "Index entry"));
    },
  },
  {
    name: "Edit index entry dialog",
    open: async (p) => {
      await open("Index")(p);
      await p.getByRole("button", { name: "Edit index entry Magic" }).click();
      await shown(dialogOf(p, "Edit index entry"));
    },
  },
  {
    name: "Index settings dialog",
    open: async (p) => {
      await open("Index")(p);
      await p.getByRole("button", { name: "Index settings" }).click();
      await shown(dialogOf(p, "Index settings"));
    },
  },
  { name: "Glossary panel", open: open("Glossary") },
  {
    name: "Glossary term dialog",
    open: async (p) => {
      await withMarks(p);
      await selectWords(p, "and");
      await p.keyboard.press("ControlOrMeta+Shift+G");
      await shown(dialogOf(p, "Glossary term"));
    },
  },
  {
    name: "Glossary entry dialog",
    open: async (p) => {
      await open("Glossary")(p);
      await p.getByRole("button", { name: "Edit glossary entry Orb" }).click();
      await shown(dialogOf(p, "Glossary entry"));
    },
  },
  {
    name: "Glossary settings dialog",
    open: async (p) => {
      await open("Glossary")(p);
      await p.getByRole("button", { name: "Glossary settings" }).click();
      await shown(dialogOf(p, "Glossary settings"));
    },
  },
];
