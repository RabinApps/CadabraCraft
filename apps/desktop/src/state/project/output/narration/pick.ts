import { chaptersOf, isTranslated, sourceEdition } from "@cadabracraft/format";
import { t } from "@lingui/core/macro";
import type { Ctx } from "../../context";

/**
 * The chapters of one edition that an audiobook reads, in order: chapters only (not matter), the ones asked for, and not the
 * untranslated ones. Those stop the export unless `skipUntranslated` (the other exports behave the same).
 */
export const createPickChapters =
  (ctx: Ctx) =>
  async (o: { language?: string; skipUntranslated?: boolean; chapterIds?: string[] }) => {
    const { need, loadChaptersIn } = ctx;
    const { manifest } = need();
    const language = o.language ?? sourceEdition(manifest.editions).language;
    const edition = manifest.editions.find((e) => e.language === language);
    if (!edition) throw new Error(t`This book has no ${language} edition.`);
    const missing = chaptersOf(manifest).filter(
      (e) =>
        !isTranslated(e, language, manifest.editions) &&
        (!o.chapterIds || o.chapterIds.includes(e.id)),
    );
    if (missing.length && !o.skipUntranslated) {
      const names = missing.map((e) => e.titles[language] ?? e.id).join(", ");
      throw new Error(t`Not translated yet in ${language}: ${names}. Translate them or skip them.`);
    }
    const left = new Set(missing.map((e) => e.id));
    const pages = (await loadChaptersIn(language)).filter(
      (p) =>
        p.section === "chapter" &&
        p.kind !== "blank" &&
        p.kind !== "part" &&
        !left.has(p.id) &&
        (!o.chapterIds || o.chapterIds.includes(p.id)),
    );
    return { language, edition, pages };
  };
