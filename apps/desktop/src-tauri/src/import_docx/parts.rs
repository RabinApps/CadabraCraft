//! The small parts the body refers to: relationships (`docx/relationships.ts`), styles and the classification of a
//! paragraph style (`docx/styles.ts`), list numbering (`docx/numbering.ts`) and footnotes/endnotes (`docx/notes.ts`).
use super::archive::Files;
use super::error::ImportError;
use super::text::{js_number, js_trim, level_key};
use super::xml::{attr, child, child_val, children_named, find_root, on, parse_xml_in, XNode, XmlBudget};
use std::collections::HashMap;
use std::rc::Rc;

// ---------- relationships ----------

#[derive(Debug, Clone, PartialEq)]
pub struct Rel {
    pub target: String,
    pub external: bool,
}

/// Relationships by id, remembering first-seen order (a repeated id replaces the target but keeps its place).
#[derive(Default, Debug)]
pub struct Rels {
    order: Vec<String>,
    map: HashMap<String, Rel>,
}

impl Rels {
    pub fn get(&self, id: &str) -> Option<&Rel> {
        self.map.get(id)
    }
    pub fn iter(&self) -> impl Iterator<Item = &Rel> {
        self.order.iter().filter_map(|id| self.map.get(id))
    }
}

pub fn parse_rels(bytes: Option<&[u8]>, label: &str, budget: &XmlBudget) -> Result<Rels, ImportError> {
    let mut rels = Rels::default();
    let Some(bytes) = bytes else { return Ok(rels) };
    let roots = parse_xml_in(bytes, label, budget)?;
    let Some(root) = find_root(&roots, "Relationships") else { return Ok(rels) };
    for r in children_named(root, "Relationship") {
        if let (Some(id), Some(target)) = (attr(r, "Id"), attr(r, "Target")) {
            if id.is_empty() || target.is_empty() {
                continue;
            }
            if rels.map.insert(id.to_string(), Rel { target: target.to_string(), external: attr(r, "TargetMode") == Some("External") }).is_none() {
                rels.order.push(id.to_string());
            }
        }
    }
    Ok(rels)
}

/// `/\/(word\/)?document\.xml$/i`: the target ends in `/document.xml` (any letter case).
pub fn is_document_target(target: &str) -> bool {
    let lower = target.to_ascii_lowercase();
    lower.ends_with("/document.xml")
}

/// A relationship target as a path inside the archive: relative targets are relative to `word/`, `.` and empty
/// segments are dropped and `..` pops one level (never above the archive root).
pub fn resolve_part(target: &str) -> String {
    let full = match target.strip_prefix('/') {
        Some(rest) => rest.to_string(),
        None => format!("word/{target}"),
    };
    let mut out: Vec<&str> = Vec::new();
    for p in full.split('/') {
        match p {
            ".." => {
                out.pop();
            }
            "." | "" => {}
            _ => out.push(p),
        }
    }
    out.join("/")
}

// ---------- styles ----------

#[derive(Debug, Clone, PartialEq)]
pub struct StyleInfo {
    pub name: String,
    pub based_on: Option<String>,
    pub num_id: Option<String>,
    pub ilvl: Option<f64>,
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub small_caps: bool,
}

pub type Styles = HashMap<String, StyleInfo>;

pub fn parse_styles(roots: &[XNode]) -> Styles {
    let mut map = Styles::new();
    let Some(styles) = find_root(roots, "styles") else { return map };
    for s in children_named(styles, "style") {
        let Some(id) = attr(s, "styleId").filter(|i| !i.is_empty()) else { continue };
        let rpr = child(s, "rPr");
        let prop = |n: &str| on(rpr.and_then(|r| child(r, n)));
        let num_pr = child(s, "pPr").and_then(|p| child(p, "numPr"));
        map.insert(
            id.to_string(),
            StyleInfo {
                name: child_val(s, "name").unwrap_or(id).to_string(),
                based_on: child_val(s, "basedOn").map(String::from),
                num_id: num_pr.and_then(|n| child_val(n, "numId")).map(String::from),
                ilvl: num_pr.map(|n| child_val(n, "ilvl").map_or(0.0, js_number)),
                bold: prop("b"),
                italic: prop("i"),
                underline: prop("u"),
                small_caps: prop("smallCaps"),
            },
        );
    }
    map
}

#[derive(Debug, Clone, PartialEq)]
pub enum Cls {
    Heading(u8),
    Quote,
    Code,
    List { ordered: bool, level: f64, checked: Option<bool> },
    DefTerm,
    DefDesc,
    Normal { fallback: Option<String> },
}

/// `^<prefix>(?: (\d))?$`: the prefix alone, or followed by one space and one ASCII digit. `Some(None)` is the bare prefix.
fn with_digit(name: &str, prefix: &str) -> Option<Option<u32>> {
    let rest = name.strip_prefix(prefix)?;
    if rest.is_empty() {
        return Some(None);
    }
    let d = rest.strip_prefix(' ')?;
    let mut cs = d.chars();
    let c = cs.next().filter(char::is_ascii_digit)?;
    cs.next().is_none().then(|| Some(c as u32 - '0' as u32))
}

/// What a paragraph style means, following `basedOn` for up to 12 steps. A style with no meaning is `Normal`, and carries
/// the name of the first style looked at (unless it is one of the plain body styles) so the importer can report it.
pub fn classify(style_id: Option<&str>, styles: &Styles) -> Cls {
    let Some(style_id) = style_id.filter(|s| !s.is_empty()) else { return Cls::Normal { fallback: None } };
    let first = styles.get(style_id);
    let mut id = Some(style_id.to_string());
    for _ in 0..12 {
        let Some(cur) = id.filter(|i| !i.is_empty()) else { break };
        let Some(st) = styles.get(&cur) else { break };
        let name = js_trim(&st.name.to_lowercase()).to_string();
        if let Some(l) = name.strip_prefix("heading ") {
            let mut cs = l.chars();
            if let (Some(c @ '1'..='9'), None) = (cs.next(), cs.next()) {
                return Cls::Heading(c as u8 - b'0');
            }
        }
        if ["quote", "block quote", "intense quote", "block text"].contains(&name.as_str()) {
            return Cls::Quote;
        }
        if ["code", "source code", "preformatted text"].contains(&name.as_str()) {
            return Cls::Code;
        }
        if name == "definition term" {
            return Cls::DefTerm;
        }
        if name == "definition" {
            return Cls::DefDesc;
        }
        if let Some(d) = with_digit(&name, "list bullet") {
            return Cls::List { ordered: false, level: d.map_or(0.0, |d| f64::from(d) - 1.0), checked: None };
        }
        if let Some(d) = with_digit(&name, "list number") {
            return Cls::List { ordered: true, level: d.map_or(0.0, |d| f64::from(d) - 1.0), checked: None };
        }
        if ["normal", "body text", "body text 2", "body text 3", "first paragraph", "no spacing", "plain text", "list paragraph", "default"]
            .contains(&name.as_str())
        {
            return Cls::Normal { fallback: None };
        }
        id = st.based_on.clone();
    }
    Cls::Normal { fallback: Some(first.map_or(style_id, |s| s.name.as_str()).to_string()) }
}

// ---------- numbering ----------

#[derive(Default, Debug)]
pub struct Numbering {
    nums: HashMap<String, String>,
    abstracts: HashMap<String, HashMap<u64, String>>,
}

pub fn parse_numbering(roots: &[XNode]) -> Numbering {
    let mut out = Numbering::default();
    let Some(n) = find_root(roots, "numbering") else { return out };
    for a in children_named(n, "abstractNum") {
        let Some(id) = attr(a, "abstractNumId") else { continue };
        let mut levels = HashMap::new();
        for l in children_named(a, "lvl") {
            let ilvl = attr(l, "ilvl").map_or(0.0, js_number);
            levels.insert(level_key(ilvl), child_val(l, "numFmt").unwrap_or("decimal").to_string());
        }
        out.abstracts.insert(id.to_string(), levels);
    }
    for num in children_named(n, "num") {
        if let (Some(id), Some(abs)) = (attr(num, "numId"), child_val(num, "abstractNumId")) {
            out.nums.insert(id.to_string(), abs.to_string());
        }
    }
    out
}

impl Numbering {
    /// `Some(true)` for a numbered list level, `Some(false)` for a bulleted one (also when the level is not defined),
    /// `None` when `numId` is 0, which switches numbering off.
    pub fn ordered(&self, num_id: &str, ilvl: f64) -> Option<bool> {
        if num_id == "0" {
            return None;
        }
        let fmt = self.nums.get(num_id).and_then(|abs| self.abstracts.get(abs)).and_then(|lv| lv.get(&level_key(ilvl)));
        Some(fmt.is_some_and(|f| f != "bullet" && f != "none"))
    }
}

// ---------- notes ----------

pub struct Note {
    pub el: Rc<super::xml::Element>,
}

/// Footnotes and endnotes by `<kind>:<id>`, skipping separators and continuation notices.
pub fn collect_notes(files: &mut Files, budget: &XmlBudget) -> Result<HashMap<String, Note>, ImportError> {
    let mut notes = HashMap::new();
    for (part, tag, kind, prefix) in [("word/footnotes.xml", "footnotes", "footnote", "footnote"), ("word/endnotes.xml", "endnotes", "endnote", "endnote")] {
        let Some(bytes) = files.take(part) else { continue };
        let roots = parse_xml_in(&bytes, part, budget)?;
        drop(bytes);
        let Some(root) = find_root(&roots, tag) else { continue };
        for el in children_named(root, kind) {
            let ty = attr(el, "type");
            if let (Some(id), true) = (attr(el, "id"), ty.is_none() || ty == Some("normal")) {
                if let XNode::El(e) = el {
                    notes.insert(format!("{prefix}:{id}"), Note { el: Rc::clone(e) });
                }
            }
        }
    }
    Ok(notes)
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::import_docx::xml::parse_xml;

    fn xml(s: &str) -> Vec<XNode> {
        parse_xml(s.as_bytes(), "t.xml").unwrap()
    }

    #[test]
    fn relationships_keep_first_seen_order_and_ignore_incomplete_ones() {
        let r = parse_rels(
            Some(br#"<Relationships><Relationship Id="a" Target="x.xml"/><Relationship Id="b" Target="http://e/" TargetMode="External"/><Relationship Id="a" Target="y.xml"/><Relationship Target="no-id"/><Relationship Id="c"/><Relationship Id="" Target="e"/><Relationship Id="d" Target=""/></Relationships>"#),
            "r",
            &XmlBudget::default(),
        )
        .unwrap();
        assert_eq!(r.iter().map(|x| x.target.as_str()).collect::<Vec<_>>(), ["y.xml", "http://e/"]);
        assert!(r.get("b").unwrap().external && !r.get("a").unwrap().external);
        assert!(r.get("c").is_none());
        assert_eq!(parse_rels(None, "r", &XmlBudget::default()).unwrap().iter().count(), 0);
        assert_eq!(parse_rels(Some(b"<other/>"), "r", &XmlBudget::default()).unwrap().iter().count(), 0);
        assert!(parse_rels(Some(b"<Relationships>"), "r", &XmlBudget::default()).is_err());
    }

    #[test]
    fn document_targets_and_part_paths() {
        for yes in ["word/document.xml", "/word/document.xml", "/Word/DOCUMENT.XML", "x/document.xml", "/document.xml"] {
            assert!(is_document_target(yes), "{yes}");
        }
        for no in ["document.xml", "word/document.xml.rels", "word/documents.xml", ""] {
            assert!(!is_document_target(no), "{no}");
        }
        assert_eq!(resolve_part("media/a.png"), "word/media/a.png");
        assert_eq!(resolve_part("/word/media/a.png"), "word/media/a.png");
        assert_eq!(resolve_part("../media/a.png"), "media/a.png");
        assert_eq!(resolve_part("../../../x"), "x");
        assert_eq!(resolve_part("./a//b/./c.png"), "word/a/b/c.png");
        assert_eq!(resolve_part("a/../b"), "word/b");
    }

    fn styles(body: &str) -> Styles {
        parse_styles(&xml(&format!("<w:styles>{body}</w:styles>")))
    }
    fn style(id: &str, name: &str, based: Option<&str>) -> String {
        format!(r#"<w:style w:styleId="{id}"><w:name w:val="{name}"/>{}</w:style>"#, based.map_or(String::new(), |b| format!(r#"<w:basedOn w:val="{b}"/>"#)))
    }

    #[test]
    fn parses_styles() {
        let s = styles(
            r#"<w:style w:styleId="A"><w:name w:val="Alpha"/><w:basedOn w:val="B"/><w:pPr><w:numPr><w:ilvl w:val="2"/><w:numId w:val="7"/></w:numPr></w:pPr><w:rPr><w:b/><w:i w:val="0"/><w:u w:val="single"/><w:smallCaps/></w:rPr></w:style>
               <w:style><w:name w:val="no id"/></w:style><w:style w:styleId=""><w:name w:val="empty id"/></w:style>
               <w:style w:styleId="NoName"/><w:style w:styleId="NP"><w:pPr><w:numPr/></w:pPr></w:style>"#,
        );
        let a = &s["A"];
        assert_eq!((a.name.as_str(), a.based_on.as_deref(), a.num_id.as_deref(), a.ilvl), ("Alpha", Some("B"), Some("7"), Some(2.0)));
        assert!(a.bold && !a.italic && a.underline && a.small_caps);
        assert_eq!(s["NoName"].name, "NoName");
        assert_eq!((s["NoName"].num_id.clone(), s["NoName"].ilvl), (None, None));
        assert_eq!((s["NP"].num_id.clone(), s["NP"].ilvl), (None, Some(0.0)));
        assert_eq!(s.len(), 3);
        assert!(parse_styles(&xml("<other/>")).is_empty());
    }

    #[test]
    fn classifies_styles_by_name_and_through_based_on() {
        let s = styles(
            &[
                style("H1", "heading 1", Some("Normal")),
                style("H9", "Heading 9", None),
                style("H10", "heading 10", None),
                style("Q", " Block Quote ", None),
                style("Code", "Source Code", None),
                style("MyCode", "My Listing", Some("Code")),
                style("DT", "Definition Term", None),
                style("D", "Definition", None),
                style("LB", "List Bullet", None),
                style("LB3", "List Bullet 3", None),
                style("LN2", "list number 2", None),
                style("LN", "List Number", None),
                style("LB10", "List Bullet 10", None),
                style("LBx", "List Bullet x", None),
                style("LB0", "List Bullet 0", None),
                style("Normal", "Normal", None),
                style("BT", "Body Text 3", None),
                style("Custom", "My Custom", Some("Missing")),
                style("Loop1", "L1", Some("Loop2")),
                style("Loop2", "L2", Some("Loop1")),
                style("Chain", "Chain", Some("H1")),
                style("Blank", "Blank", Some("")),
            ]
            .concat(),
        );
        let c = |id| classify(Some(id), &s);
        assert_eq!(c("H1"), Cls::Heading(1));
        assert_eq!(c("H9"), Cls::Heading(9));
        assert_eq!(c("H10"), Cls::Normal { fallback: Some("heading 10".into()) });
        assert_eq!(c("Q"), Cls::Quote);
        assert_eq!(c("Code"), Cls::Code);
        assert_eq!(c("MyCode"), Cls::Code);
        assert_eq!(c("DT"), Cls::DefTerm);
        assert_eq!(c("D"), Cls::DefDesc);
        assert_eq!(c("LB"), Cls::List { ordered: false, level: 0.0, checked: None });
        assert_eq!(c("LB3"), Cls::List { ordered: false, level: 2.0, checked: None });
        assert_eq!(c("LN2"), Cls::List { ordered: true, level: 1.0, checked: None });
        assert_eq!(c("LN"), Cls::List { ordered: true, level: 0.0, checked: None });
        assert_eq!(c("LB0"), Cls::List { ordered: false, level: -1.0, checked: None });
        assert_eq!(c("LB10"), Cls::Normal { fallback: Some("List Bullet 10".into()) });
        assert_eq!(c("LBx"), Cls::Normal { fallback: Some("List Bullet x".into()) });
        assert_eq!(c("Normal"), Cls::Normal { fallback: None });
        assert_eq!(c("BT"), Cls::Normal { fallback: None });
        assert_eq!(c("Custom"), Cls::Normal { fallback: Some("My Custom".into()) });
        assert_eq!(c("Loop1"), Cls::Normal { fallback: Some("L1".into()) });
        assert_eq!(c("Chain"), Cls::Heading(1), "basedOn is followed");
        assert_eq!(c("Blank"), Cls::Normal { fallback: Some("Blank".into()) });
        assert_eq!(c("Unknown"), Cls::Normal { fallback: Some("Unknown".into()) });
        assert_eq!(classify(None, &s), Cls::Normal { fallback: None });
        assert_eq!(classify(Some(""), &s), Cls::Normal { fallback: None });
    }

    #[test]
    fn numbering_formats() {
        let n = parse_numbering(&xml(
            r#"<w:numbering><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="none"/></w:lvl><w:lvl w:ilvl="2"><w:numFmt w:val="decimal"/></w:lvl><w:lvl><w:numFmt w:val="lowerLetter"/></w:lvl><w:lvl w:ilvl="4"/></w:abstractNum>
               <w:abstractNum/><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="9"/></w:num><w:num><w:abstractNumId w:val="0"/></w:num><w:num w:numId="3"/></w:numbering>"#,
        ));
        assert_eq!(n.ordered("0", 0.0), None);
        assert_eq!(n.ordered("1", 1.0), Some(false), "none is not numbered");
        assert_eq!(n.ordered("1", 2.0), Some(true));
        assert_eq!(n.ordered("1", 4.0), Some(true), "a level with no format is decimal");
        assert_eq!(n.ordered("1", 0.0), Some(true), "the later level 0 (letters) replaced the bullet");
        assert_eq!(n.ordered("1", 7.0), Some(false), "an undefined level is a bullet");
        assert_eq!(n.ordered("2", 0.0), Some(false), "an unknown abstract");
        assert_eq!(n.ordered("nope", 0.0), Some(false));
        assert_eq!(n.ordered("1", f64::NAN), Some(false));
        assert!(parse_numbering(&xml("<other/>")).nums.is_empty());
    }

    #[test]
    fn collects_normal_notes_only() {
        let mut files = Files::default();
        files.insert(
            "word/footnotes.xml",
            br#"<w:footnotes><w:footnote w:type="separator" w:id="-1"/><w:footnote w:id="1"><w:p/></w:footnote><w:footnote w:type="normal" w:id="2"/><w:footnote w:type="continuationNotice" w:id="3"/><w:footnote/></w:footnotes>"#.to_vec(),
        );
        files.insert("word/endnotes.xml", br#"<w:endnotes><w:endnote w:id="1"/></w:endnotes>"#.to_vec());
        let n = collect_notes(&mut files, &XmlBudget::default()).unwrap();
        let mut keys: Vec<_> = n.keys().cloned().collect();
        keys.sort();
        assert_eq!(keys, ["endnote:1", "footnote:1", "footnote:2"]);
        // The parts were taken (and freed) by the first call.
        assert_eq!(files.get("word/footnotes.xml"), Some(&b""[..]));
        files.insert("word/footnotes.xml", b"<other/>".to_vec());
        files.insert("word/endnotes.xml", br#"<w:endnotes><w:endnote w:id="1"/></w:endnotes>"#.to_vec());
        assert_eq!(collect_notes(&mut files, &XmlBudget::default()).unwrap().len(), 1);
        files.insert("word/endnotes.xml", b"<w:endnotes>".to_vec());
        assert!(collect_notes(&mut files, &XmlBudget::default()).is_err());
        assert!(collect_notes(&mut Files::default(), &XmlBudget::default()).unwrap().is_empty());
    }
}
