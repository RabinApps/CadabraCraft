//! The framed binary body of `typst_compile`.
use super::error::{other, TypstError};

/// A decoded `typst_compile` request.
#[derive(Debug, PartialEq)]
pub struct CompileRequest {
    pub typst_path: Option<String>,
    pub source: String,
    pub files: Vec<(String, Vec<u8>)>,
    pub pdf_a: bool,
}

/// Decodes the binary body of `typst_compile`: a 4-byte little-endian header length, the header (UTF-8 JSON with
/// `typstPath`, `source`, `pdfA` and `files: [{ name, len }]`), then every file's bytes back to back, in header order.
/// The bytes must add up exactly; anything else is refused rather than guessed at. (The TypeScript writer is
/// `packCompileRequest` in `src/lib/compileFrame.ts`.)
pub fn parse_compile_request(body: &[u8]) -> Result<CompileRequest, TypstError> {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Header {
        typst_path: Option<String>,
        source: String,
        pdf_a: bool,
        files: Vec<FileHeader>,
    }
    #[derive(serde::Deserialize)]
    struct FileHeader {
        name: String,
        len: usize,
    }
    let bad = |what: &str| other(format!("bad compile request: {what}"));
    let len_bytes: [u8; 4] = body.get(..4).and_then(|b| b.try_into().ok()).ok_or_else(|| bad("too short"))?;
    let header_len = u32::from_le_bytes(len_bytes) as usize;
    let header_end = 4usize.checked_add(header_len).filter(|e| *e <= body.len()).ok_or_else(|| bad("header runs past the end"))?;
    let header: Header = serde_json::from_slice(&body[4..header_end]).map_err(|e| bad(&e.to_string()))?;
    let mut at = header_end;
    let mut files = Vec::with_capacity(header.files.len());
    for f in header.files {
        let end = at.checked_add(f.len).filter(|e| *e <= body.len()).ok_or_else(|| bad(&format!("file {} runs past the end", f.name)))?;
        files.push((f.name, body[at..end].to_vec()));
        at = end;
    }
    if at != body.len() {
        return Err(bad("extra bytes after the last file"));
    }
    Ok(CompileRequest { typst_path: header.typst_path, source: header.source, files, pdf_a: header.pdf_a })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Builds a request body the way `packCompileRequest` does.
    fn frame(header: &str, tail: &[u8]) -> Vec<u8> {
        let mut v = (header.len() as u32).to_le_bytes().to_vec();
        v.extend_from_slice(header.as_bytes());
        v.extend_from_slice(tail);
        v
    }

    #[test]
    fn compile_request_decodes_options_source_and_files_in_order() {
        let h = r#"{"typstPath":"/x/typst","source":"Hello ✓","pdfA":true,"files":[{"name":"assets/a.png","len":3},{"name":"assets/b.jpg","len":0},{"name":"c.bin","len":2}]}"#;
        let r = parse_compile_request(&frame(h, &[1, 2, 3, 9, 8])).unwrap();
        assert_eq!(
            r,
            CompileRequest {
                typst_path: Some("/x/typst".into()),
                source: "Hello ✓".into(),
                files: vec![("assets/a.png".into(), vec![1, 2, 3]), ("assets/b.jpg".into(), vec![]), ("c.bin".into(), vec![9, 8])],
                pdf_a: true,
            }
        );
        let none = parse_compile_request(&frame(r#"{"typstPath":null,"source":"","pdfA":false,"files":[]}"#, &[])).unwrap();
        assert_eq!((none.typst_path, none.files.len(), none.pdf_a), (None, 0, false));
    }

    #[test]
    fn compile_request_refuses_malformed_bodies() {
        let ok = r#"{"typstPath":null,"source":"s","pdfA":false,"files":[{"name":"a","len":2}]}"#;
        assert!(parse_compile_request(&frame(ok, &[1, 2])).is_ok());
        for (what, body) in [
            ("empty", vec![]),
            ("three bytes", vec![1, 0, 0]),
            ("header longer than the body", [100u32.to_le_bytes().to_vec(), b"{}".to_vec()].concat()),
            ("huge header length", u32::MAX.to_le_bytes().to_vec()),
            ("not json", frame("nope", &[])),
            ("missing field", frame(r#"{"source":"s"}"#, &[])),
            ("file shorter than declared", frame(ok, &[1])),
            ("extra bytes", frame(ok, &[1, 2, 3])),
            ("length overflow", frame(r#"{"typstPath":null,"source":"s","pdfA":false,"files":[{"name":"a","len":18446744073709551615}]}"#, &[1])),
        ] {
            assert!(matches!(parse_compile_request(&body), Err(TypstError::Other { .. })), "{what}");
        }
    }
}
