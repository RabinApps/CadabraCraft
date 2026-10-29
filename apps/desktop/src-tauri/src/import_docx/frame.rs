//! The binary reply of the `import_docx` command: a 4-byte little-endian header length, the header (UTF-8 JSON with
//! `chapters`, `warnings` and `assets: [{ sourcePath, targetPath, mediaType, len }]`), then every asset's bytes back to
//! back in header order. Image bytes cross the IPC once, as raw bytes, never as JSON numbers. (The TypeScript reader is
//! `decodeDocxImport` in `src/lib/docxFrame.ts`.)
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

/// The whole reply body.
pub fn encode(r: &ImportResult) -> serde_json::Result<Vec<u8>> {
    let header = header_json(r)?;
    let total: usize = r.assets.iter().map(|a| a.bytes.len()).sum();
    let mut out = Vec::with_capacity(4 + header.len() + total);
    // A header over 4 GiB cannot be produced from at most 200 MB of input; `try_from` keeps the cast honest.
    let len = u32::try_from(header.len()).map_err(|_| serde::ser::Error::custom("import header too large"))?;
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
    fn an_empty_result_is_just_the_header() {
        let r = ImportResult { chapters: vec![], warnings: vec![], assets: vec![] };
        let body = encode(&r).unwrap();
        assert_eq!(&body[4..], br#"{"chapters":[],"warnings":[],"assets":[]}"#);
        assert_eq!(header_json(&r).unwrap().len() + 4, body.len());
    }
}
