//! The chapter document as plain data: the Rust twin of `DocNode` and `Mark` in `packages/shared`.
//! Field order (`type`, `attrs`, `content`, `text`, `marks`) matches what the TypeScript importer builds, so the JSON
//! written to disk has the same key order whichever importer produced it.
use serde::ser::{SerializeMap, Serializer};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq)]
pub enum Attrs {
    /// `align` is the author's `textAlign` (`start`, `center` or `end`), absent when the template decides.
    Heading { level: u8, align: Option<&'static str> },
    /// A paragraph with an alignment; a paragraph without one has no attrs.
    Align { align: &'static str },
    Image { src: String, alt: Option<String> },
    Task { checked: bool },
}

impl Serialize for Attrs {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            Attrs::Heading { level, align } => {
                let mut m = s.serialize_map(Some(1 + usize::from(align.is_some())))?;
                m.serialize_entry("level", level)?;
                if let Some(a) = align {
                    m.serialize_entry("textAlign", a)?;
                }
                m.end()
            }
            Attrs::Align { align } => {
                let mut m = s.serialize_map(Some(1))?;
                m.serialize_entry("textAlign", align)?;
                m.end()
            }
            Attrs::Image { src, alt } => {
                let mut m = s.serialize_map(Some(3))?;
                m.serialize_entry("src", src)?;
                m.serialize_entry("alt", alt)?;
                m.serialize_entry("title", &None::<String>)?;
                m.end()
            }
            Attrs::Task { checked } => {
                let mut m = s.serialize_map(Some(1))?;
                m.serialize_entry("checked", checked)?;
                m.end()
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Node {
    #[serde(rename = "type")]
    pub ty: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attrs: Option<Attrs>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<Vec<Node>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub marks: Option<Vec<Mark>>,
}

impl Node {
    pub fn new(ty: &'static str) -> Node {
        Node { ty, attrs: None, content: None, text: None, marks: None }
    }
    pub fn with(ty: &'static str, content: Vec<Node>) -> Node {
        Node { content: Some(content), ..Node::new(ty) }
    }
    pub fn with_attrs(ty: &'static str, attrs: Attrs, content: Vec<Node>) -> Node {
        Node { attrs: Some(attrs), content: Some(content), ..Node::new(ty) }
    }
    /// A text node with no marks, built directly (separators and table text; `text_node` is the cleaning constructor).
    pub fn plain_text(text: &str) -> Node {
        Node { text: Some(text.to_string()), ..Node::new("text") }
    }
    pub fn paragraph() -> Node {
        Node::new("paragraph")
    }
    /// This paragraph or heading with the alignment `align` (`None`, and any other node, stay as they are).
    pub fn aligned(mut self, align: Option<&'static str>) -> Node {
        let Some(align) = align else { return self };
        match (&self.ty, &self.attrs) {
            (&"paragraph", None) => self.attrs = Some(Attrs::Align { align }),
            (&"heading", Some(Attrs::Heading { level, align: None })) => {
                self.attrs = Some(Attrs::Heading { level: *level, align: Some(align) });
            }
            _ => {}
        }
        self
    }
    pub fn children(&self) -> &[Node] {
        self.content.as_deref().unwrap_or(&[])
    }
    pub fn is(&self, ty: &str) -> bool {
        self.ty == ty
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Mark {
    pub ty: &'static str,
    /// Only the link mark has an address.
    pub href: Option<String>,
}

impl Mark {
    pub fn of(ty: &'static str) -> Mark {
        Mark { ty, href: None }
    }
    pub fn link(href: String) -> Mark {
        Mark { ty: "link", href: Some(href) }
    }
}

impl Serialize for Mark {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let mut m = s.serialize_map(Some(if self.href.is_some() { 2 } else { 1 }))?;
        m.serialize_entry("type", self.ty)?;
        if let Some(h) = &self.href {
            m.serialize_entry("attrs", &Href { href: h })?;
        }
        m.end()
    }
}

#[derive(Serialize)]
struct Href<'a> {
    href: &'a str,
}

/// Inline content plus the two separators importers use: a manual line break, and a block lifted out of a paragraph.
#[derive(Debug, Clone, PartialEq)]
pub enum Item {
    Node(Node),
    Break,
    Block(Node),
}
