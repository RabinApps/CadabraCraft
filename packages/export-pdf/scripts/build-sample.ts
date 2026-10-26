// Renders the full fixture manuscript to out/sample-<template>.pdf (and the .typ source) with the real package.
// Usage: pnpm --filter @cadabracraft/export-pdf build:sample [templateId] [trimSize]
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFullBook } from "../src/fixtures";
import { createNodeRunner } from "../src/node";
import { buildTypstDocument, renderPdf, type TrimSize } from "../src/index";

const template = process.argv[2] ?? "novel";
const trimSize = (process.argv[3] ?? "6x9") as TrimSize;
const { book, chapters, assets } = loadFullBook();
const out = new URL("../../../out/", import.meta.url);
mkdirSync(out, { recursive: true });

const options = { template, trimSize, assets, pdfA: true };
const res = await renderPdf(book, chapters, options, createNodeRunner());
// Also leave the .typ source (with the fonts that were actually chosen) and its images next to the PDF,
// so `typst compile --format png` works on it.
const typ = buildTypstDocument(book, chapters, options, res.fonts);
writeFileSync(new URL(`sample-${template}.typ`, out), typ.source);
for (const [src, rel] of typ.images) {
  const target = fileURLToPath(new URL(rel, out));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, assets[src]!);
}
writeFileSync(new URL(`sample-${template}.pdf`, out), res.pdf);
console.log(`wrote out/sample-${template}.pdf (${res.pdf.length} bytes) fonts: ${res.fonts.body} / ${res.fonts.heading}`);
