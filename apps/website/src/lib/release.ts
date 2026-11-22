import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "@/lib/site";

export type Installer = {
  name: string;
  detail: string;
  /** Download URL of the installer on GitHub Releases; absent while the platform is not built for release. */
  href?: string;
  /** Label of the download button, e.g. "Download .dmg". */
  action?: string;
  /** Further downloads of the same platform (other CPU architectures), shown as secondary buttons. */
  alternates?: readonly { href: string; action: string }[];
};

/** The app version, read from the desktop app's Tauri config so the page and the release cannot disagree. */
export function appVersion(): string {
  const path = join(process.cwd(), "..", "desktop", "src-tauri", "tauri.conf.json");
  const version = (JSON.parse(readFileSync(path, "utf8")) as { version?: string }).version;
  if (!version) throw new Error(`no version in ${path}`);
  return version;
}

/** Asset URL for a release created by .github/workflows/release.yml (tag vX.Y.Z; Tauri names the files). */
export function assetUrl(version: string, file: string): string {
  return `${REPO}/releases/download/v${version}/${file}`;
}

/**
 * The three desktop targets, all built by release.yml. Tauri names the NSIS installer `CadabraCraft_<version>_x64-setup.exe`.
 */
export function installers(version: string): readonly Installer[] {
  return [
    {
      name: "macOS",
      detail: "Universal build for Apple silicon and Intel (.dmg), signed and notarized by Apple",
      href: assetUrl(version, `CadabraCraft_${version}_universal.dmg`),
      action: "Download for macOS",
    },
    {
      name: "Windows",
      detail: "Installer (.exe) for Windows 10 and 11 (64-bit), signed; WebView2 is installed if it is missing",
      href: assetUrl(version, `CadabraCraft_${version}_x64-setup.exe`),
      action: "Download for Windows",
    },
    {
      name: "Linux",
      detail: "AppImage for x86-64 and arm64. Make it executable, then run it",
      href: assetUrl(version, `CadabraCraft_${version}_amd64.AppImage`),
      action: "Download for Linux (x86-64)",
      alternates: [
        { href: assetUrl(version, `CadabraCraft_${version}_aarch64.AppImage`), action: "Download for Linux (arm64)" },
      ],
    },
  ];
}
