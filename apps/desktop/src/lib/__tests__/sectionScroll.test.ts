import { describe, expect, it } from "vitest";
import {
  EDGE_TRAVEL,
  edgeStep,
  requestLanding,
  sectionNeighbours,
  takeLanding,
  wheelPx,
  type EdgeInput,
} from "../reading/sectionScroll";

/** A scroller 600px high showing 2000px of pages, by default at its top. */
const at = (scrollTop: number, extra: Partial<EdgeInput> = {}): EdgeInput => ({
  travel: 0,
  deltaY: 100,
  deltaMode: 0,
  scrollTop,
  scrollHeight: 2000,
  clientHeight: 600,
  ...extra,
});

describe("wheelPx", () => {
  it("turns lines and pages into px", () => {
    expect(wheelPx(3, 0, 600)).toBe(3);
    expect(wheelPx(3, 1, 600)).toBe(48);
    expect(wheelPx(1, 2, 600)).toBe(600);
  });
});

describe("edgeStep", () => {
  it("does nothing in the middle of a section and forgets any travel", () => {
    expect(edgeStep(at(700, { travel: 80 }))).toEqual({ travel: 0, intent: null });
    expect(edgeStep(at(700, { deltaY: -100 }))).toEqual({ travel: 0, intent: null });
  });

  it("hands over to the next section once the scroll past the last page adds up", () => {
    const first = edgeStep(at(1400, { deltaY: 60 }));
    expect(first.intent).toBeNull();
    expect(first.travel).toBe(60);
    // A wheel notch is about EDGE_TRAVEL: the next one at the end opens the next section.
    expect(edgeStep(at(1400, { travel: EDGE_TRAVEL - 20, deltaY: 40 }))).toEqual({
      travel: 0,
      intent: "next",
    });
  });

  it("needs more than a trackpad tick at the end", () => {
    let travel = 0;
    for (let i = 0; i < 3; i++) travel = edgeStep(at(1400, { travel, deltaY: 2 })).travel;
    expect(travel).toBe(6);
    expect(travel).toBeLessThan(EDGE_TRAVEL);
  });

  it("hands over to the previous section above the first page", () => {
    // Not yet: a tick up at the first page is counted, and the wheel gesture after it opens the previous section.
    expect(edgeStep(at(0, { deltaY: -60 })).travel).toBe(-60);
    expect(edgeStep(at(0, { travel: -60, deltaY: -60 }))).toEqual({ travel: 0, intent: "prev" });
    // A whole notch on its own is enough.
    expect(edgeStep(at(0, { deltaY: -EDGE_TRAVEL }))).toEqual({ travel: 0, intent: "prev" });
  });

  it("counts up and down separately, so turning round starts again", () => {
    expect(edgeStep(at(1400, { travel: 80, deltaY: -100 })).travel).toBe(0);
    expect(edgeStep(at(0, { travel: -80, deltaY: 100 })).travel).toBe(0);
  });

  it("treats a section that fits the pane as at both ends", () => {
    const fits = { scrollTop: 0, scrollHeight: 600, clientHeight: 600 };
    expect(edgeStep(at(0, { ...fits })).intent).toBe("next");
    expect(edgeStep(at(0, { ...fits, deltaY: -100 })).intent).toBe("prev");
  });

  it("ignores a scroll that is not vertical", () => {
    expect(edgeStep(at(1400, { deltaY: 0 }))).toEqual({ travel: 0, intent: null });
  });
});

describe("sectionNeighbours", () => {
  const ids = ["title", "dedication", "one", "two"];

  it("finds the sections either side of the open one in reading order", () => {
    expect(sectionNeighbours(ids, "dedication")).toEqual({ prev: "title", next: "one" });
  });

  it("has no previous for the first page and no next for the last", () => {
    expect(sectionNeighbours(ids, "title")).toEqual({ prev: null, next: "dedication" });
    expect(sectionNeighbours(ids, "two")).toEqual({ prev: "one", next: null });
  });

  it("has neither when nothing matches", () => {
    expect(sectionNeighbours(ids, null)).toEqual({ prev: null, next: null });
    expect(sectionNeighbours(ids, "gone")).toEqual({ prev: null, next: null });
    expect(sectionNeighbours([], "one")).toEqual({ prev: null, next: null });
  });
});

describe("takeLanding", () => {
  it("is the start of the section unless the scroll came from below", () => {
    expect(takeLanding()).toBe("start");
    requestLanding("end");
    expect(takeLanding()).toBe("end");
    // Read once: the next section opened by hand starts at its first page.
    expect(takeLanding()).toBe("start");
  });
});
