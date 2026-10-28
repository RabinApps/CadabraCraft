import { describe, expect, it, vi } from "vitest";

vi.mock("@cadabracraft/import-docx", () => ({
  looksLikeHtml: () => {
    throw new Error("pathological input");
  },
  htmlToBlocks: () => [],
}));

import { safeLooksLikeHtml } from "../htmlPaste";

describe("safeLooksLikeHtml", () => {
  it("treats text the converter throws on as not HTML", () => {
    expect(safeLooksLikeHtml("<p>hi</p>")).toBe(false);
  });
});
