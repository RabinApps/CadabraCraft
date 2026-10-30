# Performance, memory and fuzz tooling

Tools to watch speed and memory under huge books and hostile files. None of them is a PR gate: the scheduled workflow
`.github/workflows/perf-fuzz.yml` (weekly, or run by hand) runs a small smoke test and every fuzz target.

All Rust parts live in two standalone crates that are **not** part of the app's build (the app crate's build script needs
the Typst/Sherpa/FFmpeg binaries, and `cadabracraft_lib` exports nothing but `run()`). They compile the app's real source
files with `#[path]` and a one-file stand-in for the `tauri` crate (`tools/perf/tauri-shim`), so they measure the real code.

| Tool                                | What it does                                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| `pnpm perf:bookgen -- ...`          | Writes a real project folder (or `.docx`) of any size (`apps/desktop/src-tauri/tools/perf`).   |
| `pnpm perf:huge-book`               | Generates or reuses a book, times the Rust project layer on it, compares with `baseline.json`. |
| `pnpm perf:leaks`                   | macOS `leaks` over the probe; fails on a leak; skips elsewhere.                                |
| `pnpm perf:fuzz [target] [seconds]` | Seeds the corpus and runs the cargo-fuzz targets (`apps/desktop/src-tauri/fuzz`).              |

## bookgen

```bash
pnpm perf:bookgen --out /tmp/book --preset huge              # 500 chapters, 20 images, 50 references, 3 snapshots
pnpm perf:bookgen --out /tmp/book --preset giant-chapter     # one 200,000-word chapter
pnpm perf:bookgen --out /tmp/book --preset media             # 300 images x 256 KiB, 200 references (about 80 MiB)
pnpm perf:bookgen --out /tmp/book --chapters 40 --words-per-chapter 2500 --images 10 --image-kb 64 \
    --references 5 --snapshots 2 --seed 7
pnpm perf:bookgen --docx /tmp/big.docx --paragraphs 200000   # a large valid .docx (stored zip, headings every 150 paragraphs)
pnpm perf:bookgen --docx-bomb node --docx /tmp/n.docx [--bomb-depth 100000]   # nesting far past the importer's 101-element cap
pnpm perf:bookgen --docx-bomb zip  --docx /tmp/z.docx [--bomb-mb 190]         # 160:1 deflate: tiny file, MiB of XML
```

Presets are `small` (smoke test), `huge`, `giant-chapter`, `media`; explicit flags override a preset. Output is
deterministic for a seed. A project is the app's exact format: a version 6 `cadabra.json`, `manuscript/NNN-slug.json`
TipTap documents (headings, dialogue, bold and italic, footnotes, scene breaks, image nodes), `assets/img-N.png` (real
noise PNGs), `references/ref-N.txt` linked to chapters, and `.cadabra/snapshots/<stamp>.json` whole-book snapshots.
Generated books were checked with `validateManifest` and `chapterDocProblem` from the workspace packages, and listed by
the Rust snapshot code. `--docx-bomb zip` stays under the importer's 200 MB cap by default (190 MiB), so it exercises
the inflate path; use `--bomb-mb 400` for the declared-size refusal. Pass `--bomb-depth 100` to stress the body walk just
under the cap.

## huge-book

```bash
pnpm perf:huge-book                       # preset huge, book kept in perf-results/books/huge-seed1 for reuse
pnpm perf:huge-book --preset small        # what the workflow runs
pnpm perf:huge-book --dir /path/to/book   # your own book (it is copied first, never modified)
PERF_FACTOR=2 pnpm perf:huge-book         # stricter than the default 3
```

`perfprobe` (run on a temporary copy of the book) times: open (`require_project` plus the manifest read), listing the
project's files, reading every page, reading and writing the largest page with a base hash, writing every page back (first
save of a session, which keeps a snapshot, and throttled), atomic writes of 64 KiB and 8 MiB, creating and listing a
whole-book snapshot, one page's history, reading images, `store_image`, reference stat and range reads, and importing a
20,000-paragraph `.docx`. It reports wall and CPU time per step (CPU through `getrusage`), per-item median, p95 and max,
and peak RSS (`/usr/bin/time -l` on macOS, `VmHWM` on Linux). Results go to `perf-results/huge-book.json` (gitignored).
Peak RSS is dominated by the `.docx` import step (the largest allocation in the probe), so it tracks the importer's memory.

The run exits 1 when total CPU time, any step's CPU time (with a 25 ms floor so timer noise never fails it) or peak RSS is
more than `PERF_FACTOR` (default 3, `PERF_RSS_FACTOR` for RSS) times the entry in `baseline.json` for that preset and
`<platform>-<arch>`. With no entry it only reports (add `--require-baseline` to fail instead).

**Updating the baseline.** Baselines are per machine class, so record them where they will be compared: run
`pnpm perf:huge-book --preset <p> --update-baseline` on that kind of machine (for CI, take `huge-book.json` from the
workflow artifact or run it on the runner) and commit `baseline.json`. Do it after an intended change and say why in the
commit message; never to silence a regression you do not understand. Run it twice and keep the slower numbers if they differ.

Not done: an `--app` mode that measures the real Tauri window (see the TODO in `huge-book.ts`). For app-level numbers use
`pnpm automation:measure-large-chapter` on a book from `perf:bookgen`.

## leaks

`pnpm perf:leaks [book dir]` runs `perfprobe` under `/usr/bin/leaks --atExit` and fails when leaks are found. On Linux it
prints a skip message and exits 0 (use `valgrind --leak-check=full` on `perfprobe` by hand).

## Fuzz targets

`apps/desktop/src-tauri/fuzz` (cargo-fuzz, nightly): `docx_archive` (`read_archive`), `docx_xml` (`parse_xml`),
`docx_import` (the whole importer), `wav` (`parse_wav`), `font_family` (`family_name`), `image_size` (`check_image`, which
calls `image_size`), `typst_frame` (`parse_compile_request` and `parse_query_request`) and `project_resolve` (`resolve`,
asserting an `Ok` path stays inside the root). The `.docx` targets are seeded from `fixtures/docx/*.docx` by
`scripts/perf/fuzz.sh`; the others get a few hand-made seeds. Crashes are written to `fuzz/artifacts/<target>/`; replay one
with `cargo +nightly fuzz run <target> <artifact>` (add `--sanitizer none` on macOS). The corpus and artifacts are gitignored.

AddressSanitizer is the default sanitizer. On the macOS 27 beta its runtime hangs at start-up, so the script uses
`--sanitizer none` on macOS (override with `FUZZ_SANITIZER`); CI on Linux uses ASan.
