import { expect, it } from "vitest";
import { contentHash } from "../hash";

it("is stable, 16 hex characters, and changes with any part", () => {
  const h = contentHash("voice", "1", "text");
  expect(h).toMatch(/^[0-9a-f]{16}$/);
  expect(contentHash("voice", "1", "text")).toBe(h);
  expect(contentHash("voice", "1.1", "text")).not.toBe(h);
  expect(contentHash("voice", "1", "text!")).not.toBe(h);
  expect(contentHash("ab", "c")).not.toBe(contentHash("a", "bc"));
});
