#!/usr/bin/env node
// Keeps the app version in one place: tauri.conf.json is the source; Cargo.toml and package.json must match it.
//   node scripts/set-version.mjs 0.1.0        write the version to all three files
//   node scripts/set-version.mjs --check      fail if the files disagree
//   node scripts/set-version.mjs --check v0.1.0   also fail if the git tag does not match
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  tauri: resolve(root, "apps/desktop/src-tauri/tauri.conf.json"),
  cargo: resolve(root, "apps/desktop/src-tauri/Cargo.toml"),
  pkg: resolve(root, "apps/desktop/package.json"),
};
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

function readVersions() {
  const tauri = JSON.parse(readFileSync(files.tauri, "utf8")).version;
  // The [package] table is the first `version = "..."` line in Cargo.toml.
  const cargo = readFileSync(files.cargo, "utf8").match(/^version = "([^"]+)"/m)?.[1];
  const pkg = JSON.parse(readFileSync(files.pkg, "utf8")).version;
  return { tauri, cargo, pkg };
}

function writeVersion(version) {
  const tauriText = readFileSync(files.tauri, "utf8");
  writeFileSync(files.tauri, tauriText.replace(/("version":\s*)"[^"]*"/, `$1"${version}"`));
  const cargoText = readFileSync(files.cargo, "utf8");
  writeFileSync(files.cargo, cargoText.replace(/^version = "[^"]*"/m, `version = "${version}"`));
  const pkgText = readFileSync(files.pkg, "utf8");
  writeFileSync(files.pkg, pkgText.replace(/("version":\s*)"[^"]*"/, `$1"${version}"`));
}

function fail(message) {
  console.error(`set-version: ${message}`);
  process.exit(1);
}

const [arg, tag] = process.argv.slice(2);
if (!arg) fail("usage: set-version.mjs <semver> | --check [vX.Y.Z]");

if (arg === "--check") {
  const versions = readVersions();
  const values = Object.values(versions);
  if (values.some((v) => v !== values[0])) {
    fail(`versions disagree: tauri ${versions.tauri}, Cargo ${versions.cargo}, package ${versions.pkg}`);
  }
  if (tag !== undefined && tag !== `v${versions.tauri}`) {
    fail(`tag ${tag} does not match version ${versions.tauri}`);
  }
  console.log(`set-version: ${versions.tauri} ok`);
} else {
  if (!SEMVER.test(arg)) fail(`not a semver version: ${arg}`);
  writeVersion(arg);
  console.log(`set-version: wrote ${arg}`);
}
