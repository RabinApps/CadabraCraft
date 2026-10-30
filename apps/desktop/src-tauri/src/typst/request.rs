//! The framed binary bodies of `typst_compile` and `typst_query`.
use super::error::{other, TypstError};

/// A decoded `typst_compile` request.
#[derive(Debug, PartialEq)]
pub struct CompileRequest {
    pub source: String,
    pub files: Vec<(String, Vec<u8>)>,
    pub pdf_a: bool,
    pub pdf_ua: bool,
}

/// A decoded `typst_query` request.
#[derive(Debug, PartialEq)]
pub struct QueryRequest {
    pub source: String,
    pub files: Vec<(String, Vec<u8>)>,
    pub selector: String,
}

#[derive(serde::Deserialize)]
struct FileHeader {
    name: String,
    len: usize,
}

type Files = Vec<(String, Vec<u8>)>;

/// Splits a framed body into its JSON header (as `H`) and the files the header lists, in order.
fn split_frame<H: serde::de::DeserializeOwned>(body: &[u8], files_of: impl Fn(&H) -> &[FileHeader]) -> Result<(H, Files), TypstError> {
    let bad = |what: &str| other(format!("bad compile request: {what}"));
    let len_bytes: [u8; 4] = body.get(..4).and_then(|b| b.try_into().ok()).ok_or_else(|| bad("too short"))?;
    let header_len = u32::from_le_bytes(len_bytes) as usize;
    let header_end = 4usize.checked_add(header_len).filter(|e| *e <= body.len()).ok_or_else(|| bad("header runs past the end"))?;
    let header: H = serde_json::from_slice(&body[4..header_end]).map_err(|e| bad(&e.to_string()))?;
    let mut at = header_end;
    let mut files = Vec::with_capacity(files_of(&header).len());
    for f in files_of(&header) {
        let end = at.checked_add(f.len).filter(|e| *e <= body.len()).ok_or_else(|| bad(&format!("file {} runs past the end", f.name)))?;
        files.push((f.name.clone(), body[at..end].to_vec()));
        at = end;
    }
    if at != body.len() {
        return Err(bad("extra bytes after the last file"));
    }
    Ok((header, files))
}

/// Decodes the binary body of `typst_compile`: a 4-byte little-endian header length, the header (UTF-8 JSON with
/// `source`, `pdfA` and `files: [{ name, len }]`), then every file's bytes back to back, in header order.
/// The bytes must add up exactly; anything else is refused rather than guessed at. (The TypeScript writer is
/// `packCompileRequest` in `src/lib/compileFrame.ts`.)
pub fn parse_compile_request(body: &[u8]) -> Result<CompileRequest, TypstError> {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Header {
        source: String,
        pdf_a: bool,
        #[serde(default)]
        pdf_ua: bool,
        files: Vec<FileHeader>,
    }
    let (header, files) = split_frame(body, |h: &Header| &h.files)?;
    Ok(CompileRequest { source: header.source, files, pdf_a: header.pdf_a, pdf_ua: header.pdf_ua })
}

/// Decodes the binary body of `typst_query`: the same frame as `typst_compile` with a `selector` header field in
/// place of `pdfA` (`packQueryRequest` in `src/lib/compileFrame.ts` writes it).
pub fn parse_query_request(body: &[u8]) -> Result<QueryRequest, TypstError> {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Header {
        source: String,
        selector: String,
        files: Vec<FileHeader>,
    }
    let (header, files) = split_frame(body, |h: &Header| &h.files)?;
    Ok(QueryRequest { source: header.source, files, selector: header.selector })
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
        let h = r#"{"source":"Hello ✓","pdfA":true,"pdfUa":true,"files":[{"name":"assets/a.png","len":3},{"name":"assets/b.jpg","len":0},{"name":"c.bin","len":2}]}"#;
        let r = parse_compile_request(&frame(h, &[1, 2, 3, 9, 8])).unwrap();
        assert_eq!(r, CompileRequest { source: "Hello ✓".into(), files: vec![("assets/a.png".into(), vec![1, 2, 3]), ("assets/b.jpg".into(), vec![]), ("c.bin".into(), vec![9, 8])], pdf_a: true, pdf_ua: true });
        let none = parse_compile_request(&frame(r#"{"source":"","pdfA":false,"files":[]}"#, &[])).unwrap();
        assert_eq!((none.files.len(), none.pdf_a, none.pdf_ua), (0, false, false));
    }

    #[test]
    fn a_program_path_in_the_header_is_ignored() {
        let with = r#"{"typstPath":"/bin/sh","source":"s","pdfA":false,"selector":"<x>","files":[]}"#;
        assert_eq!(parse_compile_request(&frame(with, &[])).unwrap(), CompileRequest { source: "s".into(), files: vec![], pdf_a: false, pdf_ua: false });
        assert_eq!(parse_query_request(&frame(with, &[])).unwrap(), QueryRequest { source: "s".into(), files: vec![], selector: "<x>".into() });
    }

    #[test]
    fn compile_request_refuses_malformed_bodies() {
        let ok = r#"{"source":"s","pdfA":false,"files":[{"name":"a","len":2}]}"#;
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
            ("length overflow", frame(r#"{"source":"s","pdfA":false,"files":[{"name":"a","len":18446744073709551615}]}"#, &[1])),
        ] {
            assert!(matches!(parse_compile_request(&body), Err(TypstError::Other { .. })), "{what}");
        }
    }

    #[test]
    fn query_request_decodes_the_selector_source_and_files() {
        let h = r#"{"source":"s","selector":"<page-report>","files":[{"name":"a.png","len":2}]}"#;
        let r = parse_query_request(&frame(h, &[7, 8])).unwrap();
        assert_eq!(r, QueryRequest { source: "s".into(), files: vec![("a.png".into(), vec![7, 8])], selector: "<page-report>".into() });
        for (what, body) in [
            ("no selector", frame(r#"{"source":"s","files":[]}"#, &[])),
            ("a compile frame", frame(r#"{"source":"s","pdfA":false,"files":[]}"#, &[])),
            ("file shorter than declared", frame(h, &[7])),
            ("extra bytes", frame(h, &[7, 8, 9])),
            ("empty", vec![]),
        ] {
            assert!(matches!(parse_query_request(&body), Err(TypstError::Other { .. })), "{what}");
        }
    }
}
