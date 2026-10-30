#![no_main]
//! `import_docx::xml::parse_xml`: any bytes give an error or a tree; nesting is capped, so it never overflows the stack.
use cadabracraft_fuzz::import_docx::xml::parse_xml;
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let _ = parse_xml(data, "word/document.xml");
});
