import { bridge } from "../bridge";
import type { StatsIo } from "./statsFile";

/** The stats file of the open book, through the same read and write commands as the chapters (temp file and rename in Rust). */
export const bridgeStatsIo = (root: string): StatsIo => ({
  read: (path) => bridge.readFile(root, path),
  write: (path, contents, baseHash) => bridge.writeFile(root, path, contents, baseHash),
});
