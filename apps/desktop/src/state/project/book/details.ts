import {
  validateFonts,
  validateManifest,
  updateEdition,
  type Edition,
  type Manifest,
} from "@cadabracraft/format";
import type { TrimSize } from "@cadabracraft/shared";
import { resolveTrimSize } from "@cadabracraft/templates";
import { isbnToStored } from "../../../lib/export/isbnForm";
import { publishingFromForm, type PublishingForm } from "../../../lib/export/publishingForm";
import type { ProjectActions } from "../types";
import type { Ctx } from "../context";

/** Stores the book's trim size only when it differs from what the book resolves to now, so books that never chose one keep following their template. */
const withTrimSize = (m: Manifest, trimSize: TrimSize | undefined): Manifest =>
  !trimSize || resolveTrimSize(m) === trimSize ? m : { ...m, trimSize };

/** The edition with the retail details of `form`; with no form it is unchanged, and an empty form removes `publishing`. */
const withPublishing = (e: Edition, form: PublishingForm | undefined): Edition => {
  if (!form) return e;
  const { publishing: _old, ...rest } = e;
  const publishing = publishingFromForm(form);
  return Object.keys(publishing).length ? { ...rest, publishing } : rest;
};

/** The book-level settings in cadabra.json: template, drop cap, fonts and the Book details. */
export const createDetailsActions = (
  ctx: Ctx,
): Pick<ProjectActions, "setTemplate" | "setBookDropCap" | "setBookFonts" | "updateDetails"> => {
  const { set, get, need, saveManifest } = ctx;
  return {
    async setTemplate(id) {
      const { manifest } = need();
      if (manifest.template === id) return;
      await saveManifest({ ...manifest, template: id });
    },
    async setBookDropCap(dropCap) {
      const { manifest } = need();
      const { dropCap: _old, ...rest } = manifest;
      const next: Manifest = dropCap === null ? rest : { ...rest, dropCap };
      if (JSON.stringify(next) === JSON.stringify(manifest)) return;
      await saveManifest(next);
    },
    async setBookFonts(fonts) {
      const { manifest } = need();
      const chosen = {
        ...(fonts.body?.trim() ? { body: fonts.body.trim() } : {}),
        ...(fonts.heading?.trim() ? { heading: fonts.heading.trim() } : {}),
      };
      const { fonts: _old, ...rest } = manifest;
      const next: Manifest = Object.keys(chosen).length
        ? { ...rest, fonts: validateFonts(chosen) }
        : rest;
      if (JSON.stringify(next) === JSON.stringify(manifest)) return;
      await saveManifest(next);
    },
    async updateDetails(d, edition) {
      const { manifest } = need();
      const [source, ...translations] = manifest.editions;
      if (edition && edition !== source!.language) {
        // A translation edition: its own title, author, identifier, ISBN and cover. Its language is its key and does not change here.
        const next = updateEdition(manifest, edition, {
          title: d.title.trim(),
          author: d.author.trim(),
          identifier: d.identifier.trim(),
          isbn: isbnToStored(d.isbn),
          cover: d.cover,
        });
        const withTrim = withTrimSize(
          {
            ...next,
            editions: next.editions.map((e) =>
              e.language === edition ? withPublishing(e, d.publishing) : e,
            ),
          },
          d.trimSize,
        );
        validateManifest(withTrim);
        if (JSON.stringify(withTrim) !== JSON.stringify(manifest)) await saveManifest(withTrim);
        return;
      }
      const language = d.language.trim();
      // Changing the source language re-keys every title and file of the source edition.
      const rekey = <T>(map: Record<string, T>): Record<string, T> =>
        Object.fromEntries(
          Object.entries(map).map(([k, v]) => [k === source!.language ? language : k, v]),
        );
      const next: Manifest = withTrimSize(
        {
          ...manifest,
          editions: [
            withPublishing(
              {
                ...source!,
                language,
                title: d.title.trim(),
                author: d.author.trim(),
                identifier: d.identifier.trim(),
                isbn: isbnToStored(d.isbn),
                cover: d.cover,
              },
              d.publishing,
            ),
            ...translations,
          ],
          ...(language === source!.language
            ? {}
            : {
                frontMatter: manifest.frontMatter.map((e) => ({
                  ...e,
                  titles: rekey(e.titles),
                  files: rekey(e.files),
                })),
                chapters: manifest.chapters.map((e) => ({
                  ...e,
                  titles: rekey(e.titles),
                  files: rekey(e.files),
                })),
                backMatter: manifest.backMatter.map((e) => ({
                  ...e,
                  titles: rekey(e.titles),
                  files: rekey(e.files),
                })),
              }),
        },
        d.trimSize,
      );
      // validateManifest owns the rules; it names the field, which is enough for the dialog to show.
      validateManifest(next);
      if (JSON.stringify(next) === JSON.stringify(manifest)) return;
      await saveManifest(next);
      // The source language is the key of the shown edition: a stale `activeLanguage` would point at an edition that is gone.
      if (language !== source!.language && get().activeLanguage === source!.language)
        set({ activeLanguage: null });
    },
  };
};
