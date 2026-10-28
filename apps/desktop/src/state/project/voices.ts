import { t } from "@lingui/core/macro";
import { bridge } from "../../lib/bridge";
import { mapAudioError } from "../../lib/audioRunner";
import { describeAudioError } from "../../lib/audioErrors";
import type { VoiceDownload, VoiceActions } from "./types";
import type { Ctx } from "./context";

/** Downloading voice packs for the audiobook. */
export const createVoiceActions = (ctx: Ctx): VoiceActions => {
  const { set, get } = ctx;
  let voiceAbort: AbortController | null = null;
  return {
    async downloadVoices(packs) {
      if (get().voiceDownload?.status === "running") throw new Error(t`A download is already running`);
      const total = packs.reduce((n, p) => n + p.bytes, 0);
      const jobId = crypto.randomUUID();
      const ctrl = new AbortController();
      voiceAbort = ctrl;
      const update = (patch: Partial<VoiceDownload>) => set((s) => (s.voiceDownload ? { voiceDownload: { ...s.voiceDownload, ...patch } } : {}));
      set({ voiceDownload: { status: "running", done: 0, total, cancelling: false, error: null } });
      const stop = () => void bridge.audioCancel(jobId).catch(() => undefined);
      ctrl.signal.addEventListener("abort", stop, { once: true });
      let before = 0;
      try {
        for (const pack of packs) {
          await bridge.audioDownloadPack(pack.id, jobId, (p) => update({ done: before + p.done })).catch((e) => { throw mapAudioError(e); });
          before += pack.bytes;
        }
        set({ voiceDownload: null });
        return true;
      } catch (e) {
        update({ status: "error", error: describeAudioError(e) });
        return false;
      } finally {
        voiceAbort = null;
        bridge.audioForget(jobId).catch(() => undefined);
      }
    },
    cancelVoiceDownload() {
      if (!voiceAbort) return;
      set((s) => (s.voiceDownload ? { voiceDownload: { ...s.voiceDownload, cancelling: true } } : {}));
      voiceAbort.abort();
    },
    dismissVoiceDownload() {
      if (get().voiceDownload?.status !== "running") set({ voiceDownload: null });
    },
  };
};
