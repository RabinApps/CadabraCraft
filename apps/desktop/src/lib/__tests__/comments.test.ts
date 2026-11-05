import { describe, expect, it } from "vitest";
import type { CommentThread } from "@cadabracraft/format";
import type { ChapterDoc } from "@cadabracraft/shared";
import {
  commentAnchors,
  commentQuote,
  newCommentId,
  relativeTime,
  splitThreads,
} from "../comments";

const text = (t: string, id?: string) => ({
  type: "text" as const,
  text: t,
  ...(id ? { marks: [{ type: "comment" as const, attrs: { id } }] } : {}),
});

const doc = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [text("Plain "), text("one", "c-1"), text(" and "), text("two", "c-2"), text(".")],
    },
    { type: "paragraph", content: [text("More one", "c-1")] },
    { type: "paragraph", content: [{ type: "text", text: "None." }] },
  ],
} as unknown as ChapterDoc;

const thread = (id: string, resolved = false): CommentThread => ({
  id,
  author: "Me",
  body: "b",
  created: "2026-01-01T00:00:00.000Z",
  resolved,
  replies: [],
});

describe("commentAnchors", () => {
  it("lists each id once, in reading order", () => {
    expect(commentAnchors(doc)).toEqual(["c-1", "c-2"]);
  });

  it("is empty for a page with no comments, and for no page", () => {
    expect(commentAnchors({ type: "doc", content: [] } as unknown as ChapterDoc)).toEqual([]);
    expect(commentAnchors(null)).toEqual([]);
  });
});

describe("commentQuote", () => {
  it("collects the text under the mark and joins lines", () => {
    expect(commentQuote(doc, "c-1")).toBe("one More one");
  });

  it("is empty when the text is gone", () => {
    expect(commentQuote(doc, "c-9")).toBe("");
    expect(commentQuote(null, "c-1")).toBe("");
  });

  it("trims to the maximum and marks the cut", () => {
    const long = {
      type: "doc",
      content: [{ type: "paragraph", content: [text("abcde", "c-1")] }],
    } as unknown as ChapterDoc;
    expect(commentQuote(long, "c-1", 4)).toBe("abc\u2026");
  });
});

describe("splitThreads", () => {
  it("keeps threads whose text is gone, as detached", () => {
    expect(splitThreads([thread("c-1"), thread("c-9")], ["c-1"])).toEqual({
      attached: [thread("c-1")],
      detached: [thread("c-9")],
    });
  });
});

describe("newCommentId", () => {
  it("follows the format's id rule and differs between calls", () => {
    const a = newCommentId();
    const b = newCommentId();
    expect(a).toMatch(/^c-[a-z0-9]{1,62}$/);
    expect(a).not.toBe(b);
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-01-08T12:00:00.000Z");
  const at = (iso: string) => relativeTime(iso, now, "en");

  it("reads seconds, minutes, hours and days", () => {
    expect(at("2026-01-08T11:59:30.000Z")).toBe("30 seconds ago");
    expect(at("2026-01-08T11:58:00.000Z")).toBe("2 minutes ago");
    expect(at("2026-01-08T09:00:00.000Z")).toBe("3 hours ago");
    expect(at("2026-01-07T12:00:00.000Z")).toBe("yesterday");
  });

  it("shows a date after a week, and nothing for a stamp it cannot read", () => {
    expect(at("2025-12-01T12:00:00.000Z")).toContain("2025");
    expect(relativeTime("not a date", now)).toBe("");
  });
});

describe("comment anchors in odd documents", () => {
  const doc = (content: unknown[]) => ({ type: "doc", content }) as unknown as ChapterDoc;
  it("reads no ids from a missing document, and skips other marks, id-less marks and repeats", () => {
    expect(commentAnchors(null)).toEqual([]);
    const text = (marks: unknown[]) => ({ type: "text", text: "x", marks });
    expect(
      commentAnchors(
        doc([
          {
            type: "paragraph",
            content: [
              text([{ type: "bold" }, { type: "comment" }, { type: "comment", attrs: { id: 3 } }]),
              text([{ type: "comment", attrs: { id: "c-1" } }]),
              text([{ type: "comment", attrs: { id: "c-1" } }]),
              { type: "text", text: "plain" },
            ],
          },
          { type: "horizontalRule" },
        ]),
      ),
    ).toEqual(["c-1"]);
  });
  it("quotes nothing from a missing document", () => {
    expect(commentQuote(null, "c-1")).toBe("");
  });
});
