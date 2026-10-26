import { CURRENT_FORMAT_VERSION, FormatError, validateManifest, type Manifest } from "./manifest";
import { errMsg } from "@cadabracraft/shared";

/** A migration upgrades a raw manifest object from `from` to `from + 1`. */
export type Migration = { from: number; up: (raw: Record<string, unknown>) => Record<string, unknown> };

// Add entries here when formatVersion is bumped; each needs a test opening a file of the previous version.
export const MIGRATIONS: Migration[] = [
  // v1 -> v2: front/back matter entries may carry a `kind`. Existing entries keep no kind; nothing else changes.
  { from: 1, up: (raw) => ({ ...raw }) },
];

export interface MigrationResult {
  manifest: Manifest;
  /** True when the file was upgraded; the caller must back up the project before writing it back. */
  migrated: boolean;
  fromVersion: number;
}

export function parseManifest(json: string, migrations: Migration[] = MIGRATIONS, target = CURRENT_FORMAT_VERSION): MigrationResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    throw new FormatError(`manifest: invalid JSON (${errMsg(e)})`);
  }
  let obj = (raw ?? {}) as Record<string, unknown>;
  const fromVersion = obj.formatVersion;
  if (typeof fromVersion !== "number" || !Number.isInteger(fromVersion) || fromVersion < 1) throw new FormatError("manifest: missing or invalid formatVersion");
  if (fromVersion > target) throw new FormatError(`manifest: formatVersion ${fromVersion} is newer than this app supports (${target}); update CadabraCraft`);
  for (let v = fromVersion; v < target; v++) {
    const step = migrations.find((m) => m.from === v);
    if (!step) throw new FormatError(`manifest: no migration from version ${v}`);
    obj = { ...step.up(obj), formatVersion: v + 1 };
  }
  return { manifest: validateManifest(obj, target), migrated: fromVersion < target, fromVersion };
}
