import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CURRENT_FORMAT_VERSION,
  MAX_GLOSSARY_ENTRIES,
  MAX_INDEX_HIDDEN,
  createManifest,
  defaultGlossarySettings,
  defaultIndexSettings,
  parseManifest,
  readingOrder,
  serializeManifest,
  validateGlossarySettings,
  validateIndexSettings,
  validateManifest,
  type Manifest,
} from "../index";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const base = (): Manifest => createManifest({ title: "T", author: "A", identifier: "urn:uuid:1" });

describe("validateIndexSettings", () => {
  it("fills every default for an empty object and keeps what is given", () => {
    expect(validateIndexSettings({})).toEqual(defaultIndexSettings());
    const all = {
      enabled: true,
      heading: "Subject index",
      columns: 1,
      ranges: false,
      letterHeadings: false,
      hideSingles: true,
      hidden: ["Orchard"],
    };
    expect(validateIndexSettings(all)).toEqual(all);
  });

  it("refuses what is not an object and unknown keys", () => {
    for (const bad of [null, [], "x", 3])
      expect(() => validateIndexSettings(bad)).toThrow(/must be an object/);
    expect(() => validateIndexSettings({ enable: true })).toThrow(/unknown key "index.enable"/);
  });

  it("refuses values of the wrong type, naming the field", () => {
    expect(() => validateIndexSettings({ enabled: "yes" })).toThrow(
      /index\.enabled" must be true or false/,
    );
    expect(() => validateIndexSettings({ ranges: 1 })).toThrow(/index\.ranges/);
    expect(() => validateIndexSettings({ heading: " " })).toThrow(/index\.heading/);
    expect(() => validateIndexSettings({ heading: "a\nb" })).toThrow(/index\.heading/);
    expect(() => validateIndexSettings({ heading: "x".repeat(101) })).toThrow(/index\.heading/);
    expect(() => validateIndexSettings({ heading: 4 })).toThrow(/index\.heading/);
    expect(() => validateIndexSettings({ columns: 3 })).toThrow(/index\.columns" must be 1 or 2/);
    expect(() => validateIndexSettings({ hidden: "Orchard" })).toThrow(/index\.hidden/);
    expect(() => validateIndexSettings({ hidden: [""] })).toThrow(/index\.hidden/);
    expect(() =>
      validateIndexSettings({
        hidden: Array.from({ length: MAX_INDEX_HIDDEN + 1 }, (_, i) => `t${i}`),
      }),
    ).toThrow(/index\.hidden/);
  });

  it("names the field with a custom name", () => {
    expect(() => validateIndexSettings({ columns: 9 }, "x")).toThrow(/x\.columns/);
  });
});

describe("validateGlossarySettings", () => {
  const entry = { id: "harbour", term: "Harbour", definition: "Where boats tie up." };

  it("fills every default for an empty object and keeps entries with aliases", () => {
    expect(validateGlossarySettings({})).toEqual(defaultGlossarySettings());
    const all = {
      enabled: true,
      heading: "Terms",
      order: "added",
      inIndex: true,
      markFirstUse: false,
      showUndefined: true,
      entries: [
        { ...entry, aliases: ["harbours"] },
        { id: "tide", term: "Tide", definition: "" },
      ],
    };
    expect(validateGlossarySettings(all)).toEqual(all);
  });

  it("refuses what is not an object and unknown keys", () => {
    for (const bad of [null, [], "x"])
      expect(() => validateGlossarySettings(bad)).toThrow(/must be an object/);
    expect(() => validateGlossarySettings({ entry: [] })).toThrow(/unknown key "glossary.entry"/);
    expect(() => validateGlossarySettings({ entries: [{ ...entry, note: "x" }] })).toThrow(
      /unknown key "glossary.entries\[0\].note"/,
    );
  });

  it("refuses bad settings, naming the field", () => {
    expect(() => validateGlossarySettings({ enabled: 1 })).toThrow(/glossary\.enabled/);
    expect(() => validateGlossarySettings({ heading: "" })).toThrow(/glossary\.heading/);
    expect(() => validateGlossarySettings({ heading: "a\rb" })).toThrow(/glossary\.heading/);
    expect(() => validateGlossarySettings({ heading: "x".repeat(101) })).toThrow(
      /glossary\.heading/,
    );
    expect(() => validateGlossarySettings({ heading: 3 })).toThrow(/glossary\.heading/);
    expect(() => validateGlossarySettings({ order: "zigzag" })).toThrow(/glossary\.order/);
    expect(() => validateGlossarySettings({ entries: "x" })).toThrow(/glossary\.entries/);
    expect(() =>
      validateGlossarySettings({
        entries: Array.from({ length: MAX_GLOSSARY_ENTRIES + 1 }, (_, i) => ({
          ...entry,
          id: `e${i}`,
        })),
      }),
    ).toThrow(/at most 2000 entries/);
  });

  it("refuses a bad entry, naming where it is", () => {
    const at = (e: unknown) => () => validateGlossarySettings({ entries: [e] });
    expect(at(null)).toThrow(/entries\[0\]" must be an object/);
    expect(at([])).toThrow(/must be an object/);
    expect(at({ ...entry, id: "1 bad" })).toThrow(/entries\[0\]\.id/);
    expect(at({ ...entry, term: "" })).toThrow(/entries\[0\]\.term/);
    expect(at({ ...entry, term: "x".repeat(121) })).toThrow(/entries\[0\]\.term/);
    expect(at({ ...entry, definition: 4 })).toThrow(/entries\[0\]\.definition/);
    expect(at({ ...entry, definition: "x".repeat(2001) })).toThrow(/entries\[0\]\.definition/);
    expect(at({ ...entry, aliases: "x" })).toThrow(/entries\[0\]\.aliases/);
    expect(at({ ...entry, aliases: [""] })).toThrow(/entries\[0\]\.aliases/);
    expect(at({ ...entry, aliases: Array.from({ length: 13 }, (_, i) => `a${i}`) })).toThrow(
      /entries\[0\]\.aliases/,
    );
  });

  it("refuses two entries with the same id", () => {
    expect(() =>
      validateGlossarySettings({ entries: [entry, { ...entry, term: "Other" }] }),
    ).toThrow(/duplicate glossary id "harbour"/);
  });
});

describe("index and glossary in the manifest (formatVersion 14)", () => {
  it("has neither by default and writes neither", () => {
    const m = base();
    expect(m.index).toBeUndefined();
    expect(m.glossary).toBeUndefined();
    const json = JSON.parse(serializeManifest(m));
    expect(json).not.toHaveProperty("index");
    expect(json).not.toHaveProperty("glossary");
  });

  it("keeps both through a save and a reopen", () => {
    const m: Manifest = {
      ...base(),
      index: { ...defaultIndexSettings(), enabled: true, hidden: ["Wall"] },
      glossary: {
        ...defaultGlossarySettings(),
        enabled: true,
        entries: [{ id: "harbour", term: "Harbour", definition: "Where boats tie up." }],
      },
    };
    const again = parseManifest(serializeManifest(m));
    expect(again.migrated).toBe(false);
    expect(again.manifest.index).toEqual(m.index);
    expect(again.manifest.glossary).toEqual(m.glossary);
  });

  it("refuses bad settings inside the manifest", () => {
    expect(() => validateManifest({ ...base(), index: { columns: 5 } })).toThrow(/index\.columns/);
    expect(() => validateManifest({ ...base(), glossary: "x" })).toThrow(
      /glossary" must be an object/,
    );
  });
});

describe("migration v13 -> v14 (a real v13 manifest)", () => {
  const v13Json = read("../../../../fixtures/contract/manifest-v13.json");

  it("opens an older manifest with no index or glossary, upgrades it and loses no content", () => {
    const v13 = JSON.parse(v13Json);
    expect(v13.formatVersion).toBe(13);
    expect(v13).not.toHaveProperty("index");
    expect(v13).not.toHaveProperty("glossary");

    const r = parseManifest(v13Json);
    expect(r.migrated).toBe(true);
    expect(r.fromVersion).toBe(13);
    expect(r.manifest.formatVersion).toBe(CURRENT_FORMAT_VERSION);
    expect(r.manifest.index).toBeUndefined();
    expect(r.manifest.glossary).toBeUndefined();

    expect(readingOrder(r.manifest).map((e) => e.id)).toEqual(
      [...v13.frontMatter, ...v13.chapters, ...v13.backMatter].map((e: { id: string }) => e.id),
    );
    expect(r.manifest.goal).toEqual(v13.goal);
    expect(r.manifest.references).toEqual(v13.references);
    expect(r.manifest.editions[0]).toEqual(
      expect.objectContaining({ title: v13.editions[0].title }),
    );
    expect(r.manifest.template).toBe(v13.template);
    expect(r.manifest.trimSize).toBe(v13.trimSize);
  });

  it("reopens as the current version without migrating again", () => {
    const first = parseManifest(v13Json);
    const again = parseManifest(serializeManifest(first.manifest));
    expect(again.migrated).toBe(false);
    expect(again.manifest).toEqual(first.manifest);
  });
});
