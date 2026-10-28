import { beforeEach, describe, expect, it, vi } from "vitest";
import { disk, type fakeFonts } from "../../../test/fakeBridge";

const h = vi.hoisted(() => ({
  fonts: null as unknown as ReturnType<typeof fakeFonts>,
  typst: { compiles: [] as { source: string }[], fonts: ["Libertinus Serif"] },
}));
const typst = h.typst;
vi.mock("../../../lib/bridge", async () => {
  const mod = await import("../../../test/fakeBridge");
  h.fonts = mod.fakeFonts();
  return mod.fakeBridge({
    ...h.fonts.methods,
    typstListFonts: async () => typst.fonts,
    writeBytes: async () => {},
    typstCompile: async (_p: string | null, source: string) => {
      typst.compiles.push({ source });
      return new Uint8Array([0x25]);
    },
  });
});

import { useProject } from "../index";

const fonts = {
  get state() {
    return h.fonts.state;
  },
  get methods() {
    return h.fonts.methods;
  },
};

const a = () => useProject.getState().actions;
const s = () => useProject.getState();
const manifestOnDisk = () => JSON.parse(disk.get("cadabra.json")!);

beforeEach(async () => {
  disk.clear();
  fonts.state.installed = [];
  fonts.state.failWith = null;
  fonts.state.held = false;
  fonts.state.release = null;
  fonts.state.cancelled = [];
  fonts.state.downloads = [];
  typst.compiles = [];
  typst.fonts = ["Libertinus Serif"];
  useProject.setState({ fontDownloads: {}, root: null, manifest: null, exportStage: null });
  await a().createProject("/p", "Book", "Me");
});

describe("downloadFont", () => {
  it("reports progress while running and leaves no entry when it finishes", async () => {
    fonts.state.held = true;
    const run = a().downloadFont("lora", 2_400_000);
    await vi.waitFor(() => expect(fonts.state.release).not.toBeNull());
    expect(s().fontDownloads.lora).toMatchObject({
      status: "running",
      done: 1_200_000,
      total: 2_400_000,
      cancelling: false,
    });
    fonts.state.release?.();
    expect(await run).toBe(true);
    expect(s().fontDownloads).toEqual({});
    expect(fonts.state.installed.map((f) => f.id)).toEqual(["lora"]);
  });
  it("turns a failure into a plain message the catalog can show, then clears on dismiss", async () => {
    fonts.state.failWith = { kind: "network", message: "offline" };
    expect(await a().downloadFont("lora", 100)).toBe(false);
    const d = s().fontDownloads.lora!;
    expect(d.status).toBe("error");
    expect(d.error?.code).toBe("network");
    expect(d.error?.message).toBe("The download failed. Check your connection and try again.");
    a().dismissFontDownload("lora");
    expect(s().fontDownloads).toEqual({});
  });
  it("can be retried after a failure", async () => {
    fonts.state.failWith = { kind: "disk_full" };
    await a().downloadFont("lora", 100);
    expect(s().fontDownloads.lora?.error?.code).toBe("disk-full");
    expect(await a().downloadFont("lora", 100)).toBe(true);
    expect(s().fontDownloads).toEqual({});
  });
  it("stops on cancel, marks it cancelling meanwhile and leaves no error behind", async () => {
    fonts.state.held = true;
    const run = a().downloadFont("lora", 100);
    await vi.waitFor(() => expect(fonts.state.downloads).toEqual(["lora"]));
    a().cancelFontDownload("lora");
    expect(s().fontDownloads.lora?.cancelling).toBe(true);
    expect(await run).toBe(false);
    expect(fonts.state.cancelled).toHaveLength(1);
    expect(s().fontDownloads).toEqual({});
  });
  it("refuses a second download of the same family while one runs and ignores dismiss then", async () => {
    fonts.state.held = true;
    const run = a().downloadFont("lora", 100);
    await vi.waitFor(() => expect(fonts.state.downloads).toHaveLength(1));
    expect(await a().downloadFont("lora", 100)).toBe(false);
    a().dismissFontDownload("lora");
    expect(s().fontDownloads.lora?.status).toBe("running");
    fonts.state.release?.();
    expect(await run).toBe(true);
  });
  it("ignores a cancel when nothing is running", () => {
    a().cancelFontDownload("lora");
    expect(fonts.state.cancelled).toEqual([]);
  });
});

describe("setBookFonts", () => {
  it("saves the chosen families in the manifest and drops empty ones", async () => {
    await a().setBookFonts({ body: " Lora ", heading: "" });
    expect(manifestOnDisk().fonts).toEqual({ body: "Lora" });
    await a().setBookFonts({ body: "Lora", heading: "EB Garamond" });
    expect(manifestOnDisk().fonts).toEqual({ body: "Lora", heading: "EB Garamond" });
  });
  it("removes the key for the template default and does not write when nothing changes", async () => {
    await a().setBookFonts({ body: "Lora" });
    await a().setBookFonts({});
    expect("fonts" in manifestOnDisk()).toBe(false);
    const before = disk.get("cadabra.json");
    await a().setBookFonts({ body: "", heading: "" });
    expect(disk.get("cadabra.json")).toBe(before);
  });
  it("needs an open book and refuses an over-long name", async () => {
    await expect(a().setBookFonts({ body: "x".repeat(101) })).rejects.toThrow();
    useProject.setState({ root: null, manifest: null });
    await expect(a().setBookFonts({ body: "Lora" })).rejects.toThrow("no project open");
  });
});

describe("exportPdf with the book's fonts", () => {
  const options = { trimSize: "5.5x8.5" as const, pdfA: false, template: "nonfiction" };
  it("uses manifest.fonts by default", async () => {
    typst.fonts = ["Libertinus Serif", "Lora"];
    await a().setBookFonts({ body: "Lora" });
    await a().exportPdf(options);
    expect(typst.compiles.at(-1)!.source).toContain("Lora");
  });
  it("lets the caller name other fonts", async () => {
    typst.fonts = ["Libertinus Serif", "Georgia"];
    await a().setBookFonts({ body: "Lora" });
    await a().exportPdf({ ...options, fonts: { body: "Georgia" } });
    expect(typst.compiles.at(-1)!.source).toContain("Georgia");
  });
  it("refuses with the font-missing message when the font is not on this computer", async () => {
    await a().setBookFonts({ body: "Lora" });
    const e = await a()
      .exportPdf(options)
      .then(
        () => null,
        (x: unknown) => x as { code: string; message: string },
      );
    expect(e?.code).toBe("font");
    expect(e?.message).toBe(
      "The font “Lora” is not on this computer. Download it in Settings, Fonts, or pick another font.",
    );
    expect(typst.compiles).toHaveLength(0);
  });
});
