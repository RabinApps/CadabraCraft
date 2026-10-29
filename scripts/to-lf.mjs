#!/usr/bin/env node
// Rewrites the given files with LF line endings (license texts from crates and packages sometimes use CRLF).
import { readFileSync, writeFileSync } from "node:fs";

for (const file of process.argv.slice(2)) {
  writeFileSync(file, readFileSync(file, "utf8").replace(/\r\n/g, "\n"));
}
