import type { AudioFormat, LoudnessReport } from "@cadabracraft/export-audio";
import { bridge } from "../../../../lib/bridge";

const AUDIO_CACHE = ".cadabra/audio/cache.json";
interface AudioCacheEntry {
  hash: string;
  files: { format: AudioFormat; path: string }[];
  durationSec: number;
  /** The lossless part kept for the M4B; a cached chapter is only reused while it is still on disk too. */
  part?: string;
  /** The chapter's loudness as it was measured when it was rendered. */
  loudness?: LoudnessReport;
}

/** The per-chapter audio cache: local to this computer (`.cadabra/`), never needed to open the book. A missing or damaged file is an empty cache. */
export async function readAudioCache(root: string): Promise<Record<string, AudioCacheEntry>> {
  try {
    const f = await bridge.readFile(root, AUDIO_CACHE);
    const parsed: unknown = f ? JSON.parse(f.contents) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, AudioCacheEntry>)
      : {};
  } catch {
    return {};
  }
}

export async function saveAudioCache(
  root: string,
  r: {
    id: string;
    hash: string;
    files: AudioCacheEntry["files"];
    durationSec: number;
    part?: string;
    loudness?: LoudnessReport;
  },
): Promise<void> {
  const f = await bridge.readFile(root, AUDIO_CACHE).catch(() => null);
  const all = await readAudioCache(root);
  all[r.id] = {
    hash: r.hash,
    files: r.files,
    durationSec: r.durationSec,
    ...(r.part ? { part: r.part } : {}),
    ...(r.loudness ? { loudness: r.loudness } : {}),
  };
  await bridge.writeFile(root, AUDIO_CACHE, JSON.stringify(all), f?.hash ?? null);
}
