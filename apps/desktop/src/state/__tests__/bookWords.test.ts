import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearBookWords, refreshBookWords, useBookWords } from "../bookWords";
import type { EntryWords } from "../../lib/page/pageNumbering";

const entry = (id: string, words: number): EntryWords => ({
  id,
  section: "chapter",
  words,
});

/** Lets the microtask `refreshBookWords` queues run, and the promise it waits on settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  useBookWords.setState({ words: null });
});

describe("the book's words", () => {
  it("holds the words a count returned", async () => {
    const words = [entry("ch-1", 10), entry("ch-2", 20)];
    refreshBookWords(() => Promise.resolve(words));
    await settle();
    expect(useBookWords.getState().words).toEqual(words);
  });

  it("shares one count between asks in the same tick", async () => {
    const load = vi.fn(() => Promise.resolve([entry("ch-1", 10)]));
    refreshBookWords(load);
    refreshBookWords(load);
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("drops an answer a later ask overtook, so the newest words win", async () => {
    let first: (w: EntryWords[]) => void = () => undefined;
    refreshBookWords(
      () =>
        new Promise<EntryWords[]>((r) => {
          first = r;
        }),
    );
    await settle();
    refreshBookWords(() => Promise.resolve([entry("ch-2", 20)]));
    await settle();
    first([entry("ch-1", 10)]);
    await settle();
    expect(useBookWords.getState().words).toEqual([entry("ch-2", 20)]);
  });

  it("keeps the last words when the count fails", async () => {
    refreshBookWords(() => Promise.resolve([entry("ch-1", 10)]));
    await settle();
    refreshBookWords(() => Promise.reject(new Error("no project")));
    await settle();
    expect(useBookWords.getState().words).toEqual([entry("ch-1", 10)]);
  });

  it("forgets the words when the book closes, and a count asked before that does not bring them back", async () => {
    let answer: (w: EntryWords[]) => void = () => undefined;
    refreshBookWords(
      () =>
        new Promise<EntryWords[]>((r) => {
          answer = r;
        }),
    );
    await settle();
    clearBookWords();
    answer([entry("ch-1", 10)]);
    await settle();
    expect(useBookWords.getState().words).toBeNull();
  });
});
