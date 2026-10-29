//! Builders for small `.docx` files in the tests of this module and of the command layer.
use std::io::{Cursor, Write};
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

pub const NS: &str = r#"xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml""#;

pub fn styles_xml() -> String {
    let style = |id: &str, name: &str, based: &str| format!(r#"<w:style w:type="paragraph" w:styleId="{id}"><w:name w:val="{name}"/>{based}</w:style>"#);
    let based = r#"<w:basedOn w:val="Normal"/>"#;
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><w:styles {NS}>{}{}{}{}{}{}{}{}</w:styles>"#,
        style("Normal", "Normal", ""),
        style("Heading1", "heading 1", based),
        style("Heading2", "heading 2", based),
        style("Heading3", "heading 3", based),
        style("Heading4", "heading 4", based),
        style("Quote", "Quote", based),
        style("ListBullet", "List Bullet", based),
        style("Code", "Source Code", based),
    )
}

pub fn numbering_xml() -> String {
    format!(
        r#"<w:numbering {NS}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>"#
    )
}

pub fn document_xml(body: &str) -> String {
    format!(r#"<?xml version="1.0" encoding="UTF-8"?><w:document {NS}><w:body>{body}<w:sectPr/></w:body></w:document>"#)
}

/// A paragraph of plain text, optionally in a style.
pub fn p(text: &str, style: Option<&str>) -> String {
    let ppr = style.map_or(String::new(), |s| format!(r#"<w:pPr><w:pStyle w:val="{s}"/></w:pPr>"#));
    format!(r#"<w:p>{ppr}<w:r><w:t xml:space="preserve">{text}</w:t></w:r></w:p>"#)
}

/// Two chapters: "Dawn" and "Dusk", each with a paragraph.
pub fn chapter_body() -> String {
    [p("Dawn", Some("Heading1")), p("First text.", None), p("Dusk", Some("Heading1")), p("Second text.", None)].concat()
}

/// A zip with exactly these parts (name, content), deflated.
pub fn docx(parts: &[(&str, &str)]) -> Vec<u8> {
    let mut w = ZipWriter::new(Cursor::new(Vec::new()));
    let opts = SimpleFileOptions::default();
    for (name, content) in parts {
        w.start_file(*name, opts).unwrap();
        w.write_all(content.as_bytes()).unwrap();
    }
    w.finish().unwrap().into_inner()
}

/// A zip with these parts and binary parts too.
pub fn docx_with(parts: &[(&str, &str)], binary: &[(&str, &[u8])]) -> Vec<u8> {
    let mut w = ZipWriter::new(Cursor::new(Vec::new()));
    let opts = SimpleFileOptions::default();
    for (name, content) in parts {
        w.start_file(*name, opts).unwrap();
        w.write_all(content.as_bytes()).unwrap();
    }
    for (name, content) in binary {
        w.start_file(*name, opts).unwrap();
        w.write_all(content).unwrap();
    }
    w.finish().unwrap().into_inner()
}

pub const RELS_HEAD: &str = r#"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">"#;

/// A complete small document: package relationships, the body, styles and numbering, and extra parts.
pub fn simple_docx(body: &str, extra: &[(&str, &str)]) -> Vec<u8> {
    let rels = format!(r#"{RELS_HEAD}<Relationship Id="rId1" Type="x/officeDocument" Target="word/document.xml"/></Relationships>"#);
    let doc = document_xml(body);
    let styles = styles_xml();
    let numbering = numbering_xml();
    let doc_rels = format!("{RELS_HEAD}</Relationships>");
    let mut parts: Vec<(&str, &str)> = vec![("_rels/.rels", &rels), ("word/document.xml", &doc), ("word/styles.xml", &styles), ("word/numbering.xml", &numbering), ("word/_rels/document.xml.rels", &doc_rels)];
    parts.retain(|(n, _)| !extra.iter().any(|(e, _)| e == n));
    parts.extend_from_slice(extra);
    docx(&parts)
}
