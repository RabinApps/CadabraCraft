import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { disk, writeFileWithConflictCopy } from "../../../test/fakeBridge";

vi.mock("../../../lib/bridge", async () =>
  (await import("../../../test/fakeBridge")).fakeBridge({ writeFile: writeFileWithConflictCopy }),
);

import { useProject } from "../index";
import { SAVED_NOTICE_MS, alertOf } from "../util";

const a = () => useProject.getState().actions;
const s = () => useProject.getState();
const text = (t: string) => ({
  type: "doc" as const,
  content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: t }] }],
});
const FILE = "manuscript/001-chapter-one.json";

beforeEach(async () => {
  vi.useFakeTimers();
  disk.clear();
  useProject.setState({
    root: null,
    manifest: null,
    currentId: null,
    currentDoc: null,
    draft: null,
    hashes: {},
    notice: "",
    alertNotice: "",
    reloadCount: 0,
  });
  await a().createProject("/p", "Book", "Me");
  useProject.setState({ notice: "" });
});
afterEach(() => vi.useRealTimers());

describe("the Saved notice", () => {
  it("shows after a save and fades after two seconds", async () => {
    await a().saveCurrent(text("one"));
    expect(s().notice).toBe("Saved");
    vi.advanceTimersByTime(SAVED_NOTICE_MS - 1);
    expect(s().notice).toBe("Saved");
    vi.advanceTimersByTime(1);
    expect(s().notice).toBe("");
  });

  it("restarts the wait on every save", async () => {
    await a().saveCurrent(text("one"));
    vi.advanceTimersByTime(SAVED_NOTICE_MS - 500);
    await a().saveCurrent(text("two"));
    vi.advanceTimersByTime(SAVED_NOTICE_MS - 500);
    expect(s().notice).toBe("Saved");
    vi.advanceTimersByTime(500);
    expect(s().notice).toBe("");
  });

  it("never hides another notice that arrived meanwhile", async () => {
    await a().saveCurrent(text("one"));
    useProject.setState(alertOf("Could not save: disk full"));
    vi.advanceTimersByTime(SAVED_NOTICE_MS * 3);
    expect(s().notice).toBe("Could not save: disk full");
  });

  it("is not shown over a notice that is already there", async () => {
    useProject.setState({ notice: "Exported exports/en/book.epub" });
    await a().saveCurrent(text("one"));
    expect(s().notice).toBe("Exported exports/en/book.epub");
    vi.advanceTimersByTime(SAVED_NOTICE_MS * 3);
    expect(s().notice).toBe("Exported exports/en/book.epub");
  });

  it("leaves a dismissed notice dismissed", async () => {
    await a().saveCurrent(text("one"));
    useProject.setState({ notice: "" });
    vi.advanceTimersByTime(SAVED_NOTICE_MS);
    expect(s().notice).toBe("");
  });
});

describe("a conflict-copy notice", () => {
  it("stays until it is dismissed and a later save does not replace it", async () => {
    disk.set(FILE, "edited by sync");
    await a().saveCurrent(text("mine"));
    const conflict = s().notice;
    expect(conflict).toMatch(/kept as/);
    vi.advanceTimersByTime(SAVED_NOTICE_MS * 5);
    expect(s().notice).toBe(conflict);
    await a().saveCurrent(text("mine again"));
    expect(s().notice).toBe(conflict);
    vi.advanceTimersByTime(SAVED_NOTICE_MS * 5);
    expect(s().notice).toBe(conflict);
    useProject.setState({ notice: "" });
    await a().saveCurrent(text("after dismissing"));
    expect(s().notice).toBe("Saved");
  });

  it("replaces a Saved notice that is still showing, and the fade leaves it alone", async () => {
    await a().saveCurrent(text("one"));
    disk.set(FILE, "edited by sync");
    await a().saveCurrent(text("two"));
    const conflict = s().notice;
    expect(conflict).toMatch(/kept as/);
    vi.advanceTimersByTime(SAVED_NOTICE_MS * 5);
    expect(s().notice).toBe(conflict);
  });

  it("from the manifest write also stays and is not replaced by Saved", async () => {
    disk.set("cadabra.json", "edited by sync");
    await a().rename("ch-1", "Renamed");
    const conflict = s().notice;
    expect(conflict).toMatch(/cadabra\.json changed outside the app/);
    await a().saveCurrent(text("later"));
    vi.advanceTimersByTime(SAVED_NOTICE_MS * 5);
    expect(s().notice).toBe(conflict);
  });
});
