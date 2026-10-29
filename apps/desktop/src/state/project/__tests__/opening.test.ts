import { beforeEach, describe, expect, it, vi } from "vitest";
import { disk, readFile } from "../../../test/fakeBridge";

// The manifest read can be held back to look at the state while a book is opening.
const hold: { gate: Promise<void> | null } = { gate: null };
vi.mock("../../../lib/bridge", async () =>
  (await import("../../../test/fakeBridge")).fakeBridge({
    readFile: async (r: string, p: string) => {
      const out = await readFile(r, p);
      await hold.gate;
      return out;
    },
  }),
);

import { useProject } from "../index";
import { useRecents } from "../../recents";

const a = () => useProject.getState().actions;
const s = () => useProject.getState();
const MANIFEST = "cadabra.json";

beforeEach(async () => {
  disk.clear();
  hold.gate = null;
  useRecents.setState({ recents: [] });
  await a().closeProject();
  // A book on the fake disk, then closed again, so each test starts from Home.
  await a().createProject("/seed", "Seed Book", "Me");
  await a().closeProject();
});

describe("pending open", () => {
  it("is set from the start of an open until the book is ready, named after the folder", async () => {
    let release = () => {};
    hold.gate = new Promise((r) => (release = r));
    const open = a().openProject("/books/The Folder");
    expect(s().opening).toEqual({ root: "/books/The Folder", name: "The Folder" });
    expect(s().manifest).toBeNull();
    release();
    await open;
    expect(s().opening).toBeNull();
    expect(s().manifest).not.toBeNull();
    expect(s().currentDoc).not.toBeNull();
  });

  it("uses the title from the recent list when there is one", async () => {
    useRecents.setState({ recents: [{ root: "/r", title: "Recent Title", openedAt: 1 }] });
    let release = () => {};
    hold.gate = new Promise((r) => (release = r));
    const open = a().openProject("/r");
    expect(s().opening?.name).toBe("Recent Title");
    release();
    await open;
  });

  it("is cleared when the open fails, and the error still reaches the caller", async () => {
    disk.delete(MANIFEST);
    const open = a().openProject("/missing");
    expect(s().opening?.root).toBe("/missing");
    await expect(open).rejects.toThrow();
    expect(s().opening).toBeNull();
    expect(s().manifest).toBeNull();
  });

  it("a second open of the same book joins the first and leaves nothing behind", async () => {
    await Promise.all([a().openProject("/x"), a().openProject("/x")]);
    expect(s().opening).toBeNull();
  });

  it("is not shown while creating a book (its dialog stays up)", async () => {
    const seen: unknown[] = [];
    const un = useProject.subscribe((st) => seen.push(st.opening));
    await a().createProject("/new", "New", "Me");
    un();
    expect(seen.every((o) => o === null)).toBe(true);
    expect(s().opening).toBeNull();
  });
});
