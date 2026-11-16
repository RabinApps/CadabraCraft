import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A minimal hook harness (see state/__tests__/commandsHooks.test.ts): one component instance whose effects re-run when their
// dependencies change, cleanup first, like React does.
const h = vi.hoisted(() => ({
  on: true,
  state: [] as unknown[],
  slot: 0,
  effect: null as null | { deps: unknown[]; cleanup: void | (() => void) },
  queued: null as null | { fn: () => void | (() => void); deps: unknown[] },
}));

vi.mock("react", () => ({
  useState: (init: unknown) => {
    const i = h.slot++;
    h.state[i] ??= init;
    const set = (v: unknown) => {
      h.state[i] = v;
    };
    return [h.state[i], set];
  },
  useLayoutEffect: (fn: () => void | (() => void), deps: unknown[]) => {
    h.queued = { fn, deps };
  },
}));

vi.mock("../../state/view/editorPrefs", () => ({
  // Like zustand: the caller's selector is what reads the store.
  useSettings: (select: (s: { typewriterScroll: boolean }) => unknown) =>
    select({ typewriterScroll: h.on }),
}));

import {
  USER_SCROLL_WINDOW_MS,
  followCaret,
  useTypewriterRefollow,
  useTypewriterSlack,
} from "../typewriter";
import { typewriterSlack, typewriterTarget } from "../../lib/reading/typewriterScroll";

interface Span {
  top: number;
  bottom: number;
}

function scrollerOf(
  opts: { scrollTop?: number; scrollHeight?: number; clientHeight?: number; box?: Span } = {},
) {
  return {
    scrollTop: opts.scrollTop ?? 100,
    scrollHeight: opts.scrollHeight ?? 3000,
    clientHeight: opts.clientHeight ?? 600,
    getBoundingClientRect: () => opts.box ?? { top: 0, bottom: 600 },
    scrollTo: vi.fn(),
  };
}

function editorOf(
  scroller: unknown,
  opts: { caret?: Span | Error; isDestroyed?: boolean; composing?: boolean } = {},
) {
  const caret = opts.caret ?? { top: 400, bottom: 420 };
  return {
    isDestroyed: opts.isDestroyed ?? false,
    state: { selection: { head: 3 } },
    view: {
      composing: opts.composing ?? false,
      dom: { closest: vi.fn(() => scroller) },
      coordsAtPos: () => {
        if (caret instanceof Error) throw caret;
        return caret;
      },
    },
  };
}

let frames: FrameRequestCallback[] = [];
let ids: number[] = [];
let nextFrame = 0;
const cancel = vi.fn();

beforeEach(() => {
  frames = [];
  ids = [];
  cancel.mockClear();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.push(cb);
    ids.push(++nextFrame);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", cancel);
  vi.stubGlobal("window", { visualViewport: undefined });
});

afterEach(() => vi.unstubAllGlobals());

/** Runs what the last `followCaret` queued, as the browser's next frame would. */
function nextTick() {
  frames.at(-1)!(0);
}

describe("followCaret", () => {
  it("scrolls the caret's line to the middle of the pane", () => {
    const scroller = scrollerOf();
    followCaret(editorOf(scroller) as never);
    nextTick();
    expect(scroller.scrollTo).toHaveBeenCalledWith({
      top: typewriterTarget({
        caret: { top: 400, bottom: 420 },
        view: { top: 0, bottom: 600 },
        scrollTop: 100,
        maxScrollTop: 2400,
      }),
      behavior: "instant",
    });
    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 210, behavior: "instant" });
  });

  it("leaves a caret that is already in the middle", () => {
    const scroller = scrollerOf();
    followCaret(editorOf(scroller, { caret: { top: 290, bottom: 310 } }) as never);
    nextTick();
    expect(scroller.scrollTo).not.toHaveBeenCalled();
  });

  it("does nothing once the editor is gone or a composition is running", () => {
    const destroyed = scrollerOf();
    followCaret(editorOf(destroyed, { isDestroyed: true }) as never);
    nextTick();
    expect(destroyed.scrollTo).not.toHaveBeenCalled();

    const composing = scrollerOf();
    followCaret(editorOf(composing, { composing: true }) as never);
    nextTick();
    expect(composing.scrollTo).not.toHaveBeenCalled();
  });

  it("does nothing outside a scrolling pane", () => {
    followCaret(editorOf(null) as never);
    expect(() => nextTick()).not.toThrow();
  });

  it("gives up when the caret is not drawn (yet)", () => {
    const scroller = scrollerOf();
    followCaret(editorOf(scroller, { caret: new Error("off screen") }) as never);
    expect(() => nextTick()).not.toThrow();
    expect(scroller.scrollTo).not.toHaveBeenCalled();
  });

  it("measures from what a phone's keyboard leaves visible", () => {
    vi.stubGlobal("window", { visualViewport: { offsetTop: 100, height: 200 } });
    const scroller = scrollerOf();
    followCaret(editorOf(scroller) as never);
    nextTick();
    // The visible part ends at 300, not 600: the middle is 150, so the caret at 410 needs 260px more.
    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 360, behavior: "instant" });
  });

  it("cancels the frame an earlier call queued", () => {
    followCaret(editorOf(scrollerOf()) as never);
    followCaret(editorOf(scrollerOf()) as never);
    expect(cancel).toHaveBeenCalledTimes(2);
    // The second call drops the frame the first one queued, so only the newest layout is followed.
    expect(cancel.mock.calls[1]).toEqual([ids[0]]);
    expect(frames).toHaveLength(2);
  });
});

describe("useTypewriterSlack", () => {
  class FakeResizeObserver {
    static last: FakeResizeObserver | null = null;
    observe = vi.fn();
    disconnect = vi.fn();
    constructor(readonly cb: () => void) {
      FakeResizeObserver.last = this;
    }
  }

  let el: { clientHeight: number };

  beforeEach(() => {
    h.on = true;
    h.state = [];
    h.effect?.cleanup?.();
    h.effect = null;
    h.queued = null;
    el = { clientHeight: 800 };
    FakeResizeObserver.last = null;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  });

  afterEach(() => {
    h.effect?.cleanup?.();
    h.effect = null;
    h.queued = null;
    h.state = [];
    FakeResizeObserver.last = null;
  });

  function render(ref: { current: HTMLElement | null }) {
    h.slot = 0;
    useTypewriterSlack(ref);
    const { fn, deps } = h.queued!;
    h.queued = null;
    const changed = !h.effect || h.effect.deps.some((d, i) => d !== deps[i]);
    if (changed) {
      h.effect?.cleanup?.();
      h.effect = { deps, cleanup: fn() };
    }
  }

  it("is half the pane's height while typewriter scrolling is on", () => {
    render({ current: el as unknown as HTMLElement });
    expect(h.state[0]).toBe(typewriterSlack(800));
    expect(h.state[0]).toBe(400);
    expect(FakeResizeObserver.last!.observe).toHaveBeenCalledWith(el);
  });

  it("follows the pane as it is resized, and stops when it is unmounted", () => {
    render({ current: el as unknown as HTMLElement });
    el.clientHeight = 500;
    FakeResizeObserver.last!.cb();
    expect(h.state[0]).toBe(250);

    const observer = FakeResizeObserver.last!;
    h.effect!.cleanup!();
    h.effect = null;
    expect(observer.disconnect).toHaveBeenCalled();
  });

  it("is 0 while typewriter scrolling is off, without watching the pane", () => {
    h.on = false;
    render({ current: el as unknown as HTMLElement });
    expect(h.state[0]).toBe(0);
    expect(FakeResizeObserver.last).toBeNull();
  });

  it("is 0 before the pane exists", () => {
    render({ current: null });
    expect(h.state[0]).toBe(0);
    expect(FakeResizeObserver.last).toBeNull();
  });

  it("stops watching and clears the slack when typewriter scrolling is turned off", () => {
    const ref = { current: el as unknown as HTMLElement };
    render(ref);
    const observer = FakeResizeObserver.last!;
    h.on = false;
    render(ref);
    expect(observer.disconnect).toHaveBeenCalled();
    expect(h.state[0]).toBe(0);
  });
});

describe("useTypewriterRefollow", () => {
  class FakeResizeObserver {
    static last: FakeResizeObserver | null = null;
    observe = vi.fn();
    disconnect = vi.fn();
    constructor(readonly cb: () => void) {
      FakeResizeObserver.last = this;
    }
  }

  type Listener = () => void;
  /** An event target that keeps its listeners, so a test can fire them and see which are removed. */
  function targetOf() {
    const listeners = new Map<string, Set<Listener>>();
    return {
      listeners,
      addEventListener: vi.fn((type: string, fn: Listener) => {
        listeners.set(type, (listeners.get(type) ?? new Set()).add(fn));
      }),
      removeEventListener: vi.fn(
        (type: string, fn: Listener) => void listeners.get(type)?.delete(fn),
      ),
      fire: (type: string) => listeners.get(type)?.forEach((fn) => fn()),
      count: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
    };
  }

  const content = {};
  let pane = { firstElementChild: content, ...targetOf() };
  let win = targetOf();

  beforeEach(() => {
    h.on = true;
    h.effect = null;
    h.queued = null;
    FakeResizeObserver.last = null;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    pane = { firstElementChild: content, ...targetOf() };
    win = targetOf();
    vi.stubGlobal("window", { visualViewport: undefined, ...win });
  });

  function mount(
    editor: unknown,
    ref: { current: HTMLElement | null } = { current: pane as never },
  ) {
    h.slot = 0;
    useTypewriterRefollow(ref, editor as never);
    const { fn } = h.queued!;
    h.queued = null;
    return fn();
  }

  const editorWith = (scroller: unknown, focused: boolean, destroyed = false) => ({
    ...editorOf(scroller),
    isFocused: focused,
    isDestroyed: destroyed,
  });

  it("scrolls the caret back to the middle when the pages change height under a focused editor", () => {
    const scroller = scrollerOf();
    mount(editorWith(scroller, true));
    const observer = FakeResizeObserver.last!;
    expect(observer.observe).toHaveBeenCalledWith(content);
    observer.cb(); // the report that comes when observing starts
    expect(frames).toHaveLength(0);
    observer.cb();
    nextTick();
    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 210, behavior: "instant" });
  });

  it("leaves the page alone when the editor has no focus or is gone", () => {
    const scroller = scrollerOf();
    mount(editorWith(scroller, false));
    FakeResizeObserver.last!.cb();
    FakeResizeObserver.last!.cb();
    expect(frames).toHaveLength(0);
    mount(editorWith(scroller, true, true));
    FakeResizeObserver.last!.cb();
    FakeResizeObserver.last!.cb();
    expect(frames).toHaveLength(0);
  });

  it("watches nothing while typewriter scrolling is off, or before the pane or editor exist", () => {
    h.on = false;
    mount(editorWith(scrollerOf(), true));
    expect(FakeResizeObserver.last).toBeNull();
    h.on = true;
    mount(editorWith(scrollerOf(), true), { current: null });
    mount(null);
    expect(FakeResizeObserver.last).toBeNull();
  });

  it("stops watching when it is unmounted", () => {
    const stop = mount(editorWith(scrollerOf(), true)) as () => void;
    const observer = FakeResizeObserver.last!;
    expect(pane.count() + win.count()).toBeGreaterThan(0);
    stop();
    expect(observer.disconnect).toHaveBeenCalled();
    expect(pane.count()).toBe(0);
    expect(win.count()).toBe(0);
  });

  describe("when the browser moves the scroll position itself", () => {
    let now = 1_000_000;
    beforeEach(() => {
      now = 1_000_000;
      vi.spyOn(Date, "now").mockImplementation(() => now);
    });
    afterEach(() => vi.restoreAllMocks());

    it("puts the caret's line back in the middle after a scroll nobody asked for", () => {
      const scroller = scrollerOf();
      mount(editorWith(scroller, true));
      pane.fire("scroll");
      nextTick();
      expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 210, behavior: "instant" });
    });

    it("leaves the author's own scrolling alone: right after a wheel or touch, and while a pointer is held", () => {
      const scroller = scrollerOf();
      mount(editorWith(scroller, true));
      for (const type of ["wheel", "touchmove"]) {
        pane.fire(type);
        now += USER_SCROLL_WINDOW_MS - 1;
        pane.fire("scroll");
        expect(frames).toHaveLength(0);
        now += 1; // the window has passed
      }
      pane.fire("pointerdown");
      now += USER_SCROLL_WINDOW_MS * 5; // a long drag of the scrollbar
      pane.fire("scroll");
      expect(frames).toHaveLength(0);
      win.fire("pointerup");
      pane.fire("scroll");
      expect(frames).toHaveLength(0); // the release counts as input too
      now += USER_SCROLL_WINDOW_MS;
      pane.fire("scroll");
      expect(frames).toHaveLength(1);
      win.fire("pointercancel");
    });

    it("ignores the scroll when the editor has no focus or is gone", () => {
      mount(editorWith(scrollerOf(), false));
      pane.fire("scroll");
      mount(editorWith(scrollerOf(), true, true));
      pane.fire("scroll");
      expect(frames).toHaveLength(0);
    });
  });
});
