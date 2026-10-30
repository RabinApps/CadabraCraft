//! A small XML tree for the `.docx` parts, on `quick-xml`'s pull reader.
//!
//! It mirrors what `docx/xml.ts` gets from fast-xml-parser (`preserveOrder`, namespace prefixes removed, white space
//! kept): elements are named by their local name (`w:p` is `p`), attributes likewise (`w:val` is `val`, `xmlns` declarations
//! are dropped, a later attribute of the same local name wins), and text is kept as written, with line ends normalised.
//! `&amp; &lt; &gt; &quot; &apos;` and numeric character references are decoded; any other entity stays as the text
//! `&name;` (a `<!DOCTYPE>` is skipped and never expanded, so an entity bomb has nothing to expand).
use super::error::{ImportError, ImportErrorCode};
use super::text::is_js_space;
use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;
use std::cell::Cell;
use std::rc::Rc;

/// fast-xml-parser refuses more than 101 open elements ("Maximum nested tags exceeded").
const MAX_OPEN_ELEMENTS: usize = 101;
/// Recursion limit of the tree walks (`MAX_XML_DEPTH` in `docx/xml.ts`).
pub const MAX_XML_DEPTH: usize = 100;

/// What one import may build as XML trees, summed over every part (a `<w:p/>` is about 150 bytes of tree, so the defaults
/// keep the trees of a hostile archive near 300 MB however the 200 MB of archive is spent).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct XmlLimits {
    pub max_elements: usize,
    pub max_attributes: usize,
    /// Bytes of character data (after entity decoding).
    pub max_text_bytes: usize,
    /// Attributes on one element. Each new attribute is compared with the earlier ones, so this also bounds that quadratic scan.
    pub max_attributes_per_element: usize,
}

impl Default for XmlLimits {
    fn default() -> XmlLimits {
        XmlLimits { max_elements: 2_000_000, max_attributes: 4_000_000, max_text_bytes: 64 * 1024 * 1024, max_attributes_per_element: 256 }
    }
}

/// Running totals against [`XmlLimits`], shared by every `parse_xml_in` call of one import.
#[derive(Debug, Default)]
pub struct XmlBudget {
    limits: XmlLimits,
    elements: Cell<usize>,
    attributes: Cell<usize>,
    text: Cell<usize>,
}

impl XmlBudget {
    pub fn new(limits: XmlLimits) -> XmlBudget {
        XmlBudget { limits, ..XmlBudget::default() }
    }
    fn spend(counter: &Cell<usize>, n: usize, max: usize, what: &str, label: &str) -> Result<(), ImportError> {
        let total = counter.get().saturating_add(n);
        counter.set(total);
        if total > max {
            return Err(ImportError::new(ImportErrorCode::TooManyNodes, format!("{label} is too big to read: the document has more than {max} {what}.")));
        }
        Ok(())
    }
    fn element(&self, label: &str) -> Result<(), ImportError> {
        Self::spend(&self.elements, 1, self.limits.max_elements, "elements", label)
    }
    fn attribute(&self, label: &str) -> Result<(), ImportError> {
        Self::spend(&self.attributes, 1, self.limits.max_attributes, "attributes", label)
    }
    fn text(&self, n: usize, label: &str) -> Result<(), ImportError> {
        Self::spend(&self.text, n, self.limits.max_text_bytes, "bytes of text", label)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum XNode {
    Text(String),
    El(Rc<Element>),
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Element {
    pub name: String,
    pub attrs: Vec<(String, String)>,
    pub kids: Vec<XNode>,
}

pub fn tag_of(n: &XNode) -> &str {
    match n {
        XNode::Text(_) => "#text",
        XNode::El(e) => &e.name,
    }
}

pub fn kids(n: &XNode) -> &[XNode] {
    match n {
        XNode::Text(_) => &[],
        XNode::El(e) => &e.kids,
    }
}

pub fn attr<'a>(n: &'a XNode, name: &str) -> Option<&'a str> {
    match n {
        XNode::Text(_) => None,
        XNode::El(e) => e.attrs.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str()),
    }
}

pub fn child<'a>(n: &'a XNode, name: &str) -> Option<&'a XNode> {
    kids(n).iter().find(|k| tag_of(k) == name)
}

pub fn children_named<'a>(n: &'a XNode, name: &'a str) -> impl Iterator<Item = &'a XNode> {
    kids(n).iter().filter(move |k| tag_of(k) == name)
}

/// The `val` attribute convention of Word's on/off properties: present and not `0`, `false`, `off` or `none` (or the
/// element is absent: false).
pub fn on(n: Option<&XNode>) -> bool {
    match n {
        None => false,
        Some(n) => !matches!(attr(n, "val"), Some("0" | "false" | "off" | "none")),
    }
}

/// `attr(child(n, name) ?? {}, "val")`: the `val` of a named child.
pub fn child_val<'a>(n: &'a XNode, name: &str) -> Option<&'a str> {
    child(n, name).and_then(|c| attr(c, "val"))
}

/// Every descendant element named `name`, parents before children, not looking deeper than `MAX_XML_DEPTH`.
pub fn descendants<'a>(n: &'a XNode, name: &str) -> Vec<&'a XNode> {
    fn go<'a>(n: &'a XNode, name: &str, out: &mut Vec<&'a XNode>, depth: usize) {
        if depth > MAX_XML_DEPTH {
            return;
        }
        for k in kids(n) {
            if tag_of(k) == name {
                out.push(k);
            }
            go(k, name, out, depth + 1);
        }
    }
    let mut out = Vec::new();
    go(n, name, &mut out, 0);
    out
}

/// The `#text` children of an element, joined (what `w:t` and `w:instrText` hold).
pub fn own_text(n: &XNode) -> String {
    kids(n).iter().filter_map(|x| if let XNode::Text(t) = x { Some(t.as_str()) } else { None }).collect()
}

/// Visible text of an element (`w:t`, math text, tabs as spaces), skipping deleted text.
pub fn raw_text(n: &XNode) -> String {
    fn go(n: &XNode, depth: usize) -> String {
        if depth > MAX_XML_DEPTH {
            return String::new();
        }
        let mut s = String::new();
        for k in kids(n) {
            match k {
                XNode::Text(t) => s.push_str(t),
                XNode::El(_) => match tag_of(k) {
                    "t" => s.push_str(&own_text(k)),
                    "tab" => s.push(' '),
                    "del" | "moveFrom" | "delText" | "instrText" => {}
                    "p" if !s.is_empty() && !s.ends_with(' ') => {
                        s.push(' ');
                        s.push_str(&go(k, depth + 1));
                    }
                    _ => s.push_str(&go(k, depth + 1)),
                },
            }
        }
        s
    }
    go(n, 0)
}

fn invalid(name: &str, why: impl std::fmt::Display) -> ImportError {
    ImportError::new(ImportErrorCode::InvalidXml, format!("{name} is not well-formed XML ({why})."))
}

/// A name fast-xml-parser's validator accepts: starts with a letter, `_` or `:` (or a non-ASCII character); continues with those, digits, `-` or `.`.
fn valid_name(s: &str) -> bool {
    let mut cs = s.chars();
    let start = |c: char| c.is_alphabetic() || c == '_' || c == ':' || !c.is_ascii();
    cs.next().is_some_and(start) && cs.all(|c| start(c) || c.is_ascii_digit() || c == '-' || c == '.')
}

fn local(name: &str) -> &str {
    name.split_once(':').map_or(name, |(_, l)| l)
}

/// Decodes the entities in an attribute value; an unknown or malformed reference is kept as written.
fn decode_attr(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut rest = raw;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        rest = &rest[at..];
        match rest.find(';').filter(|e| *e > 1) {
            Some(end) => {
                match resolve_ref(&rest[1..end]) {
                    Some(s) => out.push_str(&s),
                    None => out.push_str(&rest[..=end]),
                }
                rest = &rest[end + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// The text a reference name stands for: a predefined entity or a character reference; `None` for anything else.
fn resolve_ref(name: &str) -> Option<String> {
    match name {
        "amp" => Some("&".into()),
        "lt" => Some("<".into()),
        "gt" => Some(">".into()),
        "quot" => Some("\"".into()),
        "apos" => Some("'".into()),
        _ => {
            let num = name.strip_prefix('#')?;
            let code = match num.strip_prefix(['x', 'X']) {
                Some(hex) => u32::from_str_radix(hex, 16).ok()?,
                None => num.parse().ok()?,
            };
            char::from_u32(code).filter(|c| *c != '\0').map(String::from)
        }
    }
}

fn open_element(e: &BytesStart<'_>, label: &str, budget: &XmlBudget) -> Result<Element, ImportError> {
    budget.element(label)?;
    let full = e.name().as_ref().to_string();
    if !valid_name(&full) {
        return Err(invalid(label, format!("tag '{full}' is an invalid name")));
    }
    let mut attrs: Vec<(String, String)> = Vec::new();
    for a in e.attributes() {
        let a = a.map_err(|err| invalid(label, err))?;
        budget.attribute(label)?;
        if attrs.len() >= budget.limits.max_attributes_per_element {
            return Err(ImportError::new(ImportErrorCode::TooManyNodes, format!("{label} has an element with more than {} attributes.", budget.limits.max_attributes_per_element)));
        }
        let key = a.key.as_ref();
        if !valid_name(key) {
            return Err(invalid(label, format!("attribute '{key}' is an invalid name")));
        }
        if key == "xmlns" || key.starts_with("xmlns:") {
            continue;
        }
        let value = decode_attr(&a.value);
        match attrs.iter_mut().find(|(k, _)| k == local(key)) {
            Some(slot) => slot.1 = value,
            None => attrs.push((local(key).to_string(), value)),
        }
    }
    Ok(Element { name: local(&full).to_string(), attrs, kids: Vec::new() })
}

/// [`parse_xml_in`] with a budget of its own (the default limits), for one part on its own.
#[cfg(test)]
pub fn parse_xml(bytes: &[u8], label: &str) -> Result<Vec<XNode>, ImportError> {
    parse_xml_in(bytes, label, &XmlBudget::default())
}

/// Parses an XML part into its top-level elements. Any well-formedness problem is `invalid-xml`; `label` names the part.
/// Elements, attributes and text are counted against `budget` as they are built, so a part that would not fit fails
/// (`too-many-nodes`) before its tree exists instead of after it has used the memory. `bytes` is borrowed as UTF-8 when it
/// is valid (the usual case); only invalid UTF-8 is copied, with U+FFFD in place of the bad bytes.
pub fn parse_xml_in(bytes: &[u8], label: &str, budget: &XmlBudget) -> Result<Vec<XNode>, ImportError> {
    // Lossy UTF-8, then any leading byte-order marks removed (the decoder drops one, the importer then drops another).
    let decoded = String::from_utf8_lossy(bytes);
    let src = decoded.strip_prefix('\u{feff}').unwrap_or(&decoded);
    let src = src.strip_prefix('\u{feff}').unwrap_or(src);

    let mut reader = Reader::from_str(src);
    let mut stack: Vec<Element> = Vec::new();
    let mut roots: Vec<XNode> = Vec::new();

    fn push_node(stack: &mut [Element], roots: &mut Vec<XNode>, n: Element) {
        match stack.last_mut() {
            Some(parent) => parent.kids.push(XNode::El(Rc::new(n))),
            None => roots.push(XNode::El(Rc::new(n))),
        }
    }
    fn push_text(stack: &mut [Element], text: &str, label: &str, budget: &XmlBudget) -> Result<(), ImportError> {
        match stack.last_mut() {
            Some(parent) => {
                budget.text(text.len(), label)?;
                match parent.kids.last_mut() {
                    Some(XNode::Text(t)) => t.push_str(text),
                    _ => parent.kids.push(XNode::Text(text.to_string())),
                }
                Ok(())
            }
            None if text.chars().all(is_js_space) => Ok(()),
            None => Err(invalid(label, "text outside the root element")),
        }
    }

    loop {
        let ev = reader.read_event().map_err(|e| invalid(label, e))?;
        match ev {
            Event::Start(e) => {
                if stack.len() >= MAX_OPEN_ELEMENTS {
                    return Err(ImportError::new(ImportErrorCode::InvalidXml, format!("{label} could not be parsed (Maximum nested tags exceeded).")));
                }
                stack.push(open_element(&e, label, budget)?);
            }
            Event::Empty(e) => {
                let el = open_element(&e, label, budget)?;
                push_node(&mut stack, &mut roots, el);
            }
            Event::End(_) => {
                // quick-xml has already checked that the name matches the open element.
                let el = stack.pop().ok_or_else(|| invalid(label, "unexpected closing tag"))?;
                push_node(&mut stack, &mut roots, el);
            }
            Event::Text(t) => push_text(&mut stack, &t.xml10_content(), label, budget)?,
            Event::CData(t) => push_text(&mut stack, &t.xml10_content(), label, budget)?,
            Event::GeneralRef(r) => {
                let name = r.into_inner();
                let text = resolve_ref(&name).unwrap_or_else(|| format!("&{name};"));
                push_text(&mut stack, &text, label, budget)?;
            }
            Event::Eof => break,
            Event::Decl(_) | Event::PI(_) | Event::Comment(_) | Event::DocType(_) => {}
        }
    }
    if !stack.is_empty() {
        return Err(invalid(label, format!("unclosed tag '{}'", stack.last().map_or("", |e| e.name.as_str()))));
    }
    if roots.is_empty() {
        return Err(invalid(label, "start tag expected"));
    }
    Ok(roots)
}

/// The first top-level element named `name`.
pub fn find_root<'a>(roots: &'a [XNode], name: &str) -> Option<&'a XNode> {
    roots.iter().find(|n| tag_of(n) == name)
}

#[cfg(test)]
mod tests {
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
}
