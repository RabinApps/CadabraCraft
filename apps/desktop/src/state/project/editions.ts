import { t } from "@lingui/core/macro";
import { addEdition, sourceEdition } from "@cadabracraft/format";
import { bridge } from "../../lib/bridge";
import { emptyDoc } from "./util";
import type { EditionActions } from "./types";
import type { Ctx } from "./context";

/** The book's languages: which edition the editor shows, and adding one. */
export const createEditionActions = (ctx: Ctx): EditionActions => {
  const { set, get, need, saveManifest, flush, reloadCurrent } = ctx;
  return {
    async setLanguage(language) {
      const { manifest } = need();
      if (!manifest.editions.some((e) => e.language === language))
        throw new Error(t`This book has no ${language} edition.`);
      await flush(); // typing is saved in the language it was typed in
      set({
        activeLanguage: language === sourceEdition(manifest.editions).language ? null : language,
      });
      await reloadCurrent();
    },
    async addLanguage(language, mode) {
      await flush();
      const { root, manifest } = need();
      const source = sourceEdition(manifest.editions);
      const { manifest: next, files } = addEdition(
        manifest,
        {
          language,
          title: source.title,
          author: source.author,
          identifier: `urn:uuid:${crypto.randomUUID()}`,
          isbn: null,
          cover: null,
        },
        mode,
      );
      const hashes = { ...get().hashes };
      for (const f of files) {
        let contents: string;
        if (f.from === null) {
          contents = JSON.stringify(emptyDoc(f.title), null, 2);
        } else {
          const r = await bridge.readFile(root, f.from);
          if (!r) throw new Error(t`Missing chapter file ${f.from}`);
          contents = r.contents;
        }
        const w = await bridge.writeFile(root, f.path, contents, hashes[f.path] ?? null);
        hashes[f.path] = w.hash;
      }
      set({ hashes });
      await saveManifest(next);
      set({ activeLanguage: language });
      await reloadCurrent();
    },
  };
};
