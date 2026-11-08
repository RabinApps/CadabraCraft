import { beforeEach, describe, expect, it, vi } from "vitest";
import { disk } from "../../../test/fakeBridge";

vi.mock("../../../lib/bridge", async () => (await import("../../../test/fakeBridge")).fakeBridge());

import { useProject } from "../index";

const a = () => useProject.getState().actions;
const savedLanguage = () => JSON.parse(disk.get("cadabra.json")!).editions[0].language;

beforeEach(() => {
  disk.clear();
  useProject.setState({ root: null, manifest: null, notice: "", alertNotice: "", comments: [] });
});

describe("createProject language", () => {
  it("starts the book in the language the author picked", async () => {
    await a().createProject("/p", "Book", "Me", undefined, "fr");
    expect(savedLanguage()).toBe("fr");
  });
  it("falls back to the app language when no language is given", async () => {
    await a().createProject("/p", "Book", "Me");
    expect(savedLanguage()).toBe("en");
  });
});
