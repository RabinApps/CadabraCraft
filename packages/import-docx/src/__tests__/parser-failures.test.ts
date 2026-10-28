import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImportError, importMarkdown, looksLikeHtml } from "..";

const mocks = vi.hoisted(() => ({
  blocks: vi.fn(),
  parseSnippet: vi.fn(),
}));

vi.mock("../markdown/blocks", () => ({ blocks: mocks.blocks }));
vi.mock("../html/dom", async (original) => ({
  ...(await original<typeof import("../html/dom")>()),
  parseSnippet: mocks.parseSnippet,
}));

const failure = (fn: () => unknown): ImportError => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ImportError);
    return e as ImportError;
  }
  throw new Error("expected an ImportError");
};

beforeEach(() => {
  mocks.blocks.mockReset();
  mocks.parseSnippet.mockReset();
});

describe("importMarkdown when the converter fails", () => {
  it("passes an ImportError through", () => {
    mocks.blocks.mockImplementation(() => {
      throw new ImportError("input-too-large", "nope");
    });
    expect(failure(() => importMarkdown("x")).code).toBe("input-too-large");
  });

  it("reports a stack overflow as too deeply nested", () => {
    mocks.blocks.mockImplementation(() => {
      throw new RangeError("Maximum call stack size exceeded");
    });
    expect(failure(() => importMarkdown("x")).code).toBe("too-deeply-nested");
  });

  it("reports any other failure as an unreadable file, with or without a message", () => {
    mocks.blocks.mockImplementation(() => {
      throw new Error("boom");
    });
    const err = failure(() => importMarkdown("x"));
    expect(err.code).toBe("invalid-xml");
    expect(err.message).toContain("boom");
    mocks.blocks.mockImplementation(() => {
      throw "not an error object";
    });
    expect(failure(() => importMarkdown("x")).message).toContain("unknown error");
  });
});

describe("looksLikeHtml when the parser fails", () => {
  it("counts a too-deep failure as HTML and any other failure as not HTML", () => {
    mocks.parseSnippet.mockImplementation(() => {
      throw new RangeError("Maximum call stack size exceeded");
    });
    expect(looksLikeHtml("<b>x</b>")).toBe(true);
    mocks.parseSnippet.mockImplementation(() => {
      throw new ImportError("too-deeply-nested", "deep");
    });
    expect(looksLikeHtml("<b>x</b>")).toBe(true);
    mocks.parseSnippet.mockImplementation(() => {
      throw new Error("parser exploded");
    });
    expect(looksLikeHtml("<b>x</b>")).toBe(false);
  });

  it("ignores nodes that have no children when walking the parsed tree", () => {
    mocks.parseSnippet.mockReturnValue([
      { nodeName: "zz", tagName: "zz" },
      { nodeName: "#text", value: "t" },
    ]);
    expect(looksLikeHtml("<zz>x</zz>")).toBe(false);
  });
});
