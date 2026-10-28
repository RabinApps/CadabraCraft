import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { disk, hashOf as h } from "../../../test/fakeBridge";

// Writes can be held back to test overlapping saves.
const writes: { path: string; contents: string }[] = [];
let hold: Promise<void> | null = null;
vi.mock("../../../lib/bridge", async () =>
  (await import("../../../test/fakeBridge")).fakeBridge({
    writeFile: async (_r: string, p: string, c: string) => {
      writes.push({ path: p, contents: c });
      if (hold && p.startsWith("manuscript/")) await hold;
      disk.set(p, c);
      return { hash: h(c), conflict_copy: null };
    },
  }),
);

import { AUTOSAVE_MS, useProject } from "../index";

const a = () => useProject.getState().actions;
const s = () => useProject.getState();
const doc = (t: string) => ({
  type: "doc" as const,
  content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: t }] }],
});
const FILE = "manuscript/001-chapter-one.json";

beforeEach(async () => {
  disk.clear();
  writes.length = 0;
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
  });
  await a().createProject("/p", "Book", "Me");
  writes.length = 0;
});
afterEach(() => vi.useRealTimers());

describe("setDraft and flush", () => {
  it("setDraft only records the draft; flush writes it and clears it", async () => {
    a().setDraft(doc("hello"));
    expect(s().draft).toEqual(doc("hello"));
    expect(disk.get(FILE)).not.toContain("hello");
    await a().flush();
    expect(disk.get(FILE)).toContain("hello");
    expect(s().draft).toBeNull();
    expect(s().currentDoc).toEqual(doc("hello"));
  });
  it("flush with nothing typed writes nothing", async () => {
    await a().flush();
    expect(writes).toEqual([]);
  });
  it("keeps typing that arrives while a save is running", async () => {
    let release!: () => void;
    hold = new Promise((r) => {
      release = r;
    });
    a().setDraft(doc("first"));
    const saving = a().flush();
    a().setDraft(doc("second"));
    release();
    await saving;
    expect(s().draft).toEqual(doc("second"));
    hold = null;
    await a().flush();
    expect(disk.get(FILE)).toContain("second");
    expect(s().draft).toBeNull();
  });
  it("runs overlapping flushes one after another", async () => {
    let release!: () => void;
    hold = new Promise((r) => {
      release = r;
    });
    a().setDraft(doc("one"));
    const first = a().flush();
    const second = a().flush();
    release();
    await Promise.all([first, second]);
    expect(writes.filter((w) => w.path === FILE)).toHaveLength(1);
  });
});

describe("autosave", () => {
  it("saves after the debounce, restarting it on every keystroke", async () => {
    vi.useFakeTimers();
    a().setDraft(doc("a"));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS - 100);
    a().setDraft(doc("ab"));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS - 100);
    expect(writes).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    expect(writes.map((w) => w.path)).toEqual([FILE]);
    expect(disk.get(FILE)).toContain('"ab"');
    expect(s().draft).toBeNull();
  });
  it("reports a failed autosave in the notice and keeps the draft", async () => {
    vi.useFakeTimers();
    const { bridge } = await import("../../../lib/bridge");
    const original = bridge.writeFile;
    (bridge as { writeFile: unknown }).writeFile = async () => {
      throw { kind: "io", message: "disk full" };
    };
    try {
      a().setDraft(doc("keep me"));
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS + 10);
      expect(s().draft).toEqual(doc("keep me"));
      expect(s().notice).toContain("disk full");
    } finally {
      (bridge as { writeFile: unknown }).writeFile = original;
    }
  });
});

describe("corrupt chapter files", () => {
  const corrupt = async (contents: string) => {
    disk.set(FILE, contents);
    await a().openProject("/p");
  };
  it("does not open an unparsable chapter, tells the author and never writes to it", async () => {
    await corrupt("{ not json");
    expect(s().currentDoc).toBeNull();
    expect(s().notice).toContain("001-chapter-one.json");
    await a().flush();
    expect(disk.get(FILE)).toBe("{ not json");
    expect(writes.some((w) => w.path === FILE)).toBe(false);
  });
  it("does not open JSON that is not a chapter document", async () => {
    const bad = JSON.stringify({ type: "doc", content: [{ type: "mystery" }] });
    await corrupt(bad);
    expect(s().currentDoc).toBeNull();
    expect(disk.get(FILE)).toBe(bad);
  });
  it("refuses to export (readPages) a corrupt chapter", async () => {
    await a().openProject("/p");
    disk.set(FILE, "[]");
    await expect(a().readPages()).rejects.toThrow(/001-chapter-one\.json/);
  });
});

describe("externalChange", () => {
  const external = (t: string) => {
    const c = JSON.stringify(doc(t));
    disk.set(FILE, c);
    return c;
  };
  it("reloads the open chapter from disk when there is no draft", async () => {
    external("from outside");
    await a().externalChange(FILE);
    expect(s().currentDoc).toEqual(doc("from outside"));
    expect(s().reloadCount).toBe(1);
  });
  it("keeps the draft and warns when the file changes under unsaved typing", async () => {
    a().setDraft(doc("mine"));
    external("theirs");
    await a().externalChange(FILE);
    expect(s().draft).toEqual(doc("mine"));
    expect(s().reloadCount).toBe(0);
    expect(s().notice).toContain("changed outside the app");
  });
  it("ignores its own writes", async () => {
    a().setDraft(doc("mine"));
    await a().flush();
    await a().externalChange(FILE);
    expect(s().reloadCount).toBe(0);
  });
  it("keeps the open chapter when the new file on disk is corrupt", async () => {
    const before = s().currentDoc;
    disk.set(FILE, "garbage");
    await a().externalChange(FILE);
    expect(s().currentDoc).toBe(before);
    expect(s().reloadCount).toBe(0);
    expect(s().notice).toContain("001-chapter-one.json");
  });
});
