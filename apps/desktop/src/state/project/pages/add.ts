import { t } from "@lingui/core/macro";
import {
  addBackMatter,
  addChapter,
  addFrontMatter,
  addPart as insertPart,
  addPartBefore as insertPartBefore,
  addBlank as insertBlank,
  starterDoc,
  starterTitle,
  sourceEdition,
  sourceFile,
} from "@cadabracraft/format";
import { bridge } from "../../../lib/bridge";
import { emptyDoc } from "../util";
import type { PageActions } from "../types";
import type { Ctx } from "../context";

/** Adding pages: a chapter, a part, front or back matter, a blank page. */
export const createAddActions = (
  ctx: Ctx,
): Pick<PageActions, "add" | "addPart" | "startPart" | "addMatter" | "addBlank"> => {
  const { set, get, need, saveManifest, record, flush, load } = ctx;
  return {
    async add(title) {
      await flush();
      const { root, manifest } = need();
      const { manifest: next, entry } = addChapter(manifest, title);
      const w = await bridge.writeFile(
        root,
        sourceFile(entry, manifest.editions),
        JSON.stringify(emptyDoc(title), null, 2),
        null,
      );
      set({ hashes: { ...get().hashes, [sourceFile(entry, manifest.editions)]: w.hash } });
      await saveManifest(next);
      record(
        {
          label: t`Add ${title}`,
          file: { path: sourceFile(entry, manifest.editions), added: true },
        },
        manifest,
        next,
      );
      await load(entry.id);
    },
    async addPart(title) {
      await flush();
      const { root, manifest } = need();
      const { manifest: next, entry } = insertPart(manifest, title, get().currentId ?? undefined);
      const file = sourceFile(entry, manifest.editions);
      const w = await bridge.writeFile(root, file, JSON.stringify(emptyDoc(title), null, 2), null);
      set({ hashes: { ...get().hashes, [file]: w.hash } });
      await saveManifest(next);
      record({ label: t`Add ${title}`, file: { path: file, added: true } }, manifest, next);
      await load(entry.id);
    },
    async startPart(id, title) {
      await flush();
      const { root, manifest } = need();
      const { manifest: next, entry } = insertPartBefore(manifest, title, id);
      const file = sourceFile(entry, manifest.editions);
      const w = await bridge.writeFile(root, file, JSON.stringify(emptyDoc(title), null, 2), null);
      set({ hashes: { ...get().hashes, [file]: w.hash } });
      await saveManifest(next);
      record({ label: t`Add ${title}`, file: { path: file, added: true } }, manifest, next);
      await load(entry.id);
    },
    async addMatter(section, kind, title) {
      await flush();
      const { root, manifest } = need();
      const name = title ?? starterTitle(kind, sourceEdition(manifest.editions).language);
      // A blank page is added straight after the page that was open: the author put it between two particular pages.
      const { manifest: next, entry } = (section === "front" ? addFrontMatter : addBackMatter)(
        manifest,
        kind,
        name,
        get().currentId ?? undefined,
      );
      const doc = starterDoc(kind, {
        title: sourceEdition(manifest.editions).title,
        author: sourceEdition(manifest.editions).author,
        language: sourceEdition(manifest.editions).language,
        isbn: sourceEdition(manifest.editions).isbn,
        year: new Date().getFullYear(),
      });
      const w = await bridge.writeFile(
        root,
        sourceFile(entry, manifest.editions),
        JSON.stringify(doc, null, 2),
        null,
      );
      set({ hashes: { ...get().hashes, [sourceFile(entry, manifest.editions)]: w.hash } });
      await saveManifest(next);
      record(
        {
          label: t`Add ${name}`,
          file: { path: sourceFile(entry, manifest.editions), added: true },
        },
        manifest,
        next,
      );
      await load(entry.id);
    },
    async addBlank() {
      await flush();
      const { root, manifest } = need();
      const name = starterTitle("blank", sourceEdition(manifest.editions).language);
      // A blank page goes straight after the open page, in that page's own part of the book; with no page open, at the end of the
      // chapters (before the back matter).
      const { manifest: next, entry } = insertBlank(manifest, get().currentId ?? undefined, name);
      const file = sourceFile(entry, manifest.editions);
      const w = await bridge.writeFile(root, file, JSON.stringify(emptyDoc(name), null, 2), null);
      set({ hashes: { ...get().hashes, [file]: w.hash } });
      await saveManifest(next);
      record({ label: t`Add ${name}`, file: { path: file, added: true } }, manifest, next);
      await load(entry.id);
    },
  };
};
