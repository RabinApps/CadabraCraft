import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureFontLoaded,
  faceDescriptor,
  forgetLoadedFonts,
  toDataUrl,
  type FontEnv,
} from "../loadFont";

vi.mock("../bridge", () => ({ bridge: {} }));

const lora = {
  id: "lora",
  family: "Lora",
  source: "downloaded" as const,
  files: ["Lora[wght].ttf", "Lora-Italic[wght].ttf", "OFL.txt"],
};

function env(over: Partial<FontEnv> = {}) {
  const registered: unknown[] = [];
  const made: { family: string; url: string; style: string; weight: string }[] = [];
  const e: FontEnv = {
    installed: async () => [lora],
    data: async () => new Uint8Array([1, 2, 3]),
    createFace: (family, url, style, weight) => {
      made.push({ family, url, style, weight });
      return { load: async () => undefined };
    },
    register: (f) => registered.push(f),
    ...over,
  };
  return { e, registered, made };
}

beforeEach(() => forgetLoadedFonts());

describe("faceDescriptor", () => {
  it("reads style and weight from the file name; a variable file covers every weight", () => {
    expect(faceDescriptor("Lora[wght].ttf")).toEqual({ style: "normal", weight: "100 900" });
    expect(faceDescriptor("Lora-Italic[wght].ttf")).toEqual({ style: "italic", weight: "100 900" });
    expect(faceDescriptor("Inter-SemiBold.otf").weight).toBe("600");
    expect(faceDescriptor("Inter-ExtraBold.otf").weight).toBe("800");
    expect(faceDescriptor("Inter-Bold.ttf").weight).toBe("700");
    expect(faceDescriptor("Inter-BoldItalic.ttf")).toEqual({ style: "italic", weight: "700" });
    expect(faceDescriptor("Plain.ttf")).toEqual({ style: "normal", weight: "400" });
  });
});

describe("toDataUrl", () => {
  it("makes a base64 data URL with the font type, also for large files", () => {
    expect(toDataUrl(new Uint8Array([104, 105]), "a.ttf")).toBe("data:font/ttf;base64,aGk=");
    expect(toDataUrl(new Uint8Array([104, 105]), "a.OTF")).toMatch(/^data:font\/otf;base64,/);
    expect(toDataUrl(new Uint8Array(100_000), "a.ttf").length).toBeGreaterThan(100_000);
  });
});

describe("ensureFontLoaded", () => {
  it("registers one face per font file (not the licence) from a data URL", async () => {
    const { e, registered, made } = env();
    expect(await ensureFontLoaded("Lora", e)).toBe(true);
    expect(registered).toHaveLength(2);
    expect(made.map((m) => [m.style, m.weight])).toEqual([
      ["normal", "100 900"],
      ["italic", "100 900"],
    ]);
    expect(made[0]!.url).toMatch(/^data:font\/ttf;base64,/);
  });
  it("loads a family once", async () => {
    const { e, made } = env();
    await ensureFontLoaded("Lora", e);
    await ensureFontLoaded("Lora", e);
    expect(made).toHaveLength(2);
  });
  it("needs nothing for a font installed on the computer", async () => {
    const { e, made } = env();
    expect(await ensureFontLoaded("Georgia", e)).toBe(true);
    expect(made).toHaveLength(0);
  });
  it("resolves false, never rejects, when the bytes cannot be read, the face is invalid or FontFace is missing", async () => {
    expect(
      await ensureFontLoaded(
        "Lora",
        env({ data: async () => Promise.reject(new Error("gone")) }).e,
      ),
    ).toBe(false);
    forgetLoadedFonts();
    const bad = env({
      createFace: () => ({ load: () => Promise.reject(new Error("invalid font data")) }),
    });
    expect(await ensureFontLoaded("Lora", bad.e)).toBe(false);
    expect(bad.registered).toHaveLength(0);
    forgetLoadedFonts();
    expect(await ensureFontLoaded("Lora", env({ createFace: () => null }).e)).toBe(false);
    forgetLoadedFonts();
    expect(
      await ensureFontLoaded("Lora", env({ installed: () => Promise.reject(new Error("x")) }).e),
    ).toBe(false);
  });
  it("tries again after a failure", async () => {
    let fail = true;
    const { e, registered } = env({
      data: async () => (fail ? Promise.reject(new Error("x")) : new Uint8Array([1])),
    });
    expect(await ensureFontLoaded("Lora", e)).toBe(false);
    fail = false;
    expect(await ensureFontLoaded("Lora", e)).toBe(true);
    expect(registered).toHaveLength(2);
  });
});
