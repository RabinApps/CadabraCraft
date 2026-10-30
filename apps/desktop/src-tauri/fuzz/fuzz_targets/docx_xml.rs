#![no_main]
//! `import_docx::xml::parse_xml_in`: any bytes give an error or a tree; nesting and the node budget are capped, so it
//! never overflows the stack or builds an unbounded tree.
use cadabracraft_fuzz::import_docx::xml::{parse_xml_in, XmlBudget, XmlLimits};
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let budget = XmlBudget::new(XmlLimits { max_elements: 100_000, max_attributes: 200_000, max_text_bytes: 4 * 1024 * 1024, max_attributes_per_element: 256 });
    let _ = parse_xml_in(data, "word/document.xml", &budget);
});
