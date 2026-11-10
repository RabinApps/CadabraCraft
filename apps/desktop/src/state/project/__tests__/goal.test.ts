import { beforeEach, describe, expect, it, vi } from "vitest";
import { disk } from "../../../test/fakeBridge";

vi.mock("../../../lib/bridge", async () =>
  (await import("../../../test/fakeBridge")).fakeBridge({}),
);

import { useProject } from "../index";

const a = () => useProject.getState().actions;
const s = () => useProject.getState();
const manifestOnDisk = () => JSON.parse(disk.get("cadabra.json")!);

beforeEach(async () => {
  disk.clear();
  useProject.setState({ root: null, manifest: null });
  await a().createProject("/p", "Book", "Me");
});

describe("setBookGoal", () => {
  it("saves the word goal and its deadline in cadabra.json", async () => {
    await a().setBookGoal({ words: 50_000, deadline: "2027-03-01" });
    expect(s().manifest!.goal).toEqual({ words: 50_000, deadline: "2027-03-01" });
    expect(manifestOnDisk().goal).toEqual({ words: 50_000, deadline: "2027-03-01" });
  });

  it("saves a goal with no deadline without a deadline key", async () => {
    await a().setBookGoal({ words: 1200 });
    expect(manifestOnDisk().goal).toEqual({ words: 1200 });
    expect("deadline" in manifestOnDisk().goal).toBe(false);
  });

  it("does not write again when the goal is unchanged", async () => {
    await a().setBookGoal({ words: 1200 });
    const before = disk.get("cadabra.json");
    await a().setBookGoal({ words: 1200 });
    expect(disk.get("cadabra.json")).toBe(before);
  });

  it("clears the goal with null and removes the key; clearing no goal writes nothing", async () => {
    await a().setBookGoal({ words: 1200, deadline: "2027-03-01" });
    await a().setBookGoal(null);
    expect("goal" in s().manifest!).toBe(false);
    expect("goal" in manifestOnDisk()).toBe(false);
    const before = disk.get("cadabra.json");
    await a().setBookGoal(null);
    expect(disk.get("cadabra.json")).toBe(before);
  });

  it("refuses an invalid goal and leaves the book unchanged", async () => {
    await a().setBookGoal({ words: 900 });
    const before = disk.get("cadabra.json");
    await expect(a().setBookGoal({ words: 0 })).rejects.toThrow('"goal.words"');
    await expect(a().setBookGoal({ words: 10, deadline: "2027-02-30" })).rejects.toThrow(
      '"goal.deadline"',
    );
    expect(s().manifest!.goal).toEqual({ words: 900 });
    expect(disk.get("cadabra.json")).toBe(before);
  });

  it("needs an open book", async () => {
    useProject.setState({ root: null, manifest: null });
    await expect(a().setBookGoal({ words: 10 })).rejects.toThrow("no project open");
  });
});
