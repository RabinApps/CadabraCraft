import { describe, expect, it } from "vitest";
import { windowTitle } from "../useWindowTitle";

describe("windowTitle", () => {
  it("names the app alone on Home", () => {
    expect(windowTitle(undefined, undefined)).toBe("CadabraCraft");
  });
  it("puts the screen first, then the book, then the app", () => {
    expect(windowTitle("Settings", "My Book")).toBe("Settings - My Book - CadabraCraft");
    expect(windowTitle(undefined, "My Book")).toBe("My Book - CadabraCraft");
  });
  it("ignores a blank book title", () => {
    expect(windowTitle("Settings", "  ")).toBe("Settings - CadabraCraft");
  });
});
