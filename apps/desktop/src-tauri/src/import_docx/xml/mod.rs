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
            return Err(ImportError::new(
                ImportErrorCode::TooManyNodes,
                format!("{label} has an element with more than {} attributes.", budget.limits.max_attributes_per_element),
            ));
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
mod tests;
