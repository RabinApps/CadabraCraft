// Throwaway spike (not shipped): render fixtures/manuscripts/full-book.json to one WAV per chapter with Kokoro-82M.
// Setup: cd tools/audio-spike && npm i kokoro-js (gitignored). Usage: node scripts/audio-spike/kokoro.mjs [maxChars]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const root = new URL("../../", import.meta.url);
const require = createRequire(new URL("tools/audio-spike/", root));
const { KokoroTTS } = await import(pathToFileURL(require.resolve("kokoro-js")).href);

const SKIP = new Set(["footnote", "codeBlock", "image", "table"]);
const BLOCK = new Set(["paragraph", "heading", "listItem", "blockquote"]);

/** Plain narration text for a TipTap doc: skips nodes a listener cannot use. */
function narrate(node, out = []) {
  if (SKIP.has(node.type)) return out;
  if (node.type === "sceneBreak") out.push("\n");
  if (node.type === "text") out.push(node.text);
  for (const c of node.content ?? []) narrate(c, out);
  if (BLOCK.has(node.type)) out.push("\n");
  return out;
}

/** 16-bit mono PCM WAV. */
function wavBytes(pcm, rate) {
  const buf = Buffer.alloc(44 + pcm.length * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + pcm.length * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(pcm.length * 2, 40);
  pcm.forEach((v, i) =>
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2),
  );
  return buf;
}

const book = JSON.parse(readFileSync(new URL("fixtures/manuscripts/full-book.json", root), "utf8"));
const maxChars = Number(process.argv[2] ?? 1500); // keep the spike short; 0 = whole chapter
const outDir = new URL("tools/audio-spike/out/", root);
mkdirSync(outDir, { recursive: true });

const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
  dtype: "q8",
  device: "cpu",
});

let totalAudio = 0;
let totalWall = 0;
for (const [i, ch] of book.chapters.entries()) {
  let text =
    `${ch.title}.\n` +
    narrate(ch.doc)
      .join("")
      .replace(/[ \t]+/g, " ")
      .trim();
  if (maxChars) text = text.slice(0, maxChars);
  const t0 = performance.now();
  // One generate() call caps at ~510 tokens and silently drops the rest, so render sentence by sentence.
  const sentences =
    text
      .match(/[^.!?\n]+[.!?]*/g)
      ?.map((s) => s.trim())
      .filter(Boolean) ?? [];
  const parts = [];
  let rate = 24000;
  for (const s of sentences) {
    const a = await tts.generate(s, { voice: "af_heart" });
    rate = a.sampling_rate;
    parts.push(a.audio);
  }
  const pcm = new Float32Array(parts.reduce((n, p) => n + p.length + rate / 4, 0)); // 0.25 s gap between sentences
  let at = 0;
  for (const p of parts) {
    pcm.set(p, at);
    at += p.length + rate / 4;
  }
  const wall = (performance.now() - t0) / 1000;
  const secs = pcm.length / rate;
  writeFileSync(new URL(`kokoro-${i + 1}.wav`, outDir), wavBytes(pcm, rate));
  totalAudio += secs;
  totalWall += wall;
  console.log(
    `ch${i + 1} "${ch.title}": ${text.length} chars -> ${secs.toFixed(1)} s audio in ${wall.toFixed(1)} s (RTF ${(wall / secs).toFixed(2)})`,
  );
}
console.log(
  `total ${totalAudio.toFixed(1)} s audio, ${totalWall.toFixed(1)} s wall, RTF ${(totalWall / totalAudio).toFixed(2)}`,
);
