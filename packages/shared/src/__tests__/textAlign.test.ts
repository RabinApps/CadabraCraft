import { describe, expect, it } from "vitest";
import { parseTextAlign, textAlignProblem } from "../textAlign";

describe("text alignment values", () => {
  it("accepts start, center and end, and treats absent as the template default", () => {
    expect(parseTextAlign("start")).toBe("start");
    expect(parseTextAlign("center")).toBe("center");
    expect(parseTextAlign("end")).toBe("end");
    expect(parseTextAlign(undefined)).toBeNull();
    expect(parseTextAlign(null)).toBeNull();
  });

  it("refuses anything else, justify and the physical names included", () => {
    for (const v of ["justify", "left", "right", "", 1, true, {}])
      expect(parseTextAlign(v)).toBeUndefined();
  });

  it("words the problem", () => {
    expect(textAlignProblem("center")).toBeNull();
    expect(textAlignProblem(undefined)).toBeNull();
    expect(textAlignProblem("justify")).toBe(
      'text alignment "justify" is not allowed (start, center or end)',
    );
  });
});
