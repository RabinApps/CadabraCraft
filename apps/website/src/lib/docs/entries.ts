import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import { parseFrontmatter } from "./frontmatter";
import { extractHeadings, type Heading } from "./headings";

export type Kind = "docs" | "guides";

export type Entry = {
  slug: string;
  title: string;
  description: string;
  group: string;
  order: number;
  updated: string;
  tag: string;
  summary: string;
  readMinutes: number;
  headings: Heading[];
  /** The locale whose file is used; differs from the requested locale when the page is not translated yet. */
  locale: Locale;
  fallback: boolean;
  /** Path of the source file relative to the repo root, for "Edit on GitHub". */
  file: string;
};

const CONTENT_DIR = path.join(process.cwd(), "src", "content");

function dir(locale: Locale, kind: Kind): string {
  return path.join(CONTENT_DIR, locale, kind);
}

function readEntry(locale: Locale, kind: Kind, slug: string, requested: Locale): Entry {
  const file = path.join(dir(locale, kind), `${slug}.mdx`);
  const { data, body } = parseFrontmatter(readFileSync(file, "utf8"));
  const str = (k: string) => (typeof data[k] === "string" ? data[k] : "");
  const num = (k: string, d: number) => (typeof data[k] === "number" ? data[k] : d);
  return {
    slug,
    title: str("title"),
    description: str("description"),
    group: str("group"),
    order: num("order", 999),
    updated: str("updated"),
    tag: str("tag"),
    summary: str("summary"),
    readMinutes: num("readMinutes", 0),
    headings: extractHeadings(body),
    locale,
    fallback: locale !== requested,
    file: `apps/website/src/content/${locale}/${kind}/${slug}.mdx`,
  };
}

/** Every page of a kind for a locale: the default-locale set, each replaced by its translation when one exists. */
export function listEntries(locale: Locale, kind: Kind): Entry[] {
  const base = dir(DEFAULT_LOCALE, kind);
  if (!existsSync(base)) return [];
  const slugs = readdirSync(base)
    .filter((f) => f.endsWith(".mdx"))
    .map((f) => f.slice(0, -4));
  return slugs
    .map((slug) => {
      const own = path.join(dir(locale, kind), `${slug}.mdx`);
      return existsSync(own) ? readEntry(locale, kind, slug, locale) : readEntry(DEFAULT_LOCALE, kind, slug, locale);
    })
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

export function getEntry(locale: Locale, kind: Kind, slug: string): Entry | undefined {
  return listEntries(locale, kind).find((e) => e.slug === slug);
}
