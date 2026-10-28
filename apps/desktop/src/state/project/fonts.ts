import { bridge } from "../../lib/bridge";
import { describeFontError } from "../../lib/fontErrors";
import type { FontDownload, FontActions } from "./types";
import type { Ctx } from "./context";

/** Downloading font families from the catalog, several at a time (one entry per family). */
export const createFontActions = (ctx: Ctx): FontActions => {
  const { set, get } = ctx;
  /** Cancel handles of the running downloads, by family id. */
  const running = new Map<string, () => void>();
  const update = (id: string, patch: Partial<FontDownload>) =>
    set((s) =>
      s.fontDownloads[id]
        ? { fontDownloads: { ...s.fontDownloads, [id]: { ...s.fontDownloads[id], ...patch } } }
        : {},
    );
  const drop = (id: string) =>
    set((s) => {
      const { [id]: _gone, ...rest } = s.fontDownloads;
      return { fontDownloads: rest };
    });
  return {
    async downloadFont(id, total) {
      if (get().fontDownloads[id]?.status === "running") return false;
      const jobId = crypto.randomUUID();
      set((s) => ({
        fontDownloads: {
          ...s.fontDownloads,
          [id]: { status: "running", done: 0, total, cancelling: false, error: null },
        },
      }));
      running.set(id, () => void bridge.fontsCancel(jobId).catch(() => undefined));
      try {
        await bridge.fontsDownload(id, jobId, (p) => update(id, { done: p.done, total: p.total }));
        drop(id);
        return true;
      } catch (e) {
        const error = describeFontError(e);
        // A stopped download is not a failure: the row simply goes back to Download.
        if (error.code === "cancelled") drop(id);
        else update(id, { status: "error", error });
        return false;
      } finally {
        running.delete(id);
      }
    },
    cancelFontDownload(id) {
      const stop = running.get(id);
      if (!stop) return;
      update(id, { cancelling: true });
      stop();
    },
    dismissFontDownload(id) {
      if (get().fontDownloads[id]?.status !== "running") drop(id);
    },
  };
};
