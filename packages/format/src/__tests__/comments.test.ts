import { describe, expect, it } from "vitest";
import {
  MAX_COMMENT_AUTHOR,
  MAX_COMMENT_BODY,
  MAX_COMMENT_REPLIES,
  MAX_COMMENT_THREADS,
  assertCommentsFile,
  commentsProblem,
  emptyComments,
  isCommentsFile,
} from "../comments";

const reply = (over: Record<string, unknown> = {}) => ({
  author: "Sam",
  body: "Agreed.",
  created: "2026-11-04T09:00:00.000Z",
  ...over,
});
const thread = (over: Record<string, unknown> = {}) => ({
  id: "t-1",
  author: "Alex",
  body: "Is this the right storm?",
  created: "2026-11-04T08:00:00.000Z",
  resolved: false,
  replies: [],
  ...over,
});

describe("commentsProblem", () => {
  it("accepts an empty file and a thread with a reply", () => {
    expect(commentsProblem({ threads: [] })).toBeNull();
    expect(commentsProblem({ threads: [thread({ replies: [reply()] })] })).toBeNull();
    expect(isCommentsFile({ threads: [thread()] })).toBe(true);
  });

  it("refuses anything that is not an object with a threads array", () => {
    for (const bad of [null, undefined, 1, "x", [], true])
      expect(commentsProblem(bad)).toMatch(/must be an object with a threads array/);
    expect(commentsProblem({})).toMatch(/threads array/);
    expect(commentsProblem({ threads: {} })).toMatch(/threads array/);
    expect(commentsProblem({ threads: [], extra: 1 })).toMatch(/unknown key "extra"/);
  });

  it("refuses too many threads on one page", () => {
    const many = Array.from({ length: MAX_COMMENT_THREADS + 1 }, (_, i) =>
      thread({ id: `t-${i}` }),
    );
    expect(commentsProblem({ threads: many })).toMatch(/the most it may hold is/);
  });

  it("refuses a thread that is not an object", () => {
    for (const bad of [null, 1, "x", []])
      expect(commentsProblem({ threads: [bad] })).toMatch(/thread 1 must be an object/);
  });

  it("refuses an unknown key on a thread", () => {
    expect(commentsProblem({ threads: [thread({ colour: "red" })] })).toMatch(
      /thread 1 has an unknown key "colour"/,
    );
  });

  it("refuses a bad thread id", () => {
    for (const bad of ["", "1t", "a b", undefined])
      expect(commentsProblem({ threads: [thread({ id: bad })] })).toMatch(/needs an id/);
  });

  it("refuses a missing, blank, multi-line or over-long author", () => {
    for (const bad of [undefined, 7, "   ", "a\nb", "a\tb", "a".repeat(MAX_COMMENT_AUTHOR + 1)])
      expect(commentsProblem({ threads: [thread({ author: bad })] })).toMatch(/needs an author/);
    expect(
      commentsProblem({ threads: [thread({ author: "a".repeat(MAX_COMMENT_AUTHOR) })] }),
    ).toBeNull();
  });

  it("refuses a missing, blank, over-long body or one with a control character", () => {
    for (const bad of [undefined, 7, "   ", "a".repeat(MAX_COMMENT_BODY + 1), "a\u0000b"])
      expect(commentsProblem({ threads: [thread({ body: bad })] })).toMatch(/needs a body/);
  });

  it("keeps line breaks and tabs in a body", () => {
    expect(commentsProblem({ threads: [thread({ body: "one\ntwo\tthree\r\nfour" })] })).toBeNull();
  });

  it("refuses a missing or unparseable date", () => {
    for (const bad of [undefined, 7, "", "not a date"])
      expect(commentsProblem({ threads: [thread({ created: bad })] })).toMatch(
        /needs a created date/,
      );
  });

  it("refuses a resolved that is not true or false, and missing replies", () => {
    expect(commentsProblem({ threads: [thread({ resolved: "no" })] })).toMatch(
      /resolved to be true or false/,
    );
    expect(commentsProblem({ threads: [thread({ resolved: undefined })] })).toMatch(
      /resolved to be true or false/,
    );
    expect(commentsProblem({ threads: [thread({ replies: undefined })] })).toMatch(/needs replies/);
  });

  it("refuses too many replies on one thread", () => {
    const many = Array.from({ length: MAX_COMMENT_REPLIES + 1 }, () => reply());
    expect(commentsProblem({ threads: [thread({ replies: many })] })).toMatch(
      /the most one thread/,
    );
  });

  it("refuses a reply that is malformed, with an unknown key or a bad field", () => {
    for (const bad of [null, 1, "x", []])
      expect(commentsProblem({ threads: [thread({ replies: [bad] })] })).toMatch(
        /reply 1 must be an object/,
      );
    expect(commentsProblem({ threads: [thread({ replies: [reply({ mood: 1 })] })] })).toMatch(
      /reply 1 has an unknown key "mood"/,
    );
    expect(commentsProblem({ threads: [thread({ replies: [reply({ author: "" })] })] })).toMatch(
      /reply 1 needs an author/,
    );
    expect(commentsProblem({ threads: [thread({ replies: [reply({ body: " " })] })] })).toMatch(
      /reply 1 needs a body/,
    );
    expect(commentsProblem({ threads: [thread({ replies: [reply({ created: "x" })] })] })).toMatch(
      /reply 1 needs a created/,
    );
  });

  it("refuses a repeated thread id", () => {
    expect(commentsProblem({ threads: [thread(), thread({ body: "again" })] })).toMatch(
      /thread 2 repeats the id "t-1"/,
    );
  });
});

describe("emptyComments and assertCommentsFile", () => {
  it("starts a page with no threads", () => {
    expect(emptyComments()).toEqual({ threads: [] });
    expect(isCommentsFile(emptyComments())).toBe(true);
  });
  it("throws with the problem, and passes a valid file", () => {
    expect(() => assertCommentsFile({ threads: [thread()] })).not.toThrow();
    expect(() => assertCommentsFile({ threads: [{ id: "t-1" }] })).toThrow(
      /invalid comments file: thread 1 needs an author/,
    );
  });
});
