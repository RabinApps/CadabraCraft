import type { Page } from "@playwright/test";

export interface SeededSnapshot {
  name: string;
  automatic?: boolean;
  pinned?: boolean;
  /** Counts as this many more bytes in the list (a big book). */
  padBytes?: number;
}

/**
 * Puts book snapshots on the fake disk, oldest first (the file stamps count up from 20261001-1000), each holding the
 * book as it is now. Returns their paths in the same order.
 */
export async function seedBookSnapshots(page: Page, specs: SeededSnapshot[]): Promise<string[]> {
  return page.evaluate((list) => {
    const disk = window.__disk;
    const pages = Object.fromEntries(
      Object.keys(disk)
        .filter((k) => /^(manuscript|front-matter|back-matter)\/.+\.json$/.test(k))
        .map((k) => [k, disk[k] as string]),
    );
    const paths = list.map((s, i) => {
      const path = `.cadabra/snapshots/202610${String(i + 1).padStart(2, "0")}-1000.json`;
      disk[path] = JSON.stringify({
        name: s.name,
        automatic: s.automatic === true,
        pinned: s.pinned === true,
        padBytes: s.padBytes ?? 0,
        manifest: disk["cadabra.json"] as string,
        pages,
        assets: [],
      });
      return path;
    });
    sessionStorage.setItem("disk", JSON.stringify(disk));
    return paths;
  }, specs);
}
