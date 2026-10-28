import { afterEach, describe, expect, it, vi } from "vitest";
import { getCommands, registerCommands, runCommand } from "../commands";

afterEach(() => vi.unstubAllGlobals());

describe("command registry", () => {
  it("runs a registered command with its argument and reports that it ran", () => {
    const run = vi.fn();
    const off = registerCommands({ "file.openRecent": { run } });
    expect(runCommand("file.openRecent", "/book")).toBe(true);
    expect(run).toHaveBeenCalledWith("/book");
    off();
  });

  it("does nothing for a command that is missing or disabled", () => {
    const run = vi.fn();
    const off = registerCommands({ "file.save": { run, enabled: false } });
    expect(runCommand("file.save")).toBe(false);
    expect(runCommand("no.such.command")).toBe(false);
    expect(run).not.toHaveBeenCalled();
    off();
  });

  it("does nothing while a dialog is open, so a shortcut cannot act on the page behind it", () => {
    vi.stubGlobal("document", {
      querySelector: (s: string) => (s === "[role=dialog]" ? {} : null),
    });
    const run = vi.fn();
    const off = registerCommands({ "file.save": { run } });
    expect(runCommand("file.save")).toBe(false);
    expect(run).not.toHaveBeenCalled();
    off();
  });

  it("removes exactly what a component registered when it goes away, leaving the others", () => {
    const offA = registerCommands({ "a.one": { run: vi.fn() }, "a.two": { run: vi.fn() } });
    const offB = registerCommands({ "b.one": { run: vi.fn() } });
    offA();
    expect(Object.keys(getCommands())).toEqual(["b.one"]);
    offB();
    expect(Object.keys(getCommands())).toEqual([]);
  });
});
