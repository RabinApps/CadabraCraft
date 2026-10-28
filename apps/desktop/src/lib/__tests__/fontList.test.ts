import { describe, expect, it } from "vitest";
import { formatMb, mergeFonts, printFamilies } from "../fontList";

const kept = [
  { id: "lora", family: "Lora", source: "downloaded" as const, files: ["Lora.ttf"] },
  { id: "imported-zed", family: "Zed Sans", source: "imported" as const, files: ["Zed.ttf"] },
];

describe("mergeFonts", () => {
  it("lists the bundled fonts first, then the rest by name, each family once", () => {
    const list = mergeFonts(["georgia", "Newsreader", "Lora", "Arial"], kept);
    expect(list.map((f) => [f.family, f.source])).toEqual([
      ["Newsreader", "bundled"],
      ["Inter", "bundled"],
      ["Arial", "installed"],
      ["georgia", "installed"],
      ["Lora", "downloaded"],
      ["Zed Sans", "imported"],
    ]);
  });
  it("keeps the id of the app's own fonts and skips blank system names", () => {
    const list = mergeFonts(["", "  "], kept);
    expect(list.find((f) => f.family === "Lora")?.id).toBe("lora");
    expect(list).toHaveLength(4);
  });
});

describe("printFamilies", () => {
  it("merges system and kept families without case duplicates, sorted", () => {
    expect(printFamilies(["Georgia", "LORA", "Arial", " "], kept)).toEqual([
      "Arial",
      "Georgia",
      "Lora",
      "Zed Sans",
    ]);
  });
});

describe("formatMb", () => {
  it("shows one decimal", () => {
    expect(formatMb(2_400_000)).toMatch(/^2[.,]4$/);
    expect(formatMb(0)).toMatch(/^0[.,]0$/);
  });
});
