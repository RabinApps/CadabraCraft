import { t } from "@lingui/core/macro";
import { bridge } from "../../lib/bridge";
import { errText } from "../../lib/projectError";
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
        set({ notice: t`A cover must be a PNG, JPEG or WebP image.` });
        return null;
      }
      try {
        return await bridge.importAsset(root, picked);
      } catch (e) {
        set({ notice: t`Could not add the cover: ${errText(e)}` });
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
        set({ notice: t`Could not add the image: ${errText(e)}` });
        return null;
      }
    },
  };
};
