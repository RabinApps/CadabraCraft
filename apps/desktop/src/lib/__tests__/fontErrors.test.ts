import { describe, expect, it } from "vitest";
import { describeFontError, FontUiError } from "../fontErrors";

const code = (e: unknown) => describeFontError(e).code;

describe("describeFontError", () => {
  it("returns a FontUiError unchanged", () => {
    const e = new FontUiError("other", "x");
    expect(describeFontError(e)).toBe(e);
  });
  it("tells the author about a lost connection in plain words", () => {
    const r = describeFontError({ kind: "network", message: "tls handshake" });
    expect(r.code).toBe("network");
    expect(r.message).toBe("The download failed. Check your connection and try again.");
  });
  it("explains a damaged download and a full disk", () => {
    expect(describeFontError({ kind: "checksum", file: "a.ttf" }).message).toMatch(/damaged/);
    expect(describeFontError({ kind: "disk_full" }).message).toMatch(/disk space/);
    expect(code({ kind: "disk_full" })).toBe("disk-full");
  });
  it("maps the remaining kinds", () => {
    expect(code({ kind: "unknown_font", font: "x" })).toBe("unknown");
    expect(code({ kind: "invalid_font", message: "no name" })).toBe("invalid");
    expect(describeFontError({ kind: "invalid_font", message: "no name" }).message).toMatch(
      /\.ttf or \.otf/,
    );
    expect(code({ kind: "cancelled" })).toBe("cancelled");
    const other = describeFontError({ kind: "other", message: "boom" });
    expect([other.code, other.message]).toEqual(["other", "boom"]);
  });
  it("keeps the original as the cause and handles things that are not font errors", () => {
    const raw = { kind: "network", message: "x" };
    expect(describeFontError(raw).cause).toBe(raw);
    const r = describeFontError(new Error("plain"));
    expect([r.code, r.message]).toEqual(["other", "plain"]);
  });
});
