# Release checklist (first dry run and updater round trip)

Back to the [docs index](README.md). Release design and rejected alternatives: [architecture.md](architecture.md), "Updates and releases". Open questions: [roadmap.md](roadmap.md).

Versions are all `0.0.0` on purpose until the first release. Nothing below has been run yet; each step says what to confirm.

## What the release builds

| Platform | Bundles (`bundle.targets`)                   | Updater artifact (signed) |
| -------- | -------------------------------------------- | ------------------------- |
| macOS    | universal `.app`, `.dmg`                     | `.app.tar.gz` and `.sig`  |
| Windows  | NSIS `.exe` (WebView2 bootstrapper embedded) | NSIS `.exe` and `.sig`    |
| Linux    | `.AppImage`                                  | `.AppImage` and `.sig`    |

`latest.json` should list `darwin-aarch64`, `darwin-x86_64`, `windows-x86_64` and `linux-x86_64`, each with a URL and a signature. Confirm this in step 4; the keys were never seen.

## Secrets (repository settings, Actions)

- `TAURI_SIGNING_PRIVATE_KEY`: the minisign private key for update payloads (content of the key file, or its path is not accepted in CI; paste the content).
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: its password (leave empty only if the key has none).
- Not set up yet, add before a public release: Apple Developer ID and notarization (`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`) and Windows signing (Azure Trusted Signing through a `signCommand` in the Windows config plus its credentials). Without them macOS and Windows warn at first launch.
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

1. **Check the version files.** `node scripts/set-version.mjs --check` must print `0.0.0 ok` (it fails if `tauri.conf.json`, `Cargo.toml` and `apps/desktop/package.json` disagree). The tag check in `release.yml` runs `--check vX.Y.Z` and only when the ref is a tag, so a dry run on a branch skips it.
2. **Dry run on a branch.** Push the branch, then Actions > release > Run workflow on that branch (`workflow_dispatch`). It runs CI first (`ci.yml`), then builds the three platforms. No tag means `tagName` is empty, so tauri-action creates no tag; confirm whether it still creates a draft release (it may) and delete such a draft if it appears.
3. **Collect the artifacts.** Each job uploads `cadabracraft-<runner>` with everything under `target/**/bundle/`. Confirm: the `.dmg`, `.app.tar.gz` and `.sig` on macOS; the NSIS `.exe` and `.sig` on Windows; the `.AppImage` and `.sig` on Linux; and no `.deb`, `.rpm` or `.msi`.
4. **Check the bundles.** On each OS install or run the artifact and confirm the app starts, the sidecars work (Typst PDF export, voices list, M4B encode) and `licenses/` is present. Expect an OS warning on macOS and Windows (unsigned). On macOS confirm the binary is universal: `lipo -archs CadabraCraft.app/Contents/MacOS/CadabraCraft` and the same for the `typst`, `sherpa-onnx-offline-tts` and `ffmpeg` sidecars. On Windows confirm WebView2 is not required to be installed beforehand. On Linux run the AppImage (needs `libfuse2`).
5. **Real release as 0.1.0 (draft).** Set the version: `node scripts/set-version.mjs 0.1.0`, commit, tag `v0.1.0`, push the tag. The tag check must pass. When the build finishes, open the draft release and confirm it holds the installers, the `.sig` files and `latest.json` with the four platform keys above. Do not publish yet.
6. **Publish 0.1.0.** Publish the draft. `https://github.com/RabinApps/cadabracraft/releases/latest/download/latest.json` should now resolve.
7. **Install 0.1.0** on each OS from the published assets (macOS `.dmg`, Windows NSIS, Linux AppImage started so that `APPIMAGE` is set). In Settings, "Check for updates" must say the app is up to date.
8. **Release 0.1.1 as a draft.** `node scripts/set-version.mjs 0.1.1`, commit, tag `v0.1.1`, push, wait for the draft. Do not publish yet: the installed 0.1.0 must still see no update.
9. **Publish 0.1.1 and update.** Publish the draft. In each installed 0.1.0, launch (or "Check for updates"), accept the update, let it install and relaunch, and confirm the About or Settings version reads 0.1.1. This proves the signature verifies against the public key in the app, the platform keys in `latest.json` are right, and each installer type updates in place (Windows NSIS in passive mode, macOS replaces the app, Linux replaces the AppImage).
10. **Fix forward.** If a platform fails, note the error here, fix, and release 0.1.2 rather than editing a published release. Delete the 0.1.0 and 0.1.1 test releases and tags afterwards if they should not be public (that is permanent; ask the maintainer first).

## Known gaps

- No macOS notarization or Windows signing yet (see Secrets).
- Runner labels (`kinhin-container`, `kinhin-xcode`): see architecture.md, "Updates and releases", for what they must provide and the hosted-runner replacements.
- A `.deb`, `.rpm` or `.msi` is not built; see the open question in the roadmap.
