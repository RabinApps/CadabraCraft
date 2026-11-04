import { CURRENT_FORMAT_VERSION, validateManifest, type Manifest } from "./manifest";
import { FormatError } from "./errors";
import { migrateV3ToV4 } from "./editions";
import { migrateV4ToV5 } from "./references";
import { migrateV5ToV6 } from "./publishing";
import { migrateV6ToV7 } from "./toc";
import { errMsg } from "@cadabracraft/shared";

/** A migration upgrades a raw manifest object from `from` to `from + 1`. */
export type Migration = {
  from: number;
  up: (raw: Record<string, unknown>) => Record<string, unknown>;
};

// Add entries here when formatVersion is bumped; each needs a test opening a file of the previous version.
export const MIGRATIONS: Migration[] = [
  // v1 -> v2: front/back matter entries may carry a `kind`. Existing entries keep no kind; nothing else changes.
  { from: 1, up: (raw) => ({ ...raw }) },
  // v2 -> v3: adds `cover` (null when absent). Nothing else changes.
  { from: 2, up: (raw) => ({ ...raw, cover: null }) },
  // v3 -> v4: top-level edition metadata moves into `editions`; entries get titles and files maps. No file moves.
  { from: 3, up: migrateV3ToV4 },
  // v4 -> v5: adds `references` (an empty list). Nothing else changes and no file moves.
  { from: 4, up: migrateV4ToV5 },
  // v5 -> v6: editions may carry `publishing`. Nothing changes and no file moves.
  { from: 5, up: migrateV5ToV6 },
  // v6 -> v7: a "contents" page kind with optional `toc` settings. Nothing changes and no file moves.
  { from: 6, up: migrateV6ToV7 },
  // v7 -> v8: a manifest `dropCap` and, on entries, `icon` and (chapters) `dropCap`. Nothing changes and no file moves.
  { from: 7, up: (raw) => ({ ...raw }) },
  // v8 -> v9: front and back matter entries may carry `verticalCenter`. Nothing changes and no file moves.
  { from: 8, up: (raw) => ({ ...raw }) },
  // v9 -> v10: front and back matter entries may carry `startOnNext`. Nothing changes and no file moves.
  { from: 9, up: (raw) => ({ ...raw }) },
];

export interface MigrationResult {
  manifest: Manifest;
  /** True when the file was upgraded; the caller must back up the project before writing it back. */
  migrated: boolean;
  fromVersion: number;
}

export function parseManifest(
  json: string,
  migrations: Migration[] = MIGRATIONS,
  target = CURRENT_FORMAT_VERSION,
): MigrationResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    throw new FormatError(`manifest: invalid JSON (${errMsg(e)})`);
  }
  let obj = (raw ?? {}) as Record<string, unknown>;
  const fromVersion = obj.formatVersion;
  if (typeof fromVersion !== "number" || !Number.isInteger(fromVersion) || fromVersion < 1)
    throw new FormatError("manifest: missing or invalid formatVersion");
  if (fromVersion > target)
    throw new FormatError(
      `manifest: formatVersion ${fromVersion} is newer than this app supports (${target}); update CadabraCraft`,
    );
  for (let v = fromVersion; v < target; v++) {
    const step = migrations.find((m) => m.from === v);
    if (!step) throw new FormatError(`manifest: no migration from version ${v}`);
    obj = { ...step.up(obj), formatVersion: v + 1 };
  }
  return { manifest: validateManifest(obj, target), migrated: fromVersion < target, fromVersion };
}
