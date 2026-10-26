import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { buildEpub } from "../src/index";

const doc = JSON.parse(readFileSync("../../fixtures/manuscripts/sample-chapter.json", "utf8"));
const bytes = buildEpub(
  { title: "Sample Book", author: "Test Author", language: "en", identifier: "urn:uuid:5b1d1d2c-6f0a-4c43-9a55-1f0d3c8d3a11", modified: new Date() },
  [{ id: "ch1", title: "Chapter One", doc }],
  { cover: { path: "assets/cover.png", bytes: new Uint8Array(readFileSync("../../fixtures/assets/pixel.png")) } },
);
mkdirSync("../../out", { recursive: true });
writeFileSync("../../out/sample.epub", bytes);
console.log("wrote out/sample.epub", bytes.length, "bytes");
