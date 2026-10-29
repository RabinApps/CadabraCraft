#!/usr/bin/env bash
# Runs `cargo test --lib` for the desktop crate. Usage (from apps/desktop/src-tauri): bash ../../../scripts/cargo-test.sh [test filter and flags]
# On Windows (MSVC) the unit-test executable needs a Common Controls 6 manifest or it fails to start
# (STATUS_ENTRYPOINT_NOT_FOUND: the dialog plugin imports TaskDialogIndirect, which only exists in comctl32 v6).
# build.rs cannot add it: `cargo:rustc-link-arg-tests` is rejected for a package without an integration-test target, and a
# generic `rustc-link-arg` would also hit the app exe, which tauri-build already gives a manifest. RUSTFLAGS plus an
# explicit --target keeps the flags off build scripts and proc macros (cargo does not pass RUSTFLAGS to host artifacts then),
# and `--lib` keeps them off the app binary.
set -euo pipefail
triple=$(rustc -vV | sed -n 's/^host: //p')
if [[ $triple == *windows-msvc* ]]; then
  manifest=$(cygpath -m "$PWD/windows-test.manifest")
  export RUSTFLAGS="${RUSTFLAGS:-} -C link-arg=/MANIFEST:EMBED -C link-arg=/MANIFESTINPUT:$manifest"
  exec cargo test --lib --target "$triple" "$@"
fi
exec cargo test --lib "$@"
