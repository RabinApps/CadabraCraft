//! The `.docx` mode: big documents and the node/zip bombs.
use crate::binary::*;
use crate::text::*;
use std::fs;
use std::path::Path;

// ---------------------------------------------------------------- .docx

pub(crate) const CONTENT_TYPES: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/><Override PartName=\"/word/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml\"/></Types>";
pub(crate) const RELS: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>";
pub(crate) const DOC_RELS: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/></Relationships>";
pub(crate) const STYLES: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><w:styles xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:style w:type=\"paragraph\" w:styleId=\"Heading1\"><w:name w:val=\"heading 1\"/></w:style><w:style w:type=\"paragraph\" w:styleId=\"Heading2\"><w:name w:val=\"heading 2\"/></w:style></w:styles>";
pub(crate) const DOC_OPEN: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>";
pub(crate) const DOC_CLOSE: &str = "</w:body></w:document>";

pub(crate) fn xml_esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// document.xml with `paragraphs` paragraphs: a Heading 1 every 150 paragraphs, otherwise prose with some bold and italic runs.
pub(crate) fn document_xml(paragraphs: usize, seed: u32) -> String {
    let words: Vec<&str> = WORDS.split(' ').collect();
    let mut r = Rng(seed);
    let mut o = String::from(DOC_OPEN);
    for i in 0..paragraphs {
        if i % 150 == 0 {
            o.push_str(&format!("<w:p><w:pPr><w:pStyle w:val=\"Heading1\"/></w:pPr><w:r><w:t>Chapter {}</w:t></w:r></w:p>", i / 150 + 1));
            continue;
        }
        o.push_str("<w:p>");
        for _ in 0..(2 + r.below(3)) {
            let s = xml_esc(&format!("{} ", sentence(&mut r, &words)));
            let x = r.next();
            let rpr = if x < 0.06 {
                "<w:rPr><w:b/></w:rPr>"
            } else if x < 0.12 {
                "<w:rPr><w:i/></w:rPr>"
            } else {
                ""
            };
            o.push_str(&format!("<w:r>{rpr}<w:t xml:space=\"preserve\">{s}</w:t></w:r>"));
        }
        o.push_str("</w:p>");
    }
    o.push_str(DOC_CLOSE);
    o
}

pub(crate) fn write_docx(path: &Path, document: &str) {
    let mut z = Zip::new(std::io::BufWriter::new(fs::File::create(path).unwrap()));
    z.stored("[Content_Types].xml", CONTENT_TYPES.as_bytes());
    z.stored("_rels/.rels", RELS.as_bytes());
    z.stored("word/_rels/document.xml.rels", DOC_RELS.as_bytes());
    z.stored("word/styles.xml", STYLES.as_bytes());
    z.stored("word/document.xml", document.as_bytes());
    z.finish();
}

/// Nested `<w:sdt><w:sdtContent>` pairs `depth` deep (the importer refuses more than 101 open elements), then a paragraph.
pub(crate) fn node_bomb(depth: usize) -> String {
    let mut o = String::from(DOC_OPEN);
    for _ in 0..depth {
        o.push_str("<w:sdt><w:sdtContent>");
    }
    o.push_str("<w:p><w:r><w:t>bottom</w:t></w:r></w:p>");
    for _ in 0..depth {
        o.push_str("</w:sdtContent></w:sdt>");
    }
    o.push_str(DOC_CLOSE);
    o
}

/// A deflated document.xml that is `mb` MiB of whitespace inside valid XML: tiny on disk, large in memory. The importer's
/// default cap is 200 MB; use a value above it to see the declared-size refusal, below it to see the inflate path.
pub(crate) fn write_zip_bomb(path: &Path, mb: u64) {
    let runs = (mb * 1024 * 1024).saturating_sub(1) / 258;
    let spaces = 1 + 258 * runs;
    let (prefix, suffix) = (format!("{DOC_OPEN}<w:p><w:r><w:t>"), format!("</w:t></w:r></w:p>{DOC_CLOSE}"));
    let mut crc = Crc::new();
    crc.update(prefix.as_bytes());
    let block = [b' '; 65536];
    let mut left = spaces;
    while left > 0 {
        let n = left.min(block.len() as u64) as usize;
        crc.update(&block[..n]);
        left -= n as u64;
    }
    crc.update(suffix.as_bytes());
    let stream = deflate_spaces(prefix.as_bytes(), runs, suffix.as_bytes());
    let usize = prefix.len() as u64 + spaces + suffix.len() as u64;
    let mut z = Zip::new(std::io::BufWriter::new(fs::File::create(path).unwrap()));
    z.stored("[Content_Types].xml", CONTENT_TYPES.as_bytes());
    z.stored("_rels/.rels", RELS.as_bytes());
    z.entry("word/document.xml", 8, crc.finish(), stream.len() as u64, usize, &mut |put| put(&stream));
    z.finish();
    eprintln!("zip bomb: {} bytes on disk, {} bytes declared", stream.len(), usize);
}
