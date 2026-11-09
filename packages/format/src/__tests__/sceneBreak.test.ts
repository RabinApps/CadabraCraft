import { describe, expect, it } from "vitest";
import { FormatError, createManifest, parseManifest, serializeManifest } from "../index";

const base = () =>
  createManifest({
    title: "Book",
    author: "Author",
    identifier: "urn:uuid:00000000-0000-4000-8000-000000000000",
  });

describe("manifest sceneBreak", () => {
  it("is absent by default and round-trips a listed ornament", () => {
    expect(base().sceneBreak).toBeUndefined();
    const m = { ...base(), sceneBreak: "asterism" as const };
    expect(parseManifest(serializeManifest(m)).manifest.sceneBreak).toBe("asterism");
    expect(parseManifest(serializeManifest(base())).manifest.sceneBreak).toBeUndefined();
  });

  it("refuses an id the library does not list", () => {
    const raw = JSON.parse(serializeManifest(base())) as Record<string, unknown>;
    raw.sceneBreak = "rule";
    expect(() => parseManifest(JSON.stringify(raw))).toThrow(FormatError);
    expect(() => parseManifest(JSON.stringify(raw))).toThrow('unknown sceneBreak "rule"');
  });
});
