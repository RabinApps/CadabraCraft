import { beforeEach, describe, expect, it, vi } from "vitest";

// There is no DOM in the unit run: stand in for React's ref and layout effect and for the column's elements.
const react = vi.hoisted(() => ({
  column: { current: null as unknown },
  cleanups: [] as (() => void)[],
}));
vi.mock("react", () => ({
  useRef: () => react.column,
  useLayoutEffect: (effect: () => void | (() => void)) => {
    const cleanup = effect();
    if (cleanup) react.cleanups.push(cleanup);
  },
}));

import { useCentredColumn } from "../centring";

const child = (top: number, bottom: number, cls = "") => ({
  classList: { contains: (c: string) => c === cls },
  getBoundingClientRect: () => ({ top, bottom }),
});
const props = new Map<string, string>();
const el = (pm: unknown) => ({
  style: {
    setProperty: (k: string, v: string) => props.set(k, v),
    removeProperty: (k: string) => props.delete(k),
  },
  querySelector: () => pm,
});
const observers: { cb: () => void; observed: unknown; disconnected: boolean }[] = [];

beforeEach(() => {
  props.clear();
  observers.length = 0;
  react.cleanups.length = 0;
  react.column.current = null;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      rec = { cb: () => {}, observed: null as unknown, disconnected: false };
      constructor(cb: () => void) {
        this.rec.cb = cb;
        observers.push(this.rec);
      }
      observe(target: unknown) {
        this.rec.observed = target;
      }
      disconnect() {
        this.rec.disconnected = true;
      }
    },
  );
});

describe("useCentredColumn", () => {
  it("does nothing without a column", () => {
    useCentredColumn(true, 600, 1, "k");
    expect(observers).toEqual([]);
  });

  it("removes the offset when the page is not centred", () => {
    props.set("--page-centre-top", "9px");
    react.column.current = el(null);
    useCentredColumn(false, 600, 1, "k");
    expect(props.has("--page-centre-top")).toBe(false);
  });

  it("does nothing while the editor is not in the column yet", () => {
    react.column.current = el(null);
    useCentredColumn(true, 600, 1, "k");
    expect(observers).toEqual([]);
  });

  it("sets half the free height, ignoring page-break spacers, and measures again on resize", () => {
    const pm = {
      children: [child(0, 500, "pv-gap"), child(100, 200), child(200, 300)],
    };
    react.column.current = el(pm);
    useCentredColumn(true, 600, 2, "k");
    // Content spans 100..300 at zoom 2 = 100px; (600 - 100) / 2.
    expect(props.get("--page-centre-top")).toBe("250px");
    expect(observers[0]?.observed).toBe(pm);
    pm.children = [child(0, 1400)];
    observers[0]!.cb();
    expect(props.get("--page-centre-top")).toBe("0px");
    react.cleanups[0]!();
    expect(observers[0]!.disconnected).toBe(true);
  });

  it("leaves the offset alone when the editor holds only spacers", () => {
    react.column.current = el({ children: [child(0, 50, "pv-gap")] });
    useCentredColumn(true, 600, 1, "k");
    expect(props.has("--page-centre-top")).toBe(false);
  });
});
