import { Channel, invoke } from "@tauri-apps/api/core";
import { binary, type FontPack, type InstalledFont, type RawBytes } from "./types";

/** The font library: the download catalog, installed (downloaded and imported) families and their bytes. Errors are `FontError` shapes (`{ kind, ... }`). */
export const fontsBridge = {
  /** The curated catalog of open-licence families and whether each is installed. */
  fontsCatalog: () => invoke<FontPack[]>("fonts_catalog"),
  /** Families the app keeps in its own folder (downloaded or imported). */
  fontsInstalled: () => invoke<InstalledFont[]>("fonts_installed"),
  /** Downloads a catalog family (resuming a stopped download); `onProgress` gets the bytes of the whole family. Stop it with `fontsCancel(jobId)`. */
  fontsDownload: (
    fontId: string,
    jobId: string,
    onProgress: (p: { done: number; total: number }) => void,
  ): Promise<void> => {
    const channel = new Channel<{ done: number; total: number }>();
    channel.onmessage = onProgress;
    return invoke<void>("fonts_download", { fontId, jobId, onProgress: channel });
  },
  fontsCancel: (jobId: string) => invoke<void>("fonts_cancel", { jobId }),
  /** Copies a .ttf or .otf file (an absolute path from the native picker, never stored) into the app's fonts. */
  fontsImport: (srcPath: string) => invoke<InstalledFont>("fonts_import", { srcPath }),
  fontsDelete: (fontId: string) => invoke<void>("fonts_delete", { fontId }),
  /** The bytes of one file of an installed family, for the editor's @font-face. */
  fontsData: (fontId: string, file: string): Promise<Uint8Array> =>
    binary(invoke<RawBytes>("fonts_data", { fontId, file })),
};
