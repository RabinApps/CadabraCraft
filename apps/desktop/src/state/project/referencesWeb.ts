import { t } from "@lingui/core/macro";
import {
  addLinkReference,
  addNoteReference,
  normalizeWebUrl,
  updateReference as updateInManifest,
} from "@cadabracraft/format";
import { whyText } from "../../lib/projectError";
import { linkTitle, noteTitle } from "../../lib/references/dropped";
import type { ReferenceActions, ReferenceNotice } from "./types";
import type { Ctx } from "./context";

/** Links (web addresses) and text notes: entries of the manifest list with no file behind them. */
export const createWebReferenceActions = (
  ctx: Ctx,
): Pick<ReferenceActions, "addLink" | "updateLink" | "addNote" | "addDropped"> => {
  const { set, get, need, saveManifest } = ctx;
  return {
    async addLink(url, title) {
      const clean = normalizeWebUrl(url);
      if (clean === null) return t`Enter an address that starts with http:// or https://.`;
      const { manifest } = need();
      if (manifest.references.some((r) => r.kind === "link" && r.url === clean))
        return t`This address is already in this book.`;
      try {
        const added = addLinkReference(manifest, {
          url: clean,
          title: title?.trim() || linkTitle(clean),
          addedAt: new Date().toISOString(),
        });
        await saveManifest(added.manifest);
      } catch (e) {
        return t`Could not add the link: ${whyText(e)}. Try again.`;
      }
      return null;
    },
    async updateLink(id, url) {
      const clean = normalizeWebUrl(url);
      if (clean === null) return t`Enter an address that starts with http:// or https://.`;
      try {
        await saveManifest(updateInManifest(need().manifest, id, { url: clean }));
      } catch (e) {
        return t`Could not save the address: ${whyText(e)}. Try again.`;
      }
      return null;
    },
    async addNote(text, title) {
      if (text.trim() === "") return t`Write something in the note first.`;
      try {
        const added = addNoteReference(need().manifest, {
          text,
          title: title?.trim() || noteTitle(text, t`Note`),
          addedAt: new Date().toISOString(),
        });
        await saveManifest(added.manifest);
      } catch (e) {
        return t`Could not add the note: ${whyText(e)}. Try again.`;
      }
      return null;
    },
    async addDropped(items, tooLong = false) {
      const notices: ReferenceNotice[] = [];
      for (const item of items) {
        const problem =
          item.type === "link"
            ? await get().actions.addLink(item.url)
            : await get().actions.addNote(item.text);
        if (problem) notices.push({ tone: "warn", text: problem });
      }
      if (tooLong)
        notices.push({
          tone: "danger",
          text: t`That text is too long for a note, so it was not added.`,
        });
      set({ referenceNotices: notices });
    },
  };
};
