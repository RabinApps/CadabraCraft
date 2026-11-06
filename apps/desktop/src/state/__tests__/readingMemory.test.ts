import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProject } from "../project/index";
import {
  MAX_BOOKS,
  flushReadingPosition,
  parseSaved,
  rememberReadingPosition,
  resetReadingMemory,
  savedPosition,
  takeSavedPosition,
  withPosition,
} from "../readingMemory";
import { goToReadMatch, setReadMatch, useReadFind } from "../readFind";

const KEY = "cadabracraft.readingPositions";
let data: Map<string, string>;
beforeEach(() => {
  vi.useFakeTimers();
  data = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  });
  resetReadingMemory();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("parseSaved", () => {
  it("keeps good entries, clamps the fraction and drops malformed ones", () => {
    const out = parseSaved({
      "/a": { id: "c1", fraction: 2, at: 5 },
      "/b": { id: "", fraction: 0.5, at: 5 },
      "/c": { id: "c1", fraction: "x", at: 5 },
      "/d": null,
    });
    expect(out).toEqual({ "/a": { id: "c1", fraction: 1, at: 5 } });
    expect(parseSaved(null)).toEqual({});
    expect(parseSaved([1])).toEqual({});
    expect(parseSaved("x")).toEqual({});
  });
  it("forgets the least recently read books beyond the cap", () => {
    let saved = {};
    for (let i = 0; i < MAX_BOOKS + 5; i++)
      saved = withPosition(saved, `/book${i}`, { id: "c", fraction: 0.1, at: i });
    const keys = Object.keys(saved);
    expect(keys).toHaveLength(MAX_BOOKS);
    expect(keys).not.toContain("/book0");
    expect(keys).toContain(`/book${MAX_BOOKS + 4}`);
  });
});

describe("remembering where a book was read", () => {
  it("writes once the scrolling pauses, keyed by the book, and reads it back", () => {
    rememberReadingPosition("/books/one", "c2", 0.25);
    rememberReadingPosition("/books/one", "c3", 0.5);
    expect(data.has(KEY)).toBe(false);
    vi.advanceTimersByTime(500);
    const stored = JSON.parse(data.get(KEY)!);
    expect(stored["/books/one"]).toMatchObject({ id: "c3", fraction: 0.5 });
    expect(savedPosition("/books/one")).toMatchObject({ id: "c3", fraction: 0.5 });
    expect(savedPosition("/books/two")).toBeNull();
  });
  it("flushes at once on request and has nothing to do when nothing waits", () => {
    flushReadingPosition();
    expect(data.has(KEY)).toBe(false);
    rememberReadingPosition("/books/one", "c1", 0);
    flushReadingPosition();
    expect(data.has(KEY)).toBe(true);
  });
  it("never throws when storage is blocked", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    resetReadingMemory();
    rememberReadingPosition("/b", "c1", 0.3);
    expect(() => flushReadingPosition()).not.toThrow();
    expect(savedPosition("/b")).toMatchObject({ id: "c1" });
  });
});

describe("resuming", () => {
  const open = (root: string, currentId: string) =>
    useProject.setState({ root, currentId } as never);
  it("resumes once per book per session, only while the chapter is the one the book opened with", () => {
    data.set(KEY, JSON.stringify({ "/b": { id: "c3", fraction: 0.4, at: 1 } }));
    open("/b", "c1");
    expect(takeSavedPosition("/b", "c2", ["c1", "c2", "c3"])).toBeNull(); // moved on in Write
    expect(takeSavedPosition("/b", "c1", ["c1", "c2", "c3"])).toBeNull(); // already used
    resetReadingMemory();
    open("/b", "c1");
    expect(takeSavedPosition("/b", "c1", ["c1", "c2", "c3"])).toMatchObject({
      id: "c3",
      fraction: 0.4,
    });
    expect(takeSavedPosition("/b", "c1", ["c1", "c2", "c3"])).toBeNull();
  });
  it("does not resume at a chapter that is gone, in a book never read, or with no book", () => {
    data.set(KEY, JSON.stringify({ "/b": { id: "gone", fraction: 0.4, at: 1 } }));
    open("/b", "c1");
    expect(takeSavedPosition("/b", "c1", ["c1"])).toBeNull();
    open("/other", "x1");
    expect(takeSavedPosition("/other", "x1", ["x1"])).toBeNull();
    expect(takeSavedPosition(null, null, [])).toBeNull();
  });
});

describe("current match of Find in Read mode", () => {
  it("scrolls on goTo and not on set", () => {
    useReadFind.setState({ index: -1, tick: 0 });
    goToReadMatch(3);
    expect(useReadFind.getState()).toEqual({ index: 3, tick: 1 });
    setReadMatch(-1);
    expect(useReadFind.getState()).toEqual({ index: -1, tick: 1 });
  });
});
