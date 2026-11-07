import { beforeEach, describe, expect, it, vi } from "vitest";

// A minimal hook harness: one component instance whose refs persist across renders and whose effects re-run when
// their dependencies change (cleanup first), like React does.
const h = vi.hoisted(() => ({
  refs: [] as { current: unknown }[],
  refCursor: 0,
  effect: null as null | { deps: unknown[]; cleanup: void | (() => void) },
  queued: null as null | { fn: () => void | (() => void); deps: unknown[] },
}));
vi.mock("react", () => ({
  useRef: (init: unknown) => {
    const i = h.refCursor++;
    return (h.refs[i] ??= { current: init });
  },
  useEffect: (fn: () => void | (() => void), deps: unknown[]) => {
    h.queued = { fn, deps };
  },
}));

import { getCommands, useRegisterCommands, useStartDialogs, type Commands } from "../app/commands";

function render(commands: Commands) {
  h.refCursor = 0;
  useRegisterCommands(commands);
  const { fn, deps } = h.queued!;
  if (!h.effect || h.effect.deps.some((d, i) => d !== deps[i])) {
    h.effect?.cleanup?.();
    h.effect = { deps, cleanup: fn() };
  }
}
const unmount = () => {
  h.effect?.cleanup?.();
  h.effect = null;
  h.refs.length = 0;
};

beforeEach(unmount);

describe("useRegisterCommands", () => {
  it("keeps a command's global flag when it wraps the handler", () => {
    render({ "app.quit": { run: vi.fn(), global: true }, "a.b": { run: vi.fn() } });
    expect(getCommands()["app.quit"]!.global).toBe(true);
    expect(getCommands()["a.b"]!.global).toBeUndefined();
  });

  it("registers while mounted and removes them on unmount", () => {
    render({ "a.one": { run: vi.fn() } });
    expect(Object.keys(getCommands())).toEqual(["a.one"]);
    unmount();
    expect(Object.keys(getCommands())).toEqual([]);
  });

  it("keeps stable wrappers that call the latest handler, passing the argument", () => {
    const first = vi.fn();
    const second = vi.fn();
    render({ "a.one": { run: first } });
    const registered = getCommands()["a.one"];
    render({ "a.one": { run: second } });
    expect(getCommands()["a.one"]).toBe(registered); // handler change alone does not re-register
    getCommands()["a.one"]!.run("x");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("x");
  });

  it("carries enabled and checked, and re-registers when they change", () => {
    render({ "a.one": { run: vi.fn(), enabled: false, checked: true }, "a.two": { run: vi.fn() } });
    expect(getCommands()["a.one"]).toMatchObject({ enabled: false, checked: true });
    expect("enabled" in getCommands()["a.two"]!).toBe(false);
    expect("checked" in getCommands()["a.two"]!).toBe(false);
    render({ "a.one": { run: vi.fn(), enabled: true, checked: false }, "a.two": { run: vi.fn() } });
    expect(getCommands()["a.one"]).toMatchObject({ enabled: true, checked: false });
  });

  it("does nothing if the handler disappeared before a stale wrapper is called", () => {
    render({ "a.one": { run: vi.fn() } });
    const stale = getCommands()["a.one"]!;
    h.refs[0]!.current = {};
    expect(() => stale.run()).not.toThrow();
  });
});

describe("useStartDialogs", () => {
  it("opens and closes the create and import dialogs", () => {
    const s = useStartDialogs.getState();
    s.setCreating(true);
    s.setImporting(true);
    s.setImportingInto(true);
    expect(useStartDialogs.getState()).toMatchObject({
      creating: true,
      importing: true,
      importingInto: true,
    });
    s.setImportingInto(false);
    s.setCreating(false);
    s.setImporting(false);
    expect(useStartDialogs.getState()).toMatchObject({ creating: false, importing: false });
  });
});
