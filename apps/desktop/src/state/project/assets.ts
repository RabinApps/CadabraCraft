import { t } from "@lingui/core/macro";
import { bridge } from "../../lib/bridge";
import { whyText } from "../../lib/projectError";
import { alertOf } from "./util";
import { COVER_EXTENSIONS, type AssetActions } from "./types";
import type { Ctx } from "./context";

/** Picking an image and copying it into the project's assets/. */
export const createAssetActions = (ctx: Ctx): AssetActions => {
  const { set, need } = ctx;
  return {
    async importCover() {
      const { root } = need();
      const picked = await bridge.pickImage();
      if (!picked) return null;
      const ext = picked.slice(picked.lastIndexOf(".") + 1).toLowerCase();
      if (!COVER_EXTENSIONS.includes(ext)) {
        set(alertOf(t`A cover must be a PNG, JPEG or WebP image. Choose another file.`));
        return null;
      }
      try {
        return await bridge.importAsset(root, picked);
      } catch (e) {
        const why = whyText(e);
        set(alertOf(t`Could not add the cover: ${why}. Choose another image and try again.`));
        return null;
      }
    },
    async importImage() {
      const { root } = need();
      const picked = await bridge.pickImage();
      if (!picked) return null;
      try {
        return await bridge.importAsset(root, picked);
      } catch (e) {
        const why = whyText(e);
        set(alertOf(t`Could not add the image: ${why}. Choose another image and try again.`));
        return null;
      }
    },
  };
};
