import { describe, expect, it } from "vitest";
import {
  addBackMatter,
  canAddMatter,
  createManifest,
  parseManifest,
  serializeManifest,
  starterTitle,
} from "../index";

const base = () => createManifest({ title: "T", author: "A", identifier: "urn:uuid:1" });

describe("index and glossary pages in the back matter (formatVersion 15)", () => {
  it("adds one of each, once, and switches the list on", () => {
    const withIndex = addBackMatter(base(), "index", "Index");
    expect(withIndex.entry.kind).toBe("index");
    expect(withIndex.manifest.index?.enabled).toBe(true);
    expect(withIndex.manifest.glossary).toBeUndefined();
    const both = addBackMatter(withIndex.manifest, "glossary", "Glossary").manifest;
    expect(both.glossary?.enabled).toBe(true);
    expect(both.backMatter.map((e) => e.kind)).toEqual(["index", "glossary"]);
    expect(canAddMatter(both, "index")).toBe(false);
    expect(canAddMatter(both, "glossary")).toBe(false);
    expect(() => addBackMatter(both, "index", "Index")).toThrow(/already has/);
  });

  it("keeps the settings the author already chose", () => {
    const m = addBackMatter(base(), "index", "Index").manifest;
    const chosen = {
      ...m,
      index: { ...m.index!, enabled: false, heading: "Names", columns: 1 as const },
    };
    const again = addBackMatter({ ...chosen, backMatter: [] }, "index", "Index").manifest;
    expect(again.index).toMatchObject({ enabled: true, heading: "Names", columns: 1 });
  });

  it("is not a front matter kind, and saves and reopens as version 15", () => {
    expect(() => addBackMatter(base(), "contents", "C")).toThrow();
    const m = addBackMatter(base(), "glossary", "Glossary").manifest;
    const r = parseManifest(serializeManifest(m));
    expect(r.migrated).toBe(false);
    expect(r.manifest.formatVersion).toBe(15);
    expect(r.manifest.backMatter[0]!.kind).toBe("glossary");
  });

  it("opens a version 14 book unchanged apart from the version", () => {
    const old = { ...JSON.parse(serializeManifest(base())), formatVersion: 14 };
    const r = parseManifest(JSON.stringify(old));
    expect(r.migrated).toBe(true);
    expect(r.manifest.formatVersion).toBe(15);
  });

  it("names the pages in the book's language", () => {
    expect(starterTitle("index", "en")).toBe("Index");
    expect(starterTitle("glossary", "de")).toBe("Glossar");
    expect(starterTitle("index", "fr")).toBe("Index");
  });
});
