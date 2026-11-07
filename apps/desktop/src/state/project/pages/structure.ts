import { t } from "@lingui/core/macro";
import {
  moveChapter,
  movePart as movePartIn,
  moveMatter,
  readingOrder,
  removeChapter,
  removePart as removePartIn,
  removeMatter,
  renameChapter,
  renameMatter,
  setChapterDropCap,
  setMatterVerticalCenter,
  setMatterStartOnNext,
  setEntryIcon,
  sectionOf,
  sourceEdition,
  sourceFile,
  sourceTitle,
  sourceTitleById,
  renameIn,
  linksOf,
} from "@cadabracraft/format";
import { bridge } from "../../../lib/bridge";
import type { HistoryEntry, PageActions } from "../types";
import type { Ctx } from "../context";

/** Changing the page list: rename, move, page settings and removing a page (to the trash). */
export const createStructureActions = (
  ctx: Ctx,
): Pick<
  PageActions,
  | "rename"
  | "move"
  | "movePart"
  | "setIcon"
  | "setChapterDropCap"
  | "setVerticalCenter"
  | "setStartOnNext"
  | "remove"
> => {
  const { set, get, need, langOf, saveManifest, record, flush, load } = ctx;
  return {
    async rename(id, title) {
      const m = need().manifest;
      const lang = langOf(m);
      if (lang !== sourceEdition(m.editions).language) {
        // A translated title is not part of the chapter tree, so it is not in the undo history.
        await saveManifest(renameIn(m, id, lang, title));
        return;
      }
      const next =
        sectionOf(m, id) === "chapter" ? renameChapter(m, id, title) : renameMatter(m, id, title);
      await saveManifest(next);
      record({ label: t`Rename ${sourceTitleById(m, id)!}` }, m, next);
    },
    async move(id, delta) {
      const m = need().manifest;
      const entry = m.chapters.find((e) => e.id === id);
      if (entry?.kind === "part") {
        const nextPart = movePartIn(m, id, delta);
        if (nextPart === m) return;
        await saveManifest(nextPart);
        record({ label: t`Move ${sourceTitleById(m, id)!}` }, m, nextPart);
        return;
      }
      const next =
        sectionOf(m, id) === "chapter" ? moveChapter(m, id, delta) : moveMatter(m, id, delta);
      await saveManifest(next);
      record({ label: t`Move ${sourceTitleById(m, id)!}` }, m, next);
    },
    async movePart(id, delta) {
      const m = need().manifest;
      const next = movePartIn(m, id, delta);
      if (next === m) return;
      await saveManifest(next);
      record({ label: t`Move ${sourceTitleById(m, id)!}` }, m, next);
    },
    async setIcon(id, icon) {
      const m = need().manifest;
      const next = setEntryIcon(m, id, icon);
      await saveManifest(next);
      record({ label: t`Change icon of ${sourceTitleById(m, id)!}` }, m, next);
    },
    async setChapterDropCap(id, dropCap) {
      const m = need().manifest;
      const next = setChapterDropCap(m, id, dropCap);
      await saveManifest(next);
      record({ label: t`Change first letter of ${sourceTitleById(m, id)!}` }, m, next);
    },
    async setVerticalCenter(id, verticalCenter) {
      const m = need().manifest;
      const next = setMatterVerticalCenter(m, id, verticalCenter);
      await saveManifest(next);
      record({ label: t`Change vertical position of ${sourceTitleById(m, id)!}` }, m, next);
    },
    async setStartOnNext(id, startOnNext) {
      const m = need().manifest;
      const next = setMatterStartOnNext(m, id, startOnNext);
      await saveManifest(next);
      record({ label: t`Change page start of ${sourceTitleById(m, id)!}` }, m, next);
    },
    async remove(id) {
      await flush(); // typing in the page being removed would otherwise be written back after it went to trash
      const { root, manifest } = need();
      const currentId = get().currentId;
      const part = manifest.chapters.find((e) => e.id === id)?.kind === "part";
      const { manifest: next, removed } =
        sectionOf(manifest, id) === "chapter"
          ? part
            ? removePartIn(manifest, id)
            : removeChapter(manifest, id)
          : removeMatter(manifest, id);
      const links = linksOf(manifest, id);
      await saveManifest(next);
      const trashPath = await bridge.trashFile(root, sourceFile(removed, manifest.editions)); // moved to .cadabra/trash, never permanently deleted
      // The page's translations go with it (a translation file may not exist yet: the page was added after the edition).
      const sourceLang = sourceEdition(manifest.editions).language;
      const others: NonNullable<HistoryEntry["others"]> = [];
      for (const [language, path] of Object.entries(removed.files)) {
        if (language === sourceLang || !(await bridge.readFile(root, path))) continue;
        others.push({ language, path, trashPath: await bridge.trashFile(root, path) });
      }
      record(
        {
          label: t`Move ${sourceTitle(removed, manifest.editions)} to trash`,
          file: { path: sourceFile(removed, manifest.editions), added: false },
          trashPath,
          ...(others.length ? { others } : {}),
          ...(links.length ? { links } : {}),
        },
        manifest,
        next,
      );
      if (currentId === id) {
        set({ currentId: null, currentDoc: null });
        const fallback = next.chapters[0] ?? readingOrder(next)[0];
        if (fallback) await load(fallback.id);
      }
    },
  };
};
