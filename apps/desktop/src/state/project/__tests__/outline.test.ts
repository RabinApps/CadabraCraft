import { beforeEach, describe, expect, it, vi } from "vitest";
import { disk } from "../../../test/fakeBridge";

let writeBytesError: Error | null = null;
let hold: Promise<void> | null = null;
vi.mock("../../../lib/bridge", async () =>
  (await import("../../../test/fakeBridge")).fakeBridge({
    writeBytes: async (_r: string, p: string, b: Uint8Array) => {
      await hold;
      if (writeBytesError) throw writeBytesError;
      disk.set(p, new TextDecoder().decode(b));
    },
  }),
);

import { useProject } from "../index";

const a = () => useProject.getState().actions;
const s = () => useProject.getState();
const scene = {
  type: "scene",
  attrs: {
    id: "sc-1",
    title: "Storm",
    synopsis: "Ana runs.",
    pov: "Ana",
    status: "draft",
    label: "",
    target: 100,
    cast: ["ana"],
  },
  content: [{ type: "paragraph", content: [{ type: "text", text: "one two three" }] }],
};

beforeEach(async () => {
  disk.clear();
  writeBytesError = null;
  hold = null;
  useProject.setState({
    root: null,
    manifest: null,
    currentId: null,
    currentDoc: null,
    draft: null,
    hashes: {},
    notice: "",
    reloadCount: 0,
    exportStage: null,
  });
  await a().createProject("/p", "Book", "Me");
  await a().saveCurrent({ type: "doc", content: [scene as never] });
});

describe("exportOutline", () => {
  it("writes outline.opml with the scene, its notes and the codex name, and no text", async () => {
    disk.set(
      "codex.json",
      JSON.stringify({
        entries: [
          {
            id: "ana",
            kind: "character",
            name: "Ana",
            aliases: [],
            summary: "",
            body: "",
            image: null,
            links: [],
          },
        ],
      }),
    );
    await a().exportOutline({ format: "opml" });
    const opml = disk.get("exports/en/outline.opml")!;
    expect(opml).toContain('text="Storm"');
    expect(opml).toContain('_note="Ana runs."');
    expect(opml).toContain('cc:castNames="Ana"');
    expect(opml).not.toContain("one two three");
    expect(s().notice).toBe("Exported exports/en/outline.opml");
    expect(s().exportStage).toBeNull();
  });
  it("writes Markdown and CSV, with the cast id when there is no codex", async () => {
    await a().exportOutline({ format: "markdown" });
    expect(disk.get("exports/en/outline.md")).toContain("cast: ana");
    await a().exportOutline({ format: "csv" });
    expect(disk.get("exports/en/outline.csv")).toContain("sc-1,Storm,Ana runs.,Ana,draft,,100,3");
  });
  it("leaves the ids in place when the codex is broken or the wrong shape", async () => {
    disk.set("codex.json", "{not json");
    await a().exportOutline({ format: "markdown" });
    expect(disk.get("exports/en/outline.md")).toContain("cast: ana");
    disk.set("codex.json", JSON.stringify({ entries: 3 }));
    await a().exportOutline({ format: "markdown" });
    expect(disk.get("exports/en/outline.md")).toContain("cast: ana");
  });
  it("mentions untranslated pages that were left out", async () => {
    await a().add("Two");
    await a().addLanguage("fr", "copy");
    await a().selectChapter(s().manifest!.chapters[0]!.id);
    a().setDraft({ type: "doc", content: [scene as never] });
    await a().saveCurrent(s().draft!);
    await a().exportOutline({ format: "opml", language: "fr", skipUntranslated: true });
    expect(disk.has("exports/fr/outline.opml")).toBe(true);
    expect(s().notice).toContain("exports/fr/outline.opml");
    expect(s().exportStage).toBeNull();
  });
  it("refuses a book with no chapters and a second export while one runs", async () => {
    const m = s().manifest!;
    useProject.setState({ manifest: { ...m, chapters: [] } });
    await expect(a().exportOutline({ format: "opml" })).rejects.toThrow(/no chapters/);
    expect(s().exportStage).toBeNull();
    useProject.setState({ manifest: m });
    let release = () => {};
    hold = new Promise<void>((r) => (release = r));
    const first = a().exportOutline({ format: "opml" });
    await expect(a().exportOutline({ format: "csv" })).rejects.toThrow(/already running/);
    release();
    await first;
  });
  it("clears the stage when the write fails", async () => {
    writeBytesError = new Error("disk full");
    await expect(a().exportOutline({ format: "opml" })).rejects.toThrow("disk full");
    expect(s().exportStage).toBeNull();
  });
});
