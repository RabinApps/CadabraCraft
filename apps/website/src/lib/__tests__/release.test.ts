import { describe, expect, it } from "vitest";
import { appVersion, assetUrl, installers } from "../release";

describe("release links", () => {
  it("builds asset URLs from the version", () => {
    expect(assetUrl("1.2.3", "a.dmg")).toBe("https://github.com/RabinApps/cadabracraft/releases/download/v1.2.3/a.dmg");
  });

  it("links macOS and Linux and leaves Windows without a link", () => {
    const [mac, win, linux] = installers("0.1.0");
    expect(mac?.href).toMatch(/\/v0\.1\.0\/CadabraCraft_0\.1\.0_universal\.dmg$/);
    expect(linux?.href).toMatch(/\/v0\.1\.0\/CadabraCraft_0\.1\.0_amd64\.AppImage$/);
    expect(win?.name).toBe("Windows");
    expect(win?.href).toBeUndefined();
  });

  it("reads a semver from the desktop Tauri config", () => {
    expect(appVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
