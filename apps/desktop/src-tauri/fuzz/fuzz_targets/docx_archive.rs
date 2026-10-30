#![no_main]
//! `import_docx::archive::read_archive`: hostile zip bytes must give an error or the wanted parts, never a panic, and
//! never more bytes than the limit allows.
use cadabracraft_fuzz::import_docx::archive::{read_archive, Limits};
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let limits = Limits { max_decompressed_bytes: 8 * 1024 * 1024, max_entries: 200, max_document_bytes: 4 * 1024 * 1024, max_xml_part_bytes: 1024 * 1024 };
    if let Ok(files) = read_archive(data, &limits) {
        let total: usize = files.names().map(|n| files.get(n).map_or(0, <[u8]>::len)).sum();
        assert!(total as u64 <= limits.max_decompressed_bytes);
    }
});
