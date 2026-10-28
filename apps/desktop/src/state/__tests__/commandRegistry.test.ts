import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useCommandRegistry } from "../commands";

describe("useCommandRegistry", () => {
  it("gives a component the registry (server rendering sees the initial, empty one)", () => {
    const Probe = () => createElement("p", null, JSON.stringify(useCommandRegistry()));
    expect(renderToString(createElement(Probe))).toBe("<p>{}</p>");
  });
});
