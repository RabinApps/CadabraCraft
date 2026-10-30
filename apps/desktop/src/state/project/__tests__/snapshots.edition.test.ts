import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Manifest } from "@cadabracraft/format";

const { restoreSnapshot, restorePageFromBookSnapshot } = vi.hoisted(() => ({
  restoreSnapshot: vi.fn(async () => ({ hash: "h" })),
  restorePageFromBookSnapshot: vi.fn(async () => ({ hash: "h2" })),
}));
vi.mock("../../../lib/bridge", () => ({
  bridge: { restoreSnapshot, restorePageFromBookSnapshot },
}));

import { createSnapshotActions } from "../snapshots";

const manifest = {
  editions: [
    { language: "en", title: "Book", source: true },
    { language: "fr", title: "Livre" },
  ],
  chapters: [
    {
      id: "c1",
      titles: { en: "One", fr: "Un" },
      files: { en: "manuscript/en/001.json", fr: "manuscript/fr/001.json" },
    },
  ],
  frontMatter: [],
  backMatter: [],
} as unknown as Manifest;

function setup(activeLanguage: string | null) {
  const state = { hashes: {}, recovery: [], currentId: "c1", notice: null as string | null };
  const ctx = {
    set: (p: object) => Object.assign(state, p),
    get: () => state,
    need: () => ({ root: "/p", manifest }),
    entryOf: (m: Manifest, id: string) => m.chapters.find((c) => c.id === id),
    langOf: () => activeLanguage ?? "en",
    reloadCurrent: vi.fn(async () => {}),
    flush: vi.fn(async () => {}),
    load: vi.fn(async () => {}),
  };
  return { state, actions: createSnapshotActions(ctx as never) };
}

describe("restoring a snapshot while a translation is open", () => {
  beforeEach(() => vi.clearAllMocks());
  it("writes the open edition's file, the one History listed the snapshot for", async () => {
    const { actions, state } = setup("fr");
    await actions.restoreSnapshot("c1", "snap-1");
    expect(restoreSnapshot).toHaveBeenCalledWith("/p", "manuscript/fr/001.json", "snap-1");
    expect(state.hashes).toEqual({ "manuscript/fr/001.json": "h" });
  });
  it("writes the source file when the source edition is open", async () => {
    const { actions } = setup(null);
    await actions.restoreSnapshot("c1", "snap-1");
    expect(restoreSnapshot).toHaveBeenCalledWith("/p", "manuscript/en/001.json", "snap-1");
  });
  it("restores one page from a book snapshot into the open edition's file", async () => {
    const { actions } = setup("fr");
    await actions.restorePageFromBook("c1", "book-1");
    expect(restorePageFromBookSnapshot).toHaveBeenCalledWith(
      "/p",
      "book-1",
      "manuscript/fr/001.json",
    );
  });
});
