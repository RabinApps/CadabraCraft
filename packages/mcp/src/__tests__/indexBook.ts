// A small two-chapter book for the index and glossary tool tests.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Session } from "./helpers";

export const t = (text: string, ...marks: { type: string; attrs?: Record<string, unknown> }[]) => ({
  type: "text",
  text,
  ...(marks.length ? { marks } : {}),
});
export const p = (...content: unknown[]) => ({ type: "paragraph", content });
export const h = (text: string) => ({ type: "heading", attrs: { level: 1 }, content: [t(text)] });
export const bold = { type: "bold" };

export const CH1 = {
  type: "doc",
  content: [
    h("The Mana Well"),
    p(t("The "), t("mana", bold), t(" well glows. Magic is old.")),
    p(t("Mana flows from the well. Manage it, mana-rich or not.")),
    { type: "codeBlock", content: [t("mana in code")] },
  ],
};
export const CH2 = {
  type: "doc",
  content: [
    h("Spells"),
    p(t("Magic and mana, said the mage. Magic again.")),
    p(t("Fire "), { type: "hardBreak" }, t("and magic")),
  ],
};

/** A book "book" with chapters ch-1 and ch-2 written through the tools; returns the paths of the files. */
export async function indexBook(s: Session): Promise<{ file: (id: string) => string }> {
  await s.ok("cadabra_project_create", { path: "book", title: "T", author: "A", language: "en" });
  for (const [title, doc] of [
    ["The Mana Well", CH1],
    ["Spells", CH2],
  ] as const) {
    const added = await s.ok("cadabra_chapter_add", { path: "book", title });
    await s.ok("cadabra_chapter_write_json", { path: "book", chapterId: added.chapter.id, doc });
  }
  const manifest = JSON.parse(readFileSync(join(s.root, "book/cadabra.json"), "utf8"));
  return {
    file: (id) =>
      join(s.root, "book", manifest.chapters.find((c: { id: string }) => c.id === id).files.en),
  };
}

export const readDoc = (path: string): { content: unknown[] } =>
  JSON.parse(readFileSync(path, "utf8"));

/** Every text of a document with its marks, flattened, for assertions. */
export function texts(
  node: unknown,
): { text: string; marks: { type: string; attrs?: Record<string, unknown> }[] }[] {
  const n = node as { text?: string; marks?: never[]; content?: unknown[] };
  if (typeof n.text === "string") return [{ text: n.text, marks: n.marks ?? [] }];
  return (n.content ?? []).flatMap(texts);
}

/** The words of a document with all marks stripped: what the reader sees. */
export const plain = (node: unknown): string =>
  texts(node)
    .map((x) => x.text)
    .join("");
