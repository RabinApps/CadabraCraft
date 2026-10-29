// Test media for measure-references.ts: generated videos (ffmpeg on PATH or the repo sidecar) and padding to a size.
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, statSync, openSync, writeSync, closeSync } from "node:fs";
import { join } from "node:path";
import { assert } from "./scenario/context.ts";

export const MB = 1024 * 1024;

function ffmpegPath(repo: string) {
  if (spawnSync("ffmpeg", ["-version"]).status === 0) return "ffmpeg";
  const side = join(repo, "apps/desktop/src-tauri/binaries/ffmpeg-aarch64-apple-darwin");
  if (existsSync(side)) return side;
  throw new Error("ffmpeg is not installed and the sidecar is missing; nothing is downloaded");
}
export function makeVideo(repo: string, file: string, extra: string[]) {
  execFileSync(
    ffmpegPath(repo),
    [
      "-y",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=1280x720:rate=30:duration=30",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=30",
      ...extra,
      "-c:a",
      "aac",
      "-g",
      "30",
      "-keyint_min",
      "30",
      "-sc_threshold",
      "0",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-shortest",
      file,
    ],
    { stdio: "inherit" },
  );
}
/** Appends a top-level `free` box (ignored by players) so the file is `mb` MB while staying a valid mp4. */
export function padMp4(file: string, mb: number) {
  const need = mb * MB - statSync(file).size - 8;
  assert(need > 0 && need < 2 ** 32, "cannot pad to that size");
  const fd = openSync(file, "a");
  const hdr = Buffer.alloc(8);
  hdr.writeUInt32BE(need + 8, 0);
  hdr.write("free", 4, "latin1");
  writeSync(fd, hdr);
  const block = randomBytes(MB);
  for (let left = need; left > 0; left -= block.length)
    writeSync(fd, block, 0, Math.min(left, block.length));
  closeSync(fd);
}
