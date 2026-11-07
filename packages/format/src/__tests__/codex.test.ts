import { describe, expect, it } from "vitest";
import {
  MAX_CODEX_ALIAS,
  MAX_CODEX_ALIASES,
  MAX_CODEX_BODY,
  MAX_CODEX_ENTRIES,
  MAX_CODEX_LINKS,
  MAX_CODEX_NAME,
  MAX_CODEX_SUMMARY,
  assertCodexFile,
  codexEntry,
  codexProblem,
  emptyCodex,
  isCodexFile,
} from "../codex";

const entry = (over: Record<string, unknown> = {}) => ({
  id: "mara",
  kind: "character",
  name: "Mara",
  aliases: ["Mara Vane"],
  summary: "Keeps the quay.",
  body: "Mara has kept the quay since her mother died.\n\nShe does not swim.",
  image: null,
  links: ["https://example.test/mara"],
  ...over,
});

const codex = (...entries: unknown[]) => ({ entries });

describe("codexProblem", () => {
  it("accepts a codex with an entry of every kind, and an empty one", () => {
    expect(
      codexProblem(
        codex(
          entry(),
          entry({ id: "quay", kind: "place", name: "The quay", aliases: [] }),
          entry({ id: "lamp", kind: "item", name: "The lamp", aliases: [] }),
          entry({ id: "tide", kind: "lore", name: "The long tide", aliases: [] }),
        ),
      ),
    ).toBeNull();
    expect(codexProblem(emptyCodex())).toBeNull();
  });

  it("accepts an entry with only the required fields", () => {
    expect(
      codexProblem(
        codex({
          id: "mara",
          kind: "character",
          name: "Mara",
          aliases: [],
          summary: "",
          body: "",
          image: null,
          links: [],
        }),
      ),
    ).toBeNull();
  });

  it("refuses a file that is not an object with entries", () => {
    expect(codexProblem(null)).toMatch(/object with an entries array/);
    expect(codexProblem([])).toMatch(/object with an entries array/);
    expect(codexProblem({})).toMatch(/entries array/);
    expect(codexProblem({ entries: {}, extra: 1 })).toMatch(/unknown key/);
  });

  it("refuses an entry with an unusable id, kind or name", () => {
    expect(codexProblem(codex(null))).toMatch(/must be an object with id, kind and name/);
    expect(codexProblem(codex(entry({ name: 42 })))).toMatch(/needs a name/);
    expect(codexProblem(codex(entry({ image: 7 })))).toMatch(/image/);
    expect(codexProblem(codex(entry({ id: "1 bad" })))).toMatch(/needs an id/);
    expect(codexProblem(codex(entry({ id: "" })))).toMatch(/needs an id/);
    expect(codexProblem(codex(entry({ kind: "creature" })))).toMatch(/needs a kind/);
    expect(codexProblem(codex(entry({ name: "" })))).toMatch(/needs a name/);
    expect(codexProblem(codex(entry({ name: "a".repeat(MAX_CODEX_NAME + 1) })))).toMatch(
      /needs a name/,
    );
    expect(codexProblem(codex(entry({ name: "two\nlines" })))).toMatch(/needs a name/);
  });

  it("refuses unknown keys on an entry", () => {
    expect(codexProblem(codex(entry({ secret: "x" })))).toMatch(/unknown key "secret"/);
  });

  it("refuses aliases that are not single lines, too many, or repeated", () => {
    expect(codexProblem(codex(entry({ aliases: "Mara" })))).toMatch(/needs aliases/);
    expect(codexProblem(codex(entry({ aliases: ["a".repeat(MAX_CODEX_ALIAS + 1)] })))).toMatch(
      /alias 1/,
    );
    expect(codexProblem(codex(entry({ aliases: ["Mara", "mara"] })))).toMatch(/repeats "mara"/);
    expect(
      codexProblem(
        codex(entry({ aliases: Array.from({ length: MAX_CODEX_ALIASES + 1 }, (_, i) => `a${i}`) })),
      ),
    ).toMatch(/the most one entry may hold/);
  });

  it("refuses a summary or a body that is too long", () => {
    expect(codexProblem(codex(entry({ summary: "a".repeat(MAX_CODEX_SUMMARY + 1) })))).toMatch(
      /summary/,
    );
    expect(codexProblem(codex(entry({ body: "a".repeat(MAX_CODEX_BODY + 1) })))).toMatch(/body/);
    expect(codexProblem(codex(entry({ body: 7 })))).toMatch(/body/);
  });

  it("refuses an image outside the project's assets", () => {
    expect(codexProblem(codex(entry({ image: "/etc/passwd" })))).toMatch(/image/);
    expect(codexProblem(codex(entry({ image: "assets/mara.png" })))).toBeNull();
    expect(codexProblem(codex(entry({ image: null })))).toBeNull();
  });

  it("refuses links that are not http, https or mailto", () => {
    expect(codexProblem(codex(entry({ links: ["javascript:alert(1)"] })))).toMatch(/link 1/);
    expect(codexProblem(codex(entry({ links: "https://example.test" })))).toMatch(/needs links/);
    expect(
      codexProblem(
        codex(
          entry({ links: Array.from({ length: MAX_CODEX_LINKS + 1 }, () => "https://e.test") }),
        ),
      ),
    ).toMatch(/the most one entry may hold/);
    expect(codexProblem(codex(entry({ links: ["mailto:mara@example.test"] })))).toBeNull();
  });

  it("refuses a repeated id or a repeated name", () => {
    expect(codexProblem(codex(entry(), entry({ name: "Ada" })))).toMatch(/repeats the id "mara"/);
    expect(codexProblem(codex(entry(), entry({ id: "ada", name: "mara" })))).toMatch(
      /repeats the name/,
    );
    expect(
      codexProblem(codex(entry(), entry({ id: "ada", name: "Ada", aliases: ["Mara Vane"] }))),
    ).toMatch(/repeats the name/);
  });

  it("refuses more entries than the codex may hold", () => {
    const many = Array.from({ length: MAX_CODEX_ENTRIES + 1 }, (_, i) =>
      entry({ id: `e${i}`, name: `E${i}`, aliases: [] }),
    );
    expect(codexProblem({ entries: many })).toMatch(/the most the codex may hold/);
  });
});

describe("codexEntry and isCodexFile", () => {
  it("finds an entry by id, and nothing without one", () => {
    const file = { entries: [entry() as never] };
    expect(codexEntry(file, "mara")?.name).toBe("Mara");
    expect(codexEntry(file, "ada")).toBeNull();
    expect(codexEntry(file, null)).toBeNull();
    expect(codexEntry(null, "mara")).toBeNull();
  });

  it("narrows a valid file", () => {
    expect(isCodexFile(codex(entry()))).toBe(true);
    expect(isCodexFile({ entries: [{ id: "x" }] })).toBe(false);
  });

  it("asserts a valid file and names the problem otherwise", () => {
    expect(() => assertCodexFile(codex(entry()))).not.toThrow();
    expect(() => assertCodexFile({ entries: [{}] })).toThrow(/invalid codex file: entry 1/);
  });
});
