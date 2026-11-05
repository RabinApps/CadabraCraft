use super::*;

fn parse(s: &str) -> Vec<XNode> {
    parse_xml(s.as_bytes(), "t.xml").unwrap()
}
fn fails(s: &str) {
    let e = parse_xml(s.as_bytes(), "t.xml").unwrap_err();
    assert_eq!(e.code, ImportErrorCode::InvalidXml, "{s}");
    assert!(e.message.starts_with("t.xml "), "{}", e.message);
}
fn text_of(s: &str) -> String {
    raw_text(&parse(s)[0])
}

#[test]
fn builds_a_tree_with_local_names_and_the_last_attribute_of_a_name_winning() {
    let r = parse(r#"<?xml version="1.0"?><w:a xmlns:w="u" w:val="1" r:val="2" id='x'><w:b/>hi<!-- c --><w:c>t</w:c></w:a>"#);
    let a = &r[0];
    assert_eq!(tag_of(a), "a");
    assert_eq!(attr(a, "val"), Some("2"));
    assert_eq!(attr(a, "id"), Some("x"));
    assert_eq!(attr(a, "xmlns"), None);
    assert_eq!(attr(a, "w"), None);
    assert_eq!(kids(a).iter().map(tag_of).collect::<Vec<_>>(), ["b", "#text", "c"]);
    assert_eq!(attr(&kids(a)[1], "val"), None);
    assert_eq!(kids(&kids(a)[1]).len(), 0);
    assert!(child(a, "c").is_some() && child(a, "z").is_none());
    assert_eq!(children_named(a, "b").count(), 1);
    assert_eq!(tag_of(&parse("<a:b:c/>")[0]), "b:c");
    assert_eq!(find_root(&parse("<a/><b/>"), "b").map(tag_of), Some("b"));
    assert!(find_root(&parse("<a/>"), "b").is_none());
}

#[test]
fn decodes_entities_and_keeps_unknown_ones_as_text() {
    assert_eq!(text_of("<a>&lt;&amp;&gt;&quot;&apos;</a>"), "<&>\"'");
    assert_eq!(text_of("<a>&#65;&#x42;&#X43;</a>"), "ABC");
    assert_eq!(text_of("<a>&nbsp;&foo;&#0;&#xD800;&#zz;&#;</a>"), "&nbsp;&foo;&#0;&#xD800;&#zz;&#;");
    assert_eq!(text_of("<a><![CDATA[x<y&z]]>w</a>"), "x<y&zw");
    assert_eq!(text_of("<a>a<!-- c -->b<?pi x?>c</a>"), "abc");
    assert_eq!(text_of("<a>t\r\nu\rv</a>"), "t\nu\nv");
    assert_eq!(text_of("<a>1 &amp;#65; 2</a>"), "1 &#65; 2");
    let r = parse(r#"<a b="&amp;&#65;&bogus;&;&amp" c="a&b"/>"#);
    assert_eq!(attr(&r[0], "b"), Some("&A&bogus;&;&amp"));
    assert_eq!(attr(&r[0], "c"), Some("a&b"));
}

#[test]
fn a_doctype_is_skipped_and_never_expanded() {
    let bomb = r#"<?xml version="1.0"?><!DOCTYPE d [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;">]><d>&b;</d>"#;
    assert_eq!(text_of(bomb), "&b;");
}

#[test]
fn keeps_white_space_text_between_elements() {
    let r = parse("<a> <b/> x </a>");
    assert_eq!(kids(&r[0]).len(), 3);
    assert_eq!(raw_text(&r[0]), "  x ");
    assert_eq!(parse("  <a/>\n<b/>  ").len(), 2);
}

#[test]
fn strips_up_to_two_byte_order_marks_and_decodes_lossily() {
    let mut b = b"\xEF\xBB\xBF\xEF\xBB\xBF<a>x</a>".to_vec();
    assert_eq!(raw_text(&parse_xml(&b, "t").unwrap()[0]), "x");
    b = b"<a>\xFF\xFEx</a>".to_vec();
    assert_eq!(raw_text(&parse_xml(&b, "t").unwrap()[0]), "\u{FFFD}\u{FFFD}x");
}

#[test]
fn rejects_malformed_xml() {
    for bad in [
        "",
        "   ",
        "text",
        "<a>x</a>trailing",
        "<a>x</b>",
        "<a><b></a></b>",
        "<a>",
        "<a><b>",
        "<a b='1' b='2'/>",
        "<a b=1/>",
        "<a b/>",
        "<1a/>",
        "<a 1b='x'/>",
        "<a>&</a>",
        "<a>&lt</a>",
        "</a>",
        "<a><!-- x </a>",
        "<w:document><w:body><w:p></w:document>",
    ] {
        fails(bad);
    }
    let e = parse_xml(&[0xff, 0xfe, b'<', 0, b'a', 0, b'/', 0, b'>', 0], "u").unwrap_err();
    assert_eq!(e.code, ImportErrorCode::InvalidXml, "UTF-16 is not UTF-8");
}

#[test]
fn limits_nesting_like_the_typescript_parser() {
    let nest = |n: usize| format!("{}{}", "<a>".repeat(n), "</a>".repeat(n));
    assert!(parse_xml(nest(101).as_bytes(), "t").is_ok());
    let e = parse_xml(nest(102).as_bytes(), "t").unwrap_err();
    assert_eq!(e.code, ImportErrorCode::InvalidXml);
    assert!(e.message.contains("Maximum nested tags"));
    assert!(parse_xml(nest(5000).as_bytes(), "t").is_err());
}

#[test]
fn on_off_properties() {
    let r = parse(r#"<a><b/><c val="0"/><d val="false"/><e val="off"/><f val="none"/><g val="1"/><h val="true"/></a>"#);
    let on_of = |n: &str| on(child(&r[0], n));
    assert!(on_of("b") && on_of("g") && on_of("h"));
    assert!(!on_of("c") && !on_of("d") && !on_of("e") && !on_of("f") && !on_of("zzz"));
    assert_eq!(child_val(&r[0], "g"), Some("1"));
    assert_eq!(child_val(&r[0], "b"), None);
    assert_eq!(child_val(&r[0], "zzz"), None);
}

#[test]
fn raw_text_skips_deleted_text_and_separates_paragraphs() {
    let r = parse(
        "<d><p><r><t>one</t></r><del><t>gone</t></del><r><tab/><delText>x</delText><instrText>y</instrText></r></p><p><t>two</t></p><p/><p> three</p></d>",
    );
    assert_eq!(raw_text(&r[0]), "one two  three");
    assert_eq!(text_of("<t>a<b>nested</b>c</t>"), "anestedc");
    assert_eq!(own_text(&parse("<t>a<b>nested</b>c</t>")[0]), "ac");
    assert_eq!(text_of("<d><p><t>a </t></p><p><t>b</t></p></d>"), "a b");
    assert_eq!(text_of("<d><p/><p><t>b</t></p></d>"), "b");
}

#[test]
fn descendants_are_found_parent_first_and_stop_at_the_depth_limit() {
    let r = parse("<a><b id='1'><b id='2'/></b><c><b id='3'/></c></a>");
    let ids: Vec<_> = descendants(&r[0], "b").iter().map(|n| attr(n, "id").unwrap()).collect();
    assert_eq!(ids, ["1", "2", "3"]);
    // The XML limit (101 open elements) keeps real files above the walk limit, so deeper trees are built by hand.
    let chain = |depth: usize, leaf: XNode| (0..depth).fold(leaf, |inner, _| XNode::El(Rc::new(Element { name: "a".into(), attrs: vec![], kids: vec![inner] })));
    let b_leaf = || XNode::El(Rc::new(Element { name: "b".into(), ..Element::default() }));
    assert_eq!(descendants(&chain(100, b_leaf()), "b").len(), 1);
    assert_eq!(descendants(&chain(102, b_leaf()), "b").len(), 0, "past the limit nothing is looked at");
    let text_leaf = || XNode::El(Rc::new(Element { name: "t".into(), attrs: vec![], kids: vec![XNode::Text("x".into())] }));
    assert_eq!(raw_text(&chain(99, text_leaf())), "x");
    assert_eq!(raw_text(&chain(105, text_leaf())), "", "text below the depth limit is not read");
}
