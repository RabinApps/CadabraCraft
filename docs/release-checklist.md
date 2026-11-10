# Release checklist (first dry run and updater round trip)

Back to the [docs index](README.md). Release design and rejected alternatives: [architecture.md](architecture.md), "Updates and releases". Open questions: [roadmap.md](roadmap.md).

Versions are all `0.0.0` on purpose until the first release. Nothing below has been run yet; each step says what to confirm.

## What the release builds

| Platform | Bundles (`bundle.targets`) | Updater artifact (signed) |
| -------- | -------------------------- | ------------------------- |
| macOS    | universal `.app`, `.dmg`   | `.app.tar.gz` and `.sig`  |
| Linux    | `.AppImage`                | `.AppImage` and `.sig`    |

`latest.json` should list `darwin-aarch64`, `darwin-x86_64` and `linux-x86_64` (no Windows entry: Windows is coming soon), each with a URL and a signature. Confirm this in step 4; the keys were never seen.

## Secrets (repository settings, Actions)

- `TAURI_SIGNING_PRIVATE_KEY`: the minisign private key for update payloads (content of the key file, or its path is not accepted in CI; paste the content).
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: its password (leave empty only if the key has none).
- macOS signing (Developer ID, hardened runtime):
  - `APPLE_CERTIFICATE`: the Developer ID Application certificate, exported as a base64 `.p12`.
  - `APPLE_CERTIFICATE_PASSWORD`: the password of that `.p12`.
  - `APPLE_SIGNING_IDENTITY`: the identity name of that certificate, as `codesign` lists it.
- macOS notarization, recommended: an App Store Connect API key. `APPLE_API_ISSUER` (the issuer id), `APPLE_API_KEY` (the key id), and `APPLE_API_PRIVATE_KEY` (the full contents of the `.p8` key file). The workflow writes the key to a temporary file on the runner and sets `APPLE_API_KEY_PATH` to it; it deletes the file at the end of the job (see `release.yml`).
- macOS notarization, alternative: an Apple ID with an app-specific password. `APPLE_ID`, `APPLE_PASSWORD` (the app-specific password, never the Apple ID password), `APPLE_TEAM_ID`. Use it only when no API key is available. The reason for the choice is in architecture.md, "Updates and releases".
- Windows signing (Azure Trusted Signing through a `signCommand` in the Windows config plus its credentials) is needed only when Windows ships.
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
3. **Collect the artifacts.** Each job uploads `cadabracraft-<runner>` with everything under `target/**/bundle/`. Confirm: the `.dmg`, `.app.tar.gz` and `.sig` on macOS; the `.AppImage` and `.sig` on Linux; and no `.deb`, `.rpm` or `.msi`.
4. **Check the bundles.** On each OS install or run the artifact and confirm the app starts, the sidecars work (Typst PDF export, voices list, M4B encode) and `licenses/` is present. On macOS, run the checks in "Verify a notarized .dmg" below. Confirm the binary is universal: `lipo -archs CadabraCraft.app/Contents/MacOS/CadabraCraft` and the same for the `typst`, `sherpa-onnx-offline-tts` and `ffmpeg` sidecars. On Linux run the AppImage (needs `libfuse2`).
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

## Known gaps

- Windows is not in the first release: add `windows-latest` back to the `release.yml` matrix, the `windows-x86_64` updater entry and the website Windows card ("Coming soon") together when it ships.
- Runner labels (`kinhin-container`, `kinhin-xcode`): see architecture.md, "Updates and releases", for what they must provide and the hosted-runner replacements.
- A `.deb`, `.rpm` or `.msi` is not built; see the open question in the roadmap.
