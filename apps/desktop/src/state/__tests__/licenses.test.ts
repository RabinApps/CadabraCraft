import { describe, expect, it } from "vitest";
import { LICENSE_DOCS, useLicenses } from "../app/licenses";

describe("licenses dialog state", () => {
  it("opens and closes", () => {
    expect(useLicenses.getState().open).toBe(false);
    useLicenses.getState().show();
    expect(useLicenses.getState().open).toBe(true);
    useLicenses.getState().close();
    expect(useLicenses.getState().open).toBe(false);
  });

  it("lists the six documents the Rust command accepts", () => {
    expect(LICENSE_DOCS).toEqual([
      "license",
      "clarifications",
      "notice",
      "programs",
      "rust",
      "npm",
    ]);
  });
});
