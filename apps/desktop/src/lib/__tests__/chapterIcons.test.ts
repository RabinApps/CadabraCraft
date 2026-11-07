import { describe, expect, it } from "vitest";
import { ENTRY_ICONS } from "@cadabracraft/format";
import { COMPONENTS, iconComponent } from "../chapterIcons";

describe("chapter icons", () => {
  it("has a component for every allowed name and no others", () => {
    expect(Object.keys(COMPONENTS).sort()).toEqual([...ENTRY_ICONS].sort());
    for (const n of ENTRY_ICONS) expect(iconComponent(n)).toBe(COMPONENTS[n]);
  });
  it("ignores a name from a newer app and a missing name", () => {
    expect(iconComponent("from-a-newer-app")).toBeUndefined();
    expect(iconComponent(undefined)).toBeUndefined();
  });
});
