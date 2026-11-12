import { beforeEach, describe, expect, it, vi } from "vitest";

const audioVoices = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/bridge", () => ({ bridge: { audioVoices } }));

import { chooseReadingVoice } from "../voice";

const voice = (id: string, languages: string[], installed = true) => ({ id, languages, installed });
beforeEach(() =>
  audioVoices.mockResolvedValue([
    voice("fr-a", ["fr"]),
    voice("en-a", ["en"]),
    voice("en-b", ["en"]),
    voice("en-c", ["en"], false),
  ]),
);

describe("chooseReadingVoice", () => {
  it("takes the preferred voice when it reads the language", async () => {
    expect(await chooseReadingVoice("en-US", "en-b")).toBe("en-b");
  });
  it("falls back to the best installed voice", async () => {
    expect(await chooseReadingVoice("en", "fr-a")).toBe("en-a");
    expect(await chooseReadingVoice("en", "en-c")).toBe("en-a");
  });
  it("is empty when no installed voice reads the language", async () => {
    expect(await chooseReadingVoice("de", "")).toBe("");
  });
});
