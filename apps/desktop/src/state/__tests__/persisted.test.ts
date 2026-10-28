import { afterEach, describe, expect, it, vi } from "vitest";
import { readStored, readStoredJson, removeStored, writeStored } from "../../lib/persisted";

afterEach(() => vi.unstubAllGlobals());

describe("persisted storage helpers", () => {
  it("round-trips text and JSON and removes keys", () => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    });
    writeStored("k", '{"a":1}');
    expect(readStored("k")).toBe('{"a":1}');
    expect(readStoredJson("k")).toEqual({ a: 1 });
    removeStored("k");
    expect(readStored("k")).toBeNull();
    expect(readStoredJson("k")).toBeNull();
  });
  it("never throws when storage is unavailable or the JSON is corrupt", () => {
    const boom = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("localStorage", { getItem: boom, setItem: boom, removeItem: boom });
    expect(readStored("k")).toBeNull();
    expect(readStoredJson("k")).toBeNull();
    expect(() => writeStored("k", "v")).not.toThrow();
    expect(() => removeStored("k")).not.toThrow();
    vi.stubGlobal("localStorage", { getItem: () => "{oops" });
    expect(readStoredJson("k")).toBeNull();
  });
});
