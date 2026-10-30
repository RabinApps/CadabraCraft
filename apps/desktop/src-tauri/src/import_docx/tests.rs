//! Tests of the whole importer on small hand-built files. The contract fixtures (`contract_tests.rs`) cover the breadth of
//! constructs against the TypeScript importer's output; these pin the behavior that belongs to this implementation: the
//! documented differences, the error order, and the paths a fixture cannot reach.
use super::testutil::*;
use super::*;
use crate::import_docx::ctx::PState;
use crate::import_docx::xml::{Element, XNode};
use std::rc::Rc;

fn run(bytes: &[u8]) -> ImportResult {
    import_docx(bytes, &Options::default()).unwrap_or_else(|e| panic!("{e}"))
}
fn err(bytes: &[u8]) -> ImportErrorCode {
    import_docx(bytes, &Options::default()).unwrap_err().code
}
fn text_of(r: &ImportResult) -> String {
    serde_json::to_string(&r.chapters).unwrap()
}
fn warning_codes(r: &ImportResult) -> Vec<&str> {
    r.warnings.iter().map(|w| w.code.as_str()).collect()
}

#[test]
fn a_document_is_split_into_chapters_at_the_split_level() {
    let r = run(&simple_docx(&chapter_body(), &[]));
    assert_eq!(r.chapters.iter().map(|c| c.title.as_str()).collect::<Vec<_>>(), ["Dawn", "Dusk"]);
    assert!(r.warnings.is_empty() && r.assets.is_empty());
    let body = [p("Front", None), p("Part", Some("Heading2")), p("Text", None)].concat();
    let doc = simple_docx(&body, &[]);
    let o = |level, untitled: &str| Options { split_heading_level: level, untitled_title: untitled.into(), ..Options::default() };
    let r = import_docx(&doc, &o(2, "Prologue")).unwrap();
    assert_eq!(r.chapters.iter().map(|c| c.title.as_str()).collect::<Vec<_>>(), ["Prologue", "Part"]);
    assert_eq!(warning_codes(&r), ["untitled-content"]);
    assert_eq!(warning_codes(&import_docx(&doc, &o(1, "Whole")).unwrap()), ["no-headings"]);
}

#[test]
fn an_empty_body_is_reported_not_failed() {
    let r = run(&simple_docx("", &[]));
    assert!(r.chapters.is_empty());
    assert_eq!(warning_codes(&r), ["empty-input"]);
}

#[test]
fn the_document_part_is_found_through_the_package_relationships() {
    let doc = document_xml(&p("Hello", Some("Heading1")));
    let rel = |target: &str, mode: &str| format!(r#"{RELS_HEAD}<Relationship Id="rId1" Type="x" Target="{target}"{mode}/></Relationships>"#);
    // A target that is not one of the parts read falls back to word/document.xml.
    let r = run(&docx(&[("_rels/.rels", &rel("/custom/document.xml", "")), ("word/document.xml", &doc), ("word/styles.xml", &styles_xml())]));
    assert_eq!(r.chapters[0].title, "Hello");
    // An external relationship to a document is ignored.
    let r = run(&docx(&[("_rels/.rels", &rel("https://x.test/word/document.xml", r#" TargetMode="External""#)), ("word/document.xml", &doc), ("word/styles.xml", &styles_xml())]));
    assert_eq!(r.chapters[0].title, "Hello");
    // No package relationships at all.
    assert_eq!(run(&docx(&[("word/document.xml", &doc), ("word/styles.xml", &styles_xml())])).chapters[0].title, "Hello");
}

#[test]
fn a_file_without_a_document_or_a_body_is_refused() {
    assert_eq!(err(&docx(&[("hello.txt", "hi")])), ImportErrorCode::MissingDocument);
    assert_eq!(err(&docx(&[("word/document.xml", "<w:document xmlns:w='x'/>")])), ImportErrorCode::MissingDocument);
    assert_eq!(err(&docx(&[("word/document.xml", "<w:other><w:body/></w:other>")])), ImportErrorCode::MissingDocument);
}

#[test]
fn every_part_that_is_read_must_be_well_formed() {
    let ok = |name: &str, content: &str| simple_docx(&chapter_body(), &[(name, content)]);
    let broken = "<w:x><w:y></w:x>";
    for part in ["_rels/.rels", "word/_rels/document.xml.rels", "word/styles.xml", "word/numbering.xml", "word/footnotes.xml", "word/endnotes.xml", "word/comments.xml", "word/header1.xml", "word/footer2.xml", "word/document.xml"] {
        assert_eq!(err(&ok(part, broken)), ImportErrorCode::InvalidXml, "{part}");
    }
    assert_eq!(err(&docx(&[("word/document.xml", "<w:document><w:body><w:p></w:document>")])), ImportErrorCode::InvalidXml);
    // An unread part may be anything.
    assert!(import_docx(&ok("word/theme/theme1.xml", broken), &Options::default()).is_ok());
}

#[test]
fn comments_are_counted_from_the_references_or_the_comment_part_whichever_is_larger() {
    let refs = p("x", None).replace("</w:p>", r#"<w:r><w:commentReference w:id="0"/></w:r><w:r><w:commentReference w:id="1"/></w:r></w:p>"#);
    let w = |r: &ImportResult| r.warnings.iter().find(|w| w.code == "comments").map(|w| (w.message.clone(), w.count));
    assert_eq!(w(&run(&simple_docx(&refs, &[]))).unwrap().0, "The file has 2 comment(s); comments are not imported.");
    let part = format!(r#"<w:comments {NS}><w:comment w:id="0"/><w:comment w:id="1"/><w:comment w:id="2"/></w:comments>"#);
    assert_eq!(w(&run(&simple_docx(&refs, &[("word/comments.xml", &part)]))).unwrap().0, "The file has 3 comment(s); comments are not imported.");
    assert_eq!(w(&run(&simple_docx(&p("x", None), &[("word/comments.xml", "<w:other/>")]))), None);
}

#[test]
fn headers_and_footers_with_text_are_reported_and_empty_ones_are_not() {
    let hdr = |text: &str| format!(r#"<w:hdr {NS}><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:hdr>"#);
    let r = run(&simple_docx(&p("x", None), &[("word/header1.xml", &hdr("Running head")), ("word/footer1.xml", &hdr(" ")), ("word/footer2.xml", &hdr("Page"))]));
    let w = r.warnings.iter().find(|w| w.code == "header-footer").unwrap();
    assert_eq!((w.count, w.examples.clone()), (Some(2), vec!["Running head".to_string(), "Page".to_string()]));
}

#[test]
fn entities_follow_xml_not_the_typescript_parser() {
    // Documented differences (docs/import.md, "Two importers"): numeric character references are decoded (fast-xml-parser
    // leaves "&#65;" as text), and a DOCTYPE is skipped, never expanded.
    let r = run(&simple_docx(&p("a&#65;&#x42;&amp;&#8217;&nbsp;&unknown;", None), &[]));
    assert!(text_of(&r).contains("aAB&\u{2019}&nbsp;&unknown;"), "{}", text_of(&r));
    let bomb = format!(r#"<?xml version="1.0"?><!DOCTYPE d [<!ENTITY e "boom">]><w:document {NS}><w:body>{}</w:body></w:document>"#, p("&e;", None));
    let r = run(&docx(&[("word/document.xml", &bomb)]));
    assert!(text_of(&r).contains("&e;") && !text_of(&r).contains("boom"));
}

#[test]
fn a_style_with_numbering_makes_list_items_even_through_based_on() {
    let styles = format!(
        r#"<w:styles {NS}><w:style w:styleId="Root"><w:name w:val="Root"/></w:style><w:style w:styleId="Base"><w:name w:val="Base"/><w:basedOn w:val="Root"/><w:pPr><w:numPr><w:numId w:val="2"/></w:numPr></w:pPr></w:style><w:style w:styleId="Child"><w:name w:val="Child"/><w:basedOn w:val="Base"/></w:style></w:styles>"#
    );
    let r = run(&simple_docx(&p("one", Some("Child")), &[("word/styles.xml", &styles)]));
    assert!(text_of(&r).contains("orderedList"), "{}", text_of(&r));
}

#[test]
fn a_checkbox_before_a_footnote_still_makes_a_task_item() {
    let note = format!(r#"<w:footnotes {NS}><w:footnote w:id="1"><w:p><w:r><w:t>n</w:t></w:r></w:p></w:footnote></w:footnotes>"#);
    let para = r#"<w:p><w:sdt><w:sdtPr><w14:checkbox><w14:checked w14:val="1"/></w14:checkbox></w:sdtPr><w:sdtContent><w:r><w:t>x</w:t></w:r></w:sdtContent></w:sdt><w:r><w:footnoteReference w:id="1"/></w:r><w:r><w:t> after</w:t></w:r></w:p>"#;
    let r = run(&simple_docx(para, &[("word/footnotes.xml", &note)]));
    let json = text_of(&r);
    assert!(json.contains(r#""type":"taskItem","attrs":{"checked":true}"#) && json.contains("footnote"), "{json}");
}

fn nested(depth: usize, tag: &str, leaf: XNode) -> XNode {
    (0..depth).fold(leaf, |inner, _| XNode::El(Rc::new(Element { name: tag.into(), attrs: vec![], kids: vec![inner] })))
}

fn bare_ctx() -> ctx::DCtx {
    ctx::DCtx {
        warn: Warnings::new(),
        assets: assets::AssetRegistry::new(),
        rels: parse_rels(None, "r", &crate::import_docx::xml::XmlBudget::default()).unwrap(),
        styles: HashMap::new(),
        numbering: parts::Numbering::default(),
        files: archive::Files::default(),
        notes: HashMap::new(),
        comment_refs: 0,
    }
}

#[test]
fn the_body_walk_stops_at_the_depth_limit() {
    // A real file cannot nest this deep (the XML reader refuses 102 open elements), so the tree is built by hand.
    let para = XNode::El(Rc::new(Element { name: "p".into(), attrs: vec![], kids: vec![XNode::El(Rc::new(Element { name: "r".into(), attrs: vec![], kids: vec![XNode::El(Rc::new(Element { name: "t".into(), attrs: vec![], kids: vec![XNode::Text("deep".into())] }))] }))] }));
    for (levels, expect) in [(50, 1), (101, 0)] {
        let mut ctx = bare_ctx();
        let mut b = body::BodyBuilder::new(8.0);
        b.walk(&mut ctx, &[nested(levels, "ins", para.clone())], 0);
        b.flush();
        assert_eq!(b.out.len(), expect, "{levels} levels");
    }
}

#[test]
fn a_paragraph_state_starts_empty() {
    let st = PState::new(true);
    assert!(st.in_note && st.items.is_empty() && st.fields.is_empty() && st.checkbox.is_none());
}

#[test]
fn images_are_returned_with_their_bytes_and_unique_names() {
    let drawing = |rid: &str| format!(r#"<w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="n" descr="A pixel"/><a:graphic><a:blip r:embed="{rid}"/></a:graphic></wp:inline></w:drawing></w:r></w:p>"#);
    let rels = format!(r#"{RELS_HEAD}<Relationship Id="rId1" Type="x" Target="media/a.png"/><Relationship Id="rId2" Type="x" Target="media/sub/a.PNG"/></Relationships>"#);
    let doc = document_xml(&[drawing("rId1"), drawing("rId2"), drawing("rId1")].concat());
    let bytes = docx_with(&[("word/document.xml", &doc), ("word/_rels/document.xml.rels", &rels)], &[("word/media/a.png", &[1, 2, 3]), ("word/media/sub/a.PNG", &[4])]);
    let r = run(&bytes);
    assert_eq!(r.assets.iter().map(|a| (a.target_path.as_str(), a.bytes.clone())).collect::<Vec<_>>(), [("assets/a.png", vec![1, 2, 3]), ("assets/a-2.PNG", vec![4])]);
    assert_eq!(text_of(&r).matches("assets/a.png").count(), 2, "the same image twice is one asset used twice");
    assert!(text_of(&r).contains(r#""alt":"A pixel""#));
}

#[test]
fn damaged_archives_are_refused_with_the_matching_code() {
    assert_eq!(err(&[]), ImportErrorCode::InvalidZip);
    assert_eq!(err(b"not a zip at all, but long enough to try"), ImportErrorCode::InvalidZip);
    let doc = simple_docx(&chapter_body(), &[]);
    let o = Options { max_entries: 2, ..Options::default() };
    assert_eq!(import_docx(&doc, &o).unwrap_err().code, ImportErrorCode::TooManyEntries);
    let o = Options { max_decompressed_bytes: 100, ..Options::default() };
    assert_eq!(import_docx(&doc, &o).unwrap_err().code, ImportErrorCode::ArchiveTooLarge);
}

#[test]
fn the_limit_defaults_match_the_typescript_importer() {
    let o = Options::default();
    assert_eq!((o.split_heading_level, o.untitled_title.as_str(), o.max_decompressed_bytes, o.max_entries, o.max_nesting_depth), (1, "Untitled", 209_715_200, 10_000, 32));
}
