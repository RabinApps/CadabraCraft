import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  fontsInstalled: vi.fn(),
  fontsData: vi.fn(),
}));
vi.mock("../bridge", () => ({ bridge }));

import { ensureFontLoaded, forgetLoadedFonts } from "../loadFont";

const lora = { id: "lora", family: "Lora", source: "downloaded", files: ["Lora-Regular.ttf"] };

beforeEach(() => {
  forgetLoadedFonts();
  bridge.fontsInstalled.mockReset().mockResolvedValue([lora]);
  bridge.fontsData.mockReset().mockResolvedValue(new Uint8Array([1, 2, 3]));
});
afterEach(() => vi.unstubAllGlobals());

describe("ensureFontLoaded with the webview's own FontFace", () => {
  it("registers a face made from the bytes of the installed family", async () => {
    const added: unknown[] = [];
    const faces: { family: string; source: string; load: () => Promise<void> }[] = [];
    vi.stubGlobal(
      "FontFace",
      class {
        constructor(
          public family: string,
          public source: string,
        ) {
          faces.push(this as never);
        }
        load = async () => {};
      },
    );
    vi.stubGlobal("document", { fonts: { add: (f: unknown) => added.push(f) } });
    expect(await ensureFontLoaded("Lora")).toBe(true);
    expect(bridge.fontsData).toHaveBeenCalledWith("lora", "Lora-Regular.ttf");
    expect(faces[0]?.source).toMatch(/^url\(data:font\/ttf;base64,/);
    expect(added).toHaveLength(1);
  });

  it("reports false when the webview has no FontFace", async () => {
    expect(await ensureFontLoaded("Lora")).toBe(false);
  });
});
