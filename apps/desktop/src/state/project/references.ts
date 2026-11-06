import { t } from "@lingui/core/macro";
import {
  addReference,
  removeReference as removeFromManifest,
  moveReference as moveInManifest,
  treeOf,
  updateReference as updateInManifest,
} from "@cadabracraft/format";
import { bridge } from "../../lib/bridge";
import { baseName } from "../../lib/paths";
import { forgetReference } from "../../lib/references/references";
import { isProjectError, whyText } from "../../lib/projectError";
import { removedReferences, titleFromFile } from "../../lib/references/referenceKinds";
import { alertOf, HISTORY_LIMIT } from "./util";
import type { ReferenceActions, ReferenceNotice } from "./types";
import type { Ctx } from "./context";

/** Reference files: importing into `references/`, the manifest list, and removal to the project trash. */
export const createReferenceActions = (ctx: Ctx): ReferenceActions => {
  const { set, get, need, saveManifest } = ctx;
  return {
    async addReferences(paths) {
      const { root } = need();
      const picked = paths ?? (await bridge.pickReferenceFiles());
      if (picked.length === 0) return;
      const notices: ReferenceNotice[] = [];
      for (const [i, source] of picked.entries()) {
        const name = baseName(source);
        set({ referenceImport: { name, index: i + 1, total: picked.length } });
        try {
          const got = await bridge.importReference(root, source);
          const { manifest } = need();
          if (manifest.references.some((r) => r.file === got.file)) {
            notices.push({
              tone: "warn",
              text: t`${name} is already in this book. Using the existing file.`,
            });
            continue;
          }
          const added = addReference(manifest, {
            file: got.file,
            title: got.title,
            addedAt: new Date().toISOString(),
          });
          await saveManifest(added.manifest);
        } catch (e) {
          notices.push({
            tone: "danger",
            text: t`Could not add ${name}: ${whyText(e)}. Choose another file and try again.`,
          });
        }
      }
      set({ referenceImport: null, referenceNotices: notices });
    },
    async updateReference(id, patch) {
      try {
        await saveManifest(updateInManifest(need().manifest, id, patch));
      } catch (e) {
        set(alertOf(t`Could not save the reference: ${whyText(e)}. Try again.`));
      }
    },
    async refreshRemovedReferences() {
      const { root } = need();
      const entries = await bridge.listTrash(root).catch(() => null);
      if (entries && get().root === root) set({ removedReferences: removedReferences(entries) });
    },
    async restoreReference(trashPath) {
      const { root } = need();
      const name = titleFromFile(
        get().removedReferences.find((r) => r.path === trashPath)?.original ?? trashPath,
      );
      try {
        const file = await bridge.restoreTrash(root, trashPath);
        const added = addReference(need().manifest, {
          file,
          title: titleFromFile(file),
          addedAt: new Date().toISOString(),
        });
        await saveManifest(added.manifest);
      } catch (e) {
        return t`Could not restore ${name}: ${whyText(e)}. Try again, or add the file again.`;
      }
      set({ removedReferences: get().removedReferences.filter((r) => r.path !== trashPath) });
      return null;
    },
    async moveReference(id, to) {
      try {
        await saveManifest(moveInManifest(need().manifest, id, to));
      } catch (e) {
        set(alertOf(t`Could not reorder the references: ${whyText(e)}. Try again.`));
      }
    },
    async removeReference(id) {
      const { root, manifest } = need();
      const ref = manifest.references.find((r) => r.id === id);
      if (!ref) return;
      try {
        await saveManifest(removeFromManifest(manifest, id).manifest);
      } catch (e) {
        set(alertOf(t`Could not remove ${ref.title}: ${whyText(e)}. Try again.`));
        return;
      }
      forgetReference(root, ref.file);
      try {
        const trashPath = await bridge.trashReference(root, ref.file);
        void get().actions.refreshRemovedReferences();
        // Book Undo brings it back (file from the trash, list entry at its old place).
        const tree = treeOf(manifest);
        set({
          history: {
            undo: [
              ...get().history.undo,
              {
                label: t`Remove ${ref.title}`,
                before: tree,
                after: tree,
                reference: { item: ref, index: manifest.references.indexOf(ref), trashPath },
              },
            ].slice(-HISTORY_LIMIT),
            redo: [],
          },
        });
      } catch (e) {
        // A file that is already gone needs nothing; any other failure leaves the file behind, which is harmless.
        if (!(isProjectError(e) && e.kind === "not_found"))
          set(
            alertOf(
              t`${ref.title} was removed, but its file could not be moved to the trash: ${whyText(e)}. You can delete the file from the references folder yourself.`,
            ),
          );
      }
    },
    dismissReferenceNotices() {
      if (get().referenceNotices.length) set({ referenceNotices: [] });
    },
  };
};
