# Release checklist (first dry run and updater round trip)

Back to the [docs index](README.md). Release design and rejected alternatives: [architecture.md](architecture.md), "Updates and releases". Open questions: [roadmap.md](roadmap.md).

The version files say `0.1.0` (checked 2026-11-19 with `node scripts/set-version.mjs --check`). Nothing below has been run yet; each step says what to confirm.

## What the release builds

| Platform | Bundles                                                         | Updater artifact (signed)   |
| -------- | --------------------------------------------------------------- | --------------------------- |
| macOS    | universal `.app`, `.dmg`                                        | `.app.tar.gz` and `.sig`    |
| Windows  | NSIS `.exe` (x86-64; WebView2 bootstrapper embedded)            | the same `.exe` and `.sig`  |
| Linux    | `.AppImage` (x86_64 on Blacksmith, arm64 on `kinhin-container`) | `.AppImage` and `.sig` each |

`bundle.targets` in `tauri.conf.json` is `app`, `dmg` and `appimage`; `tauri.windows.conf.json` replaces it with `nsis` on Windows, because `nsis` is the one target Tauri would otherwise try to build on every host (the macOS job's universal target fails it, see architecture.md, "Explicit bundle targets").

`latest.json` should list `darwin-aarch64`, `darwin-x86_64`, `windows-x86_64`, `linux-x86_64` and `linux-aarch64`, each with a URL and a signature. Confirm this in step 4; the keys were never seen.

## Secrets (repository settings, Actions)

- `TAURI_SIGNING_PRIVATE_KEY`: the minisign private key for update payloads (content of the key file, or its path is not accepted in CI; paste the content).
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: its password (leave empty only if the key has none).
- macOS signing (Developer ID, hardened runtime):
  - `APPLE_CERTIFICATE`: the Developer ID Application certificate, exported as a base64 `.p12`.
  - `APPLE_CERTIFICATE_PASSWORD`: the password of that `.p12`.
  - `APPLE_SIGNING_IDENTITY`: the identity name of that certificate, as `codesign` lists it.
- macOS notarization, recommended: an App Store Connect API key. `APPLE_API_ISSUER` (the issuer id), `APPLE_API_KEY` (the key id), and `APPLE_API_PRIVATE_KEY` (the full contents of the `.p8` key file). The workflow writes the key to a temporary file on the runner and sets `APPLE_API_KEY_PATH` to it; it deletes the file at the end of the job (see `release.yml`).
- macOS notarization, alternative: an Apple ID with an app-specific password. `APPLE_ID`, `APPLE_PASSWORD` (the app-specific password, never the Apple ID password), `APPLE_TEAM_ID`. Use it only when no API key is available. The reason for the choice is in architecture.md, "Updates and releases".
- Windows signing, Azure Artifact Signing (formerly Trusted Signing) through `signCommand`; see "Windows signing" below:
  - `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_PROFILE`: the Artifact Signing account's endpoint (for example `https://wus2.codesigning.azure.net`), its account name and the certificate profile name. None of them is a secret in practice, but they live with the other release secrets.
  - Repository **variable** `ARTIFACT_SIGNING_CLI_VERSION`: the NuGet version of Microsoft's `sign` CLI (`sign code artifact-signing`) that the workflow installs with `dotnet tool install --tool-path … sign --version …`. A tagged release fails without it, on purpose: an unpinned signer is a supply-chain hole.
  - The signer's own credential (the service principal or workload identity that may sign with the certificate profile) is what the CLI reads from its environment; set it up as that tool documents, next to the tauri-action step.
- `GITHUB_TOKEN` is provided by Actions and needs `contents: write` (the workflow sets it).

### Check the signing key matches the public key without printing it

The public key in `apps/desktop/src-tauri/tauri.conf.json` (`plugins.updater.pubkey`) names a key id. A signature made with the private key carries the same id.

1. Put the private key in a local file outside the repo (never paste it into a terminal history or chat), for example `~/keys/cadabra.key`.
2. Sign a scratch file with it. The password is read from the prompt: `pnpm --filter @cadabracraft/desktop tauri signer sign -f ~/keys/cadabra.key /tmp/scratch.txt` (creates `/tmp/scratch.txt.sig`).
3. Compare the key ids. This prints only ids:

```sh
node -e '
const fs = require("fs");
const id = (b64) => Buffer.from(b64, "base64").subarray(2, 10).toString("hex");
const conf = JSON.parse(fs.readFileSync("apps/desktop/src-tauri/tauri.conf.json", "utf8"));
const pub = Buffer.from(conf.plugins.updater.pubkey, "base64").toString().split("\n")[1];
const sig = Buffer.from(fs.readFileSync("/tmp/scratch.txt.sig", "utf8").trim(), "base64").toString().split("\n")[1];
console.log(id(pub) === id(sig) ? "key ids match" : "KEY MISMATCH");
'
```

4. Delete `/tmp/scratch.txt*`. The GitHub secret must hold the same key as that file; to check, set the secret from this file, run the dry run, and see that the updater round trip in step 9 verifies. A mismatch shows up there as a signature error, never as a silent skip.

## Steps

1. **Check the version files.** `node scripts/set-version.mjs --check` must print `0.1.0 ok` (it fails if `tauri.conf.json`, `Cargo.toml` and `apps/desktop/package.json` disagree). The tag check in `release.yml` runs `--check vX.Y.Z` and only when the ref is a tag, so a dry run on a branch skips it.
2. **Dry run on a branch.** Push the branch, then Actions > release > Run workflow on that branch (`workflow_dispatch`). It runs CI first (`ci.yml`), then builds the three platforms. No tag means `tagName` is empty, so tauri-action creates no tag; confirm whether it still creates a draft release (it may) and delete such a draft if it appears.
3. **Collect the artifacts.** Each job uploads `cadabracraft-<runner>` with everything under `target/**/bundle/`. Confirm: the `.dmg`, `.app.tar.gz` and `.sig` on macOS; the `CadabraCraft_<version>_x64-setup.exe` and `.sig` on Windows; the `.AppImage` and `.sig` on Linux; and no `.deb`, `.rpm` or `.msi`.
4. **Check the bundles.** On each OS install or run the artifact and confirm the app starts, the sidecars work (Typst PDF export, voices list, M4B encode) and `licenses/` is present. On macOS, run the checks in "Verify a notarized .dmg" below. Confirm the binary is universal: `lipo -archs CadabraCraft.app/Contents/MacOS/CadabraCraft` and the same for the `typst`, `sherpa-onnx-offline-tts` and `ffmpeg` sidecars. On Windows run the installer on a clean Windows 11 VM, check that no console window appears next to the app, that **Check EPUB** reports a result (the bundled `jre/x86_64/bin/java.exe`), that no console window flashes during a PDF export, an audiobook render and a cancel, and that `Get-AuthenticodeSignature` on the installed `CadabraCraft.exe`, `typst.exe`, `ffmpeg.exe`, `sherpa-onnx-offline-tts.exe` and `jre\x86_64\bin\java.exe` says `Valid` with the publisher name. On Linux run the AppImage (needs `libfuse2`).
5. **Real release as 0.1.0 (draft).** The version files already say 0.1.0 (M8). Run `pnpm licenses:check` (it also runs in CI) and `pnpm licenses:update` if the notices are stale, commit, tag `v0.1.0`, push the tag. The tag check must pass. When the build finishes, open the draft release and confirm it holds the installers, the `.sig` files and `latest.json` with the four platform keys above. Do not publish yet.
6. **Publish 0.1.0.** Publish the draft. `https://github.com/RabinApps/cadabracraft/releases/latest/download/latest.json` should now resolve.
7. **Install 0.1.0** on each OS from the published assets (macOS `.dmg`, Linux AppImage started so that `APPIMAGE` is set). In Settings, "Check for updates" must say the app is up to date.
8. **Release 0.1.1 as a draft.** `node scripts/set-version.mjs 0.1.1`, commit, tag `v0.1.1`, push, wait for the draft. Do not publish yet: the installed 0.1.0 must still see no update.
9. **Publish 0.1.1 and update.** Publish the draft. In each installed 0.1.0, launch (or "Check for updates"), accept the update, let it install and relaunch, and confirm the About or Settings version reads 0.1.1. This proves the signature verifies against the public key in the app, the platform keys in `latest.json` are right, and each installer type updates in place (Windows NSIS in passive mode, macOS replaces the app, Linux replaces the AppImage).
10. **Fix forward.** If a platform fails, note the error here, fix, and release 0.1.2 rather than editing a published release. Delete the 0.1.0 and 0.1.1 test releases and tags afterwards if they should not be public (that is permanent; ask the maintainer first).

## Verify a notarized .dmg

Run these on a Mac after the macOS job. Mount the `.dmg` first (`hdiutil attach`) and check the app inside it, or copy the app to a scratch folder. Replace the placeholders with the real names.

```sh
# Signature of the app, all nested code, strict
codesign --verify --deep --strict --verbose=2 "<mounted volume>/CadabraCraft.app"
# Hardened runtime: the flags line must show flags=0x10000(runtime)
codesign -dv --verbose=4 "<mounted volume>/CadabraCraft.app"
# Notarization ticket is stapled to the .dmg and to the .app
xcrun stapler validate "<path to>/CadabraCraft.dmg"
xcrun stapler validate "<mounted volume>/CadabraCraft.app"
# Gatekeeper accepts the app and the disk image
spctl --assess --type execute -vv "<mounted volume>/CadabraCraft.app"
spctl --assess --type open --context context:primary-signature -vv "<path to>/CadabraCraft.dmg"
```

Then a clean-Mac check: on a Mac that has never run the app, download the `.dmg` in a browser (so the quarantine flag is set), open it, drag the app to Applications and launch it. It must open with no "unidentified developer" or "cannot be verified" dialog. Any of these failing means the release is not notarized; do not publish it.

## Windows signing

Wired on 2026-11-21, **never run**: no Windows bundle has signed a file.

`tauri.windows.release.conf.json` sets `bundle.windows.signCommand` to `{ cmd: "cmd", args: ["/c", "%CADABRA_SIGN_CMD%", "%1"] }`: Tauri replaces the `%1` argument with the file to sign (its `sign.rs` replaces an argument only when it is exactly `%1`), and `cmd` then expands the rest from the workflow's `CADABRA_SIGN_CMD`. That variable is `<abs path to sign.exe> code artifact-signing -ase <endpoint> -asa <account> -ascp <profile>`, built from the secrets above; the CLI is Microsoft's `sign`, installed by the workflow with `dotnet tool install --tool-path` so that the command names an absolute executable and no PATH entry has to agree with it. It finds its Azure identity through `DefaultAzureCredential` (the `AZURE_CLIENT_ID`/`AZURE_TENANT_ID`/`AZURE_CLIENT_SECRET` or federated-login variables of whatever principal may sign), which is set up outside this repo. There is deliberately **no script file on disk**: Tauri starts `signCommand` with `Command::new` (no shell) and only makes an argument absolute when it already exists relative to Tauri's own working directory, so a relative `.cmd` path could fail on the first bundle and a `.cmd` cannot be launched directly at all. `cmd` is always present, and an environment variable has no path to get wrong. The signing config is only passed (`WIN_SIGN_CONFIG`) when the secrets are set, so an unsigned dry run never reaches this command.

The workflow also signs the bundled Java runtime and sidecars before the bundle, because Tauri copies those in without signing them. Tauri still asks `signtool.exe` whether each bundled `.exe`/`.dll` is already signed (`should_sign` in `sign.rs`), and errors if it cannot find it, so the runner needs the Windows SDK's `signtool` even though the signing itself is ours; `windows-latest` ships it.

In the dry run, confirm on the Windows job:

- The "Windows signing setup" step installed the pinned CLI and printed no error.
- The "Sign the bundled Java runtime and sidecars" step signed every file and did not fail on one (a skipped step means `CADABRA_SIGN_CMD` was empty, i.e. the build is unsigned).
- The app binary and the installer carry a signature from the expected publisher (`Get-AuthenticodeSignature` on the installed files).
- The **uninstaller** is signed too: Tauri passes the same command to NSIS as `!uninstfinalize`, which NSIS runs through `system()`, so `%1` and the environment variable expand there. NSIS hands that command a temporary `.tmp` copy of the uninstaller, and `sign` may treat an unknown extension as not signable and exit 0 without signing it; check the installed `uninstall.exe` with `Get-AuthenticodeSignature`. If it comes out unsigned, either accept it or pin the signer to one that takes the path as given.
- The downloaded installer shows no "unrecognised app" block. A SmartScreen _warning_ ("Windows protected your PC") is expected until the publisher has reputation; a hard block is not, and means the signature is wrong.

If the first run shows the CLI's flags differ from the `CADABRA_SIGN_CMD` line in the "Windows signing setup" step, change that line and record it here; nothing else in the repo spells the signer out.

One limit of the `cmd` route: if the signer's own invocation needs quotes around an argument, put them in `CADABRA_SIGN_CMD` and expect `cmd` to parse the expanded line (a path with spaces is quoted by Tauri and survives).

## Known gaps

- Windows restated 2026-11-21: the matrix entry, the `windows-x86_64` updater key (it appears with the first Windows build that runs) and the website card are in place, but no Windows build has run, no Windows installer has been signed, and the real-device checks in [platform-checks.md](platform-checks.md) and [platform-checks-windows.md](platform-checks-windows.md) have not been done. Windows arm64 is not built (the installer is x86-64).
- Runner labels (Blacksmith `blacksmith-<n>vcpu-ubuntu-2404` for Linux, `blacksmith-6vcpu-macos-latest` for the macOS CI jobs, `kinhin-xcode` for the release workflow's signed macOS build): see architecture.md, "CI on Blacksmith runners" and the "Runner labels" entry before it, for what they must provide and the fallbacks.
- A `.deb`, `.rpm` or `.msi` is not built; see the open question in the roadmap.

## EPUB checker (EPUBCheck and its Java runtime)

- Temurin 17.0.21+9 for macOS (aarch64 and x86_64) is pinned in `pin_for` in `scripts/build-jre.sh` (2026-11-12, hashes computed from the downloads and equal to GitHub's published digests); `bash scripts/build-jre.sh --all` was run here and built both runtimes (57 and 58 MB; the arm64 one starts and runs EPUBCheck). Linux needs no pin: the release job builds its runtime from the JDK `setup-java` installs. Bump the pins when a newer 17 update is wanted.
- Confirm the bundle contains `epubcheck/epubcheck.jar`, `epubcheck/lib/` and `jre/<cpu>/bin/java` (macOS universal: both CPUs), and measure the installer sizes against the estimates in architecture.md ("EPUBCheck ships with the app").
- macOS: every Mach-O file in `jre/` (the `java` launcher and the `.dylib` files) must be signed with the hardened runtime, and `java` needs the JIT entitlements. Written 2026-11-12, never run: `apps/desktop/src-tauri/entitlements/java.entitlements.plist` (allow-jit and allow-unsigned-executable-memory; no disable-library-validation, because all dylibs get the same identity; add it only if a run shows a library-validation crash) and `scripts/sign-jre.sh "<identity>"`, which signs the libraries and then the executables. Wired into `release.yml` as "Sign the bundled Java runtime" (never run): `tauri-action` imports the certificate only when it builds, so that step imports it into a temporary keychain, runs the script, and deletes the keychain (and restores the search list) before `tauri-action` starts, so codesign never sees the identity twice. In the dry run, check that this step passes, that `codesign -dv --verbose=4` on `Contents/Resources/jre/*/bin/java` shows `flags=0x10000(runtime)`, and that `codesign -d --entitlements - ` on it lists the two JIT keys (Tauri's own pass over the bundle must not strip them). Not tested yet: install a notarized .dmg, export an EPUB and run **Check EPUB**; it must report a result, not "could not finish".
- Linux: run the AppImage and **Check EPUB** on a machine without Java installed.
- Run **Check EPUB** with the network off (it must not need one).
