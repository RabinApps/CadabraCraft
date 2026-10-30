#![no_main]
//! The framed binary bodies of `typst_compile` and `typst_query` (a length, a JSON header, then file bytes): lengths come
//! from the webview and must never index out of range or overflow.
use cadabracraft_fuzz::typst::request::{parse_compile_request, parse_query_request};
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    if let Ok(r) = parse_compile_request(data) {
        assert!(r.files.iter().map(|(_, b)| b.len()).sum::<usize>() <= data.len());
    }
    if let Ok(r) = parse_query_request(data) {
        assert!(r.files.iter().map(|(_, b)| b.len()).sum::<usize>() <= data.len());
    }
});
