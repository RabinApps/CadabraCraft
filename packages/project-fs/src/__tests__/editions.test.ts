import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseManifest, type EditionEntry } from "@cadabracraft/format";
import { createProject, entryPath, readEntryFile, MANIFEST } from "../index";

const contract = (name: string) =>
  readFileSync(new URL(`../../../../fixtures/contract/${name}.json`, import.meta.url), "utf8");

/** A v4 project folder from the shared fixture, with the source chapter file and no French file yet. */
function v4Project() {
  const root = mkdtempSync(join(tmpdir(), "cadabra-editions-"));
  const json = contract("manifest-v4");
  createProject(root, json);
  mkdirSync(join(root, "manuscript"), { recursive: true });
  writeFileSync(join(root, "manuscript/001-chapter-one.json"), "english");
  return { root, manifest: parseManifest(json).manifest };
}

describe("per-language paths", () => {
  it("reads the source file at its stored path", () => {
    const { root, manifest } = v4Project();
    const ch1 = manifest.chapters[0]!;
    expect(readEntryFile(root, ch1, "en")?.contents).toBe("english");
    expect(entryPath(root, ch1, "en")).toBe(join(root, "manuscript/001-chapter-one.json"));
  });

  it("has no path or file for a language that has no translation of the entry yet", () => {
    const { root, manifest } = v4Project();
    const ch2 = manifest.chapters[1]!;
    expect(entryPath(root, ch2, "fr")).toBeNull();
    expect(readEntryFile(root, ch2, "fr")).toBeNull();
  });

  it("reads a translation at the path the manifest records, and null while the file is missing", () => {
    const { root, manifest } = v4Project();
    const ch1 = manifest.chapters[0]!;
    expect(readEntryFile(root, ch1, "fr")).toBeNull();
    mkdirSync(join(root, "manuscript/fr"), { recursive: true });
    writeFileSync(join(root, "manuscript/fr/001-chapitre-un.json"), "français");
    expect(readEntryFile(root, ch1, "fr")?.contents).toBe("français");
    expect(entryPath(root, ch1, "fr")).toBe(join(root, "manuscript/fr/001-chapitre-un.json"));
  });

  it("refuses a recorded translation path that leaves the project", () => {
    const { root, manifest } = v4Project();
    const evil: EditionEntry = {
      ...manifest.chapters[0]!,
      files: { en: "manuscript/001-chapter-one.json", fr: "../outside.json" },
    };
    expect(() => entryPath(root, evil, "fr")).toThrow();
    expect(() => readEntryFile(root, evil, "fr")).toThrow();
  });

  it("keeps cadabra.json in the project folder", () => {
    const { root } = v4Project();
    expect(readFileSync(join(root, MANIFEST), "utf8")).toBe(contract("manifest-v4"));
  });
});
