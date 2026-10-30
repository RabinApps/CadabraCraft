//! Hostile archives and documents, built in memory: what the limits of `archive.rs` and `xml.rs` must refuse, and the odd
//! zips (duplicate and overlapping entries, ZIP64, bad names) that must end in a typed error or a correct read, never a
//! panic, a hang or an allocation sized by the file's own claims.
use super::archive::{read_archive, Limits};
use super::testutil::*;
use super::xml::XmlLimits;
use super::*;
use std::io::{Cursor, Write};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

fn zip_of(entries: &[(&str, &[u8])], opts: SimpleFileOptions) -> Vec<u8> {
    let mut w = ZipWriter::new(Cursor::new(Vec::new()));
    for (n, b) in entries {
        w.start_file(*n, opts).unwrap();
        w.write_all(b).unwrap();
    }
    w.finish().unwrap().into_inner()
}

fn stored() -> SimpleFileOptions {
    SimpleFileOptions::default().compression_method(CompressionMethod::Stored)
}

const LIMITS: Limits = Limits { max_decompressed_bytes: 200 << 20, max_entries: 10_000, max_document_bytes: 64 << 20, max_xml_part_bytes: 16 << 20 };

fn code(r: Result<ImportResult, ImportError>) -> ImportErrorCode {
    r.unwrap_err().code
}

fn with_limits(xml: XmlLimits) -> Options {
    Options { xml, ..Options::default() }
}

/// Every position of `needle` in `hay`.
fn find_all(hay: &[u8], needle: &[u8]) -> Vec<usize> {
    (0..hay.len().saturating_sub(needle.len() - 1)).filter(|i| &hay[*i..*i + needle.len()] == needle).collect()
}

// ---------- the zip layer ----------

#[test]
fn a_declared_size_above_the_part_cap_is_refused_before_inflating_even_when_the_real_data_is_small() {
    // Real data: 20 bytes. Declared: 100 MB (both headers). Nothing is allocated or inflated for it.
    let mut z = zip_of(&[("word/styles.xml", &[b'a'; 20])], stored());
    for i in find_all(&z, &[0x50, 0x4b, 3, 4]) {
        z[i + 22..i + 26].copy_from_slice(&(100u32 << 20).to_le_bytes());
    }
    for i in find_all(&z, &[0x50, 0x4b, 1, 2]) {
        z[i + 24..i + 28].copy_from_slice(&(100u32 << 20).to_le_bytes());
    }
    let e = read_archive(&z, &LIMITS).unwrap_err();
    assert_eq!(e.code, ImportErrorCode::ArchiveTooLarge);
    assert_eq!(e.message, "word/styles.xml would expand to more than 16 MB.");
}

#[test]
fn a_real_bomb_in_each_kind_of_part_hits_its_own_cap_without_being_inflated() {
    let big = vec![b' '; 70 << 20];
    let deflated = SimpleFileOptions::default();
    let z = zip_of(&[("word/document.xml", &big)], deflated);
    assert!(z.len() < 200_000, "70 MB of spaces deflates to {} bytes", z.len());
    let e = read_archive(&z, &LIMITS).unwrap_err();
    assert_eq!((e.code, e.message.as_str()), (ImportErrorCode::ArchiveTooLarge, "word/document.xml would expand to more than 64 MB."));
    for name in ["word/styles.xml", "word/numbering.xml", "word/footnotes.xml", "word/comments.xml", "word/header1.xml", "_rels/.rels", "[Content_Types].xml"] {
        let z = zip_of(&[(name, &big[..17 << 20])], deflated);
        let e = read_archive(&z, &LIMITS).unwrap_err();
        assert_eq!(e.code, ImportErrorCode::ArchiveTooLarge, "{name}");
    }
    // Media only count toward the total, so a 70 MB image is allowed by the part caps and refused only by the total.
    let z = zip_of(&[("word/media/a.png", &big)], deflated);
    assert_eq!(read_archive(&z, &LIMITS).unwrap().get("word/media/a.png").map(<[u8]>::len), Some(70 << 20));
    let e = read_archive(&z, &Limits { max_decompressed_bytes: 50 << 20, ..LIMITS }).unwrap_err();
    assert_eq!((e.code, e.message.as_str()), (ImportErrorCode::ArchiveTooLarge, "The archive would expand to more than 50 MB."));
}

#[test]
fn an_entry_that_inflates_to_more_than_it_declares_is_cut_off_and_refused() {
    // Declared 10 bytes (both headers), actual 100 000 deflated bytes: only 11 are ever read.
    let payload = vec![7u8; 100_000];
    let mut z = zip_of(&[("word/media/a.png", &payload)], SimpleFileOptions::default());
    for i in find_all(&z, &[0x50, 0x4b, 3, 4]) {
        z[i + 22..i + 26].copy_from_slice(&10u32.to_le_bytes());
    }
    for i in find_all(&z, &[0x50, 0x4b, 1, 2]) {
        z[i + 24..i + 28].copy_from_slice(&10u32.to_le_bytes());
    }
    assert_eq!(read_archive(&z, &LIMITS).unwrap_err().code, ImportErrorCode::InvalidZip);
}

#[test]
fn duplicate_entry_names_never_panic_and_the_later_entry_wins() {
    let z = zip_of(&[("word/media/a.png", b"first"), ("word/media/b.png", b"other")], stored());
    let mut dup = z.clone();
    for i in find_all(&z, b"b.png") {
        dup[i] = b'a';
    }
    match read_archive(&dup, &LIMITS) {
        Ok(f) => {
            assert_eq!(f.names().collect::<Vec<_>>(), ["word/media/a.png"], "one name, one entry");
            assert_eq!(f.get("word/media/a.png"), Some(&b"other"[..]), "the later entry wins, like the TypeScript reader");
        }
        Err(e) => assert_eq!(e.code, ImportErrorCode::InvalidZip),
    }
}

#[test]
fn overlapping_entries_that_share_one_local_header_are_refused_or_read_consistently() {
    // The second central-directory record is pointed at the first entry's data: a "quine"-style overlap.
    let mut z = zip_of(&[("word/media/a.png", &[1u8; 64]), ("word/media/b.png", &[2u8; 64])], stored());
    let heads = find_all(&z, &[0x50, 0x4b, 1, 2]);
    assert_eq!(heads.len(), 2);
    z[heads[1] + 42..heads[1] + 46].copy_from_slice(&0u32.to_le_bytes());
    match read_archive(&z, &LIMITS) {
        Ok(f) => {
            // Whatever it read, every part is exactly its declared size and nothing was read twice over the cap.
            for n in f.names() {
                assert_eq!(f.get(n).unwrap().len(), 64, "{n}");
            }
        }
        Err(e) => assert_eq!(e.code, ImportErrorCode::InvalidZip),
    }
    // The same overlap, many times over, is bounded by the total of declared sizes, not by the file size.
    let names: Vec<String> = (0..40).map(|i| format!("word/media/{i:02}.png")).collect();
    let entries: Vec<(&str, &[u8])> = names.iter().map(|n| (n.as_str(), &[9u8; 1000][..])).collect();
    let mut z = zip_of(&entries, stored());
    for h in find_all(&z, &[0x50, 0x4b, 1, 2]) {
        z[h + 42..h + 46].copy_from_slice(&0u32.to_le_bytes());
    }
    let r = read_archive(&z, &Limits { max_decompressed_bytes: 10_000, ..LIMITS });
    assert_eq!(r.unwrap_err().code, ImportErrorCode::ArchiveTooLarge);
}

#[test]
fn a_zip64_archive_is_read_like_any_other() {
    let z = zip_of(&[("word/document.xml", b"<a/>"), ("word/media/a.png", b"png")], stored().large_file(true));
    let h = find_all(&z, &[0x50, 0x4b, 1, 2])[0];
    let (name_len, extra_len) = (u16::from_le_bytes(z[h + 28..h + 30].try_into().unwrap()) as usize, u16::from_le_bytes(z[h + 30..h + 32].try_into().unwrap()));
    assert!(extra_len >= 4 && u16::from_le_bytes(z[h + 46 + name_len..h + 48 + name_len].try_into().unwrap()) == 1, "entries carry a ZIP64 extra field");
    let f = read_archive(&z, &LIMITS).unwrap();
    assert_eq!(f.get("word/document.xml"), Some(&b"<a/>"[..]));
    assert_eq!(f.get("word/media/a.png"), Some(&b"png"[..]));
    // A ZIP64 entry that claims 5 GB is refused by the caps before anything is sized from it.
    let mut z = zip_of(&[("word/media/a.png", b"png")], stored().large_file(true));
    let huge = (5u64 << 30).to_le_bytes();
    for h in find_all(&z, &[0x50, 0x4b, 1, 2]) {
        // Central record: the ZIP64 extra holds the 8-byte sizes after its 4-byte header; rewrite the uncompressed size.
        let name_len = u16::from_le_bytes(z[h + 28..h + 30].try_into().unwrap()) as usize;
        let extra = h + 46 + name_len;
        assert_eq!(u16::from_le_bytes(z[extra..extra + 2].try_into().unwrap()), 1, "the ZIP64 extra field");
        z[extra + 4..extra + 12].copy_from_slice(&huge);
    }
    let e = read_archive(&z, &LIMITS).unwrap_err();
    assert!(matches!(e.code, ImportErrorCode::ArchiveTooLarge | ImportErrorCode::InvalidZip), "{e}");
}

#[test]
fn an_entry_name_that_is_not_utf8_is_refused_or_skipped_never_a_panic() {
    let z = zip_of(&[("word/media/aXb.png", b"png"), ("word/document.xml", b"<a/>")], stored());
    let mut bad = z.clone();
    for i in find_all(&z, b"aXb.png") {
        bad[i + 1] = 0xff;
    }
    match read_archive(&bad, &LIMITS) {
        Ok(f) => assert!(f.names().all(|n| n.is_char_boundary(0)) && f.get("word/document.xml").is_some()),
        Err(e) => assert_eq!(e.code, ImportErrorCode::InvalidZip),
    }
}

// ---------- the XML layer, through the whole importer ----------

fn body_of(inner: &str) -> Vec<u8> {
    simple_docx(inner, &[])
}

#[test]
fn a_node_bomb_is_refused_at_the_element_cap_without_building_the_rest() {
    // 3 million empty paragraphs: 11 MB of XML, deflated to a few KB, would be about 450 MB of tree.
    let doc = body_of(&"<w:p/>".repeat(3_000_000));
    assert!(doc.len() < 100_000, "the archive is small: {}", doc.len());
    let e = import_docx(&doc, &Options::default()).unwrap_err();
    assert_eq!(e.code, ImportErrorCode::TooManyNodes);
    assert_eq!(e.message, "word/document.xml is too big to read: the document has more than 2000000 elements.");
}

#[test]
fn the_element_cap_is_shared_by_every_part_of_one_import() {
    let limits = XmlLimits { max_elements: 150, ..XmlLimits::default() };
    let rels = format!("{RELS_HEAD}</Relationships>");
    let doc = simple_docx(&"<w:p/>".repeat(10), &[]);
    assert!(import_docx(&doc, &with_limits(limits)).is_ok(), "one part alone fits");
    let hdr = format!(r#"<w:hdr {NS}>{}</w:hdr>"#, "<w:p/>".repeat(80));
    let foot = format!(r#"<w:ftr {NS}>{}</w:ftr>"#, "<w:p/>".repeat(80));
    let doc = simple_docx(&"<w:p/>".repeat(10), &[("word/header1.xml", &hdr), ("word/footer1.xml", &foot), ("word/_rels/document.xml.rels", &rels)]);
    let e = import_docx(&doc, &with_limits(limits)).unwrap_err();
    assert_eq!(e.code, ImportErrorCode::TooManyNodes);
    assert!(e.message.starts_with("word/footer1.xml ") || e.message.starts_with("word/header1.xml "), "{}", e.message);
}

#[test]
fn an_attribute_flood_is_refused_per_element_and_in_total() {
    // One element with 300 distinct attributes (and the quadratic duplicate scan that goes with them).
    let attrs: String = (0..300).map(|i| format!(r#" a{i}="1""#)).collect();
    let e = import_docx(&body_of(&format!("<w:p{attrs}/>")), &Options::default()).unwrap_err();
    assert_eq!(e.code, ImportErrorCode::TooManyNodes);
    assert_eq!(e.message, "word/document.xml has an element with more than 256 attributes.");
    let just_fits: String = (0..250).map(|i| format!(r#" a{i}="1""#)).collect();
    assert!(import_docx(&body_of(&format!("<w:p{just_fits}/>")), &Options::default()).is_ok());
    // Many modest elements add up: 3 attributes each against a total of 1 000.
    let many = r#"<w:p a="1" b="2" c="3"/>"#.repeat(400);
    let limits = XmlLimits { max_attributes: 1_000, ..XmlLimits::default() };
    let e = import_docx(&body_of(&many), &with_limits(limits)).unwrap_err();
    assert_eq!(e.code, ImportErrorCode::TooManyNodes);
    assert!(e.message.ends_with("more than 1000 attributes."), "{}", e.message);
}

#[test]
fn a_huge_single_text_node_is_bounded_by_the_text_budget() {
    let text = "x".repeat(3 << 20);
    let doc = body_of(&format!("<w:p><w:r><w:t>{text}</w:t></w:r></w:p>"));
    let limits = XmlLimits { max_text_bytes: 1 << 20, ..XmlLimits::default() };
    let e = import_docx(&doc, &with_limits(limits)).unwrap_err();
    assert_eq!(e.code, ImportErrorCode::TooManyNodes);
    assert_eq!(e.message, "word/document.xml is too big to read: the document has more than 1048576 bytes of text.");
    // Under the budget it is imported whole.
    let r = import_docx(&doc, &Options::default()).unwrap();
    assert!(serde_json::to_string(&r.chapters).unwrap().len() > 3 << 20);
    // Entity references and CDATA count too, so they cannot dodge the budget.
    let refs = body_of(&format!("<w:p><w:r><w:t>{}</w:t></w:r></w:p>", "&amp;".repeat(2000)));
    let limits = XmlLimits { max_text_bytes: 1000, ..XmlLimits::default() };
    assert_eq!(code(import_docx(&refs, &with_limits(limits))), ImportErrorCode::TooManyNodes);
    let cdata = body_of(&format!("<w:p><w:r><w:t><![CDATA[{}]]></w:t></w:r></w:p>", "y".repeat(2000)));
    assert_eq!(code(import_docx(&cdata, &with_limits(limits))), ImportErrorCode::TooManyNodes);
}

#[test]
fn nesting_at_the_limit_is_read_and_one_deeper_is_refused() {
    // document and body are two of the 101 open elements, so 99 more fit.
    let deep = body_of(&format!("{}{}", "<w:sdt>".repeat(100), "</w:sdt>".repeat(100)));
    assert_eq!(code(import_docx(&deep, &Options::default())), ImportErrorCode::InvalidXml, "102 open elements");
    let at_limit = body_of(&format!("{}{}", "<w:sdt>".repeat(99), "</w:sdt>".repeat(99)));
    assert!(import_docx(&at_limit, &Options::default()).is_ok(), "101 open elements");
}

#[test]
fn an_empty_document_part_and_a_missing_content_types_part() {
    let empty = docx(&[("word/document.xml", "")]);
    let e = import_docx(&empty, &Options::default()).unwrap_err();
    assert_eq!((e.code, e.message.as_str()), (ImportErrorCode::InvalidXml, "word/document.xml is not well-formed XML (start tag expected)."));
    let blank = docx(&[("word/document.xml", "  \n ")]);
    assert_eq!(code(import_docx(&blank, &Options::default())), ImportErrorCode::InvalidXml);
    // `[Content_Types].xml` is never read: a package without one imports, and a broken or huge one is not parsed either.
    let plain = simple_docx(&chapter_body(), &[]);
    assert!(import_docx(&plain, &Options::default()).is_ok());
    let broken = simple_docx(&chapter_body(), &[("[Content_Types].xml", "<Types><Default></Types>")]);
    assert_eq!(import_docx(&broken, &Options::default()).unwrap().chapters.len(), 2);
}

#[test]
fn the_owned_entry_point_gives_the_same_result_as_the_borrowed_one() {
    let doc = simple_docx(&chapter_body(), &[]);
    let a = import_docx(&doc, &Options::default()).unwrap();
    let b = import_docx_owned(doc, &Options::default()).unwrap();
    assert_eq!(a, b);
    assert_eq!(import_docx_owned(b"not a zip at all, long enough".to_vec(), &Options::default()).unwrap_err().code, ImportErrorCode::InvalidZip);
}

#[test]
fn an_oversized_xml_part_is_refused_through_the_options() {
    let styles = format!("<w:styles {NS}>{}</w:styles>", " ".repeat(5000));
    let doc = simple_docx(&chapter_body(), &[("word/styles.xml", &styles)]);
    let o = Options { max_xml_part_bytes: 1000, ..Options::default() };
    assert_eq!(code(import_docx(&doc, &o)), ImportErrorCode::ArchiveTooLarge);
    let o = Options { max_document_bytes: 100, ..Options::default() };
    assert_eq!(code(import_docx(&doc, &o)), ImportErrorCode::ArchiveTooLarge);
}
