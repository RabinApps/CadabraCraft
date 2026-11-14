import { describe, expect, it } from "vitest";
import {
  FORM_MAX_HEIGHT,
  FORM_MIN_HEIGHT,
  SUPPORT_ORIGIN,
  formHeightFrom,
  supportFormUrl,
} from "../supportForm";

const frame = {};
const msg = (over: Partial<{ origin: string; source: unknown; data: unknown }> = {}) => ({
  origin: SUPPORT_ORIGIN,
  source: frame,
  data: { type: "supdesk:height", height: 480.4 },
  ...over,
});

describe("supportFormUrl", () => {
  it("points at the embeddable page of each form", () => {
    expect(supportFormUrl("contact")).toBe("https://support.cadabracraft.com/embed/contact");
    expect(supportFormUrl("feedback")).toBe("https://support.cadabracraft.com/embed/feedback");
  });
});

describe("formHeightFrom", () => {
  it("accepts the form's own height message and rounds it", () => {
    expect(formHeightFrom(msg(), frame)).toBe(480);
  });
  it("keeps the height within the allowed range", () => {
    expect(formHeightFrom(msg({ data: { type: "supdesk:height", height: 5 } }), frame)).toBe(
      FORM_MIN_HEIGHT,
    );
    expect(formHeightFrom(msg({ data: { type: "supdesk:height", height: 1e9 } }), frame)).toBe(
      FORM_MAX_HEIGHT,
    );
  });
  it("ignores messages from another window or origin", () => {
    expect(formHeightFrom(msg({ source: {} }), frame)).toBeNull();
    expect(formHeightFrom(msg({ origin: "https://evil.example" }), frame)).toBeNull();
    expect(formHeightFrom(msg(), null)).toBeNull();
  });
  it("ignores messages that are not a finite height", () => {
    for (const data of [
      null,
      "x",
      { type: "other", height: 400 },
      { type: "supdesk:height" },
      { type: "supdesk:height", height: "400" },
      { type: "supdesk:height", height: Infinity },
      { type: "supdesk:height", height: NaN },
    ])
      expect(formHeightFrom(msg({ data }), frame)).toBeNull();
  });
});
