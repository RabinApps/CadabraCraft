//! The binary reply of the `import_docx` command: a 4-byte little-endian header length, the header (UTF-8 JSON with
//! `chapters`, `warnings` and `assets: [{ sourcePath, targetPath, mediaType, len }]`), then every asset's bytes back to
//! back in header order. Image bytes cross the IPC once, as raw bytes, never as JSON numbers. (The TypeScript reader is
//! `decodeDocxImport` in `src/lib/export/docxFrame.ts`.)
use super::assets::AssetInfo;
use super::blocks::Chapter;
use super::ImportResult;
use serde::ser::{SerializeStruct, Serializer};
use serde::Serialize;

impl Serialize for Chapter {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let mut st = s.serialize_struct("Chapter", 2)?;
        st.serialize_field("title", &self.title)?;
        st.serialize_field("doc", &self.doc)?;
        st.end()
    }
}

#[derive(Serialize)]
struct Header<'a> {
    chapters: &'a [Chapter],
    warnings: &'a [super::warnings::Warning],
    assets: Vec<AssetInfo<'a>>,
}

/// The JSON the contract fixtures hold for a result: the header without the bytes (their length and the sha-free
/// description are enough, the bytes themselves are compared by length and by the test that extracts them).
pub fn header_json(r: &ImportResult) -> serde_json::Result<String> {
    serde_json::to_string(&Header { chapters: &r.chapters, warnings: &r.warnings, assets: r.assets.iter().map(|a| a.info()).collect() })
}

/// A length that must fit the 32-bit offsets of the reader; never truncated.
fn to_u32(n: usize, what: &str) -> serde_json::Result<u32> {
    u32::try_from(n).map_err(|_| serde::ser::Error::custom(format!("{what} exceeds 4 GiB")))
}

/// The whole reply body. Every length that the webview reads as 32 bits (the header, each image, the whole reply's
/// payload) is checked with `try_from`: a larger one is an error, never a truncated number.
pub fn encode(r: &ImportResult) -> serde_json::Result<Vec<u8>> {
    let header = header_json(r)?;
    let mut total: usize = 0;
    for a in &r.assets {
        to_u32(a.bytes.len(), "an imported image")?;
        total = total.saturating_add(a.bytes.len());
    }
    to_u32(total, "the total of the imported images")?;
    let len = to_u32(header.len(), "the import header")?;
    let mut out = Vec::with_capacity(4 + header.len() + total);
    out.extend_from_slice(&len.to_le_bytes());
    out.extend_from_slice(header.as_bytes());
    for a in &r.assets {
        out.extend_from_slice(&a.bytes);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import_docx::assets::Asset;
    use crate::import_docx::node::Node;
    use crate::import_docx::warnings::{Severity, Warning};

    fn sample() -> ImportResult {
        ImportResult {
            chapters: vec![Chapter { title: "One".into(), doc: Node::with("doc", vec![Node::paragraph()]) }],
            warnings: vec![Warning { code: "w".into(), severity: Severity::Info, message: "m".into(), count: Some(2), examples: vec!["e".into()] }],
            assets: vec![
                Asset { source_path: "word/media/a.png".into(), target_path: "assets/a.png".into(), media_type: "image/png", bytes: vec![1, 2, 3] },
                Asset { source_path: "word/media/b.gif".into(), target_path: "assets/b.gif".into(), media_type: "image/gif", bytes: vec![9] },
            ],
        }
    }

    #[test]
    fn the_reply_is_a_length_a_json_header_and_the_asset_bytes_in_order() {
        let body = encode(&sample()).unwrap();
        let len = u32::from_le_bytes(body[..4].try_into().unwrap()) as usize;
        let header: serde_json::Value = serde_json::from_slice(&body[4..4 + len]).unwrap();
        assert_eq!(header["chapters"][0]["title"], "One");
        assert_eq!(header["chapters"][0]["doc"]["type"], "doc");
        assert_eq!(header["warnings"][0]["count"], 2);
        assert_eq!(header["assets"][0]["sourcePath"], "word/media/a.png");
        assert_eq!(header["assets"][0]["targetPath"], "assets/a.png");
        assert_eq!(header["assets"][0]["mediaType"], "image/png");
        assert_eq!(header["assets"][0]["len"], 3);
        assert_eq!(header["assets"][1]["len"], 1);
        assert_eq!(&body[4 + len..], [1, 2, 3, 9]);
    }

    #[test]
    fn lengths_over_32_bits_are_errors_not_truncations() {
        assert_eq!(to_u32(7, "x").unwrap(), 7);
        assert_eq!(to_u32(u32::MAX as usize, "x").unwrap(), u32::MAX);
        let e = to_u32(u32::MAX as usize + 1, "an imported image").unwrap_err();
        assert_eq!(e.to_string(), "an imported image exceeds 4 GiB");
        assert!(to_u32(usize::MAX, "x").is_err());
    }

    /// `vec![0; n]` is a lazily zeroed allocation, so a 4 GiB payload costs address space only: `encode` refuses it before copying a byte.
    #[cfg(target_pointer_width = "64")]
    #[test]
    fn an_image_or_a_total_over_4_gib_is_refused_before_anything_is_copied() {
        let image = |n: usize| Asset { source_path: "word/media/a.png".into(), target_path: "assets/a.png".into(), media_type: "image/png", bytes: vec![0u8; n] };
        let one = ImportResult { chapters: vec![], warnings: vec![], assets: vec![image(u32::MAX as usize + 1)] };
        assert_eq!(encode(&one).unwrap_err().to_string(), "an imported image exceeds 4 GiB");
        let two = ImportResult { chapters: vec![], warnings: vec![], assets: vec![image(3 << 30), image(3 << 30)] };
        assert_eq!(encode(&two).unwrap_err().to_string(), "the total of the imported images exceeds 4 GiB");
    }

    #[test]
    fn an_empty_result_is_just_the_header() {
        let r = ImportResult { chapters: vec![], warnings: vec![], assets: vec![] };
        let body = encode(&r).unwrap();
        assert_eq!(&body[4..], br#"{"chapters":[],"warnings":[],"assets":[]}"#);
        assert_eq!(header_json(&r).unwrap().len() + 4, body.len());
    }
}
