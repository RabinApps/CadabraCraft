#![no_main]
//! The whole `.docx` importer (archive, XML parts, body walk, chapter split) with small limits. Seeded from fixtures/docx.
use cadabracraft_fuzz::import_docx::{import_docx, Options};
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let opts = Options { max_decompressed_bytes: 8 * 1024 * 1024, max_entries: 200, ..Options::default() };
    let _ = import_docx(data, &opts);
});
