//! Decoding of the `write_project_bytes` request.
use crate::project::ProjectError;
use tauri::ipc::InvokeBody;

/// Decodes `%XX` escapes (UTF-8). Header values are ASCII, so the caller sends paths with `encodeURIComponent`.
pub(super) fn percent_decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = std::str::from_utf8(b.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Pulls `(root, path, bytes)` out of a `write_project_bytes` call. Preferred form: the invoke payload is the raw file
/// bytes and `root` / `path` travel in `encodeURIComponent`-encoded headers (no JSON number array). The old form
/// (JSON body `{ root, path, bytes: number[] }`) is still accepted.
pub(super) fn parse_write_bytes(body: &InvokeBody, headers: &tauri::http::HeaderMap) -> Result<(String, String, Vec<u8>), ProjectError> {
    let bad = |what: &str| ProjectError::Io { message: format!("write_project_bytes: {what}") };
    match body {
        InvokeBody::Raw(bytes) => {
            let header = |name: &str| {
                let v = headers.get(name).and_then(|v| v.to_str().ok()).ok_or_else(|| bad(&format!("missing {name} header")))?;
                percent_decode(v).ok_or_else(|| bad(&format!("bad {name} header")))
            };
            Ok((header("root")?, header("path")?, bytes.clone()))
        }
        InvokeBody::Json(v) => {
            #[derive(serde::Deserialize)]
            struct Legacy {
                root: String,
                path: String,
                bytes: Vec<u8>,
            }
            let l: Legacy = serde_json::from_value(v.clone()).map_err(|e| bad(&e.to_string()))?;
            Ok((l.root, l.path, l.bytes))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::http::{HeaderMap, HeaderValue};

    fn headers(root: &str, path: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert("root", HeaderValue::from_str(root).unwrap());
        h.insert("path", HeaderValue::from_str(path).unwrap());
        h
    }

    #[test]
    fn percent_decode_handles_utf8_and_rejects_bad_escapes() {
        assert_eq!(percent_decode("a%20b%2Fc").as_deref(), Some("a b/c"));
        assert_eq!(percent_decode("%E2%9C%93").as_deref(), Some("\u{2713}"));
        assert_eq!(percent_decode("plain").as_deref(), Some("plain"));
        for bad in ["%", "%2", "%zz", "%FF"] {
            assert_eq!(percent_decode(bad), None, "{bad}");
        }
    }

    #[test]
    fn raw_body_takes_root_and_path_from_headers() {
        let body = InvokeBody::Raw(vec![1, 2, 3]);
        let (r, p, b) = parse_write_bytes(&body, &headers("%2FUsers%2Fa%20b%2FBook", "exports%2Fbook.epub")).unwrap();
        assert_eq!((r.as_str(), p.as_str(), b), ("/Users/a b/Book", "exports/book.epub", vec![1, 2, 3]));
    }

    #[test]
    fn raw_body_without_headers_is_an_error() {
        let err = parse_write_bytes(&InvokeBody::Raw(vec![1]), &HeaderMap::new()).unwrap_err();
        assert!(matches!(err, ProjectError::Io { .. }), "{err:?}");
    }

    #[test]
    fn legacy_json_body_still_works() {
        let body = InvokeBody::Json(serde_json::json!({ "root": "/r", "path": "exports/a.pdf", "bytes": [7, 8] }));
        assert_eq!(parse_write_bytes(&body, &HeaderMap::new()).unwrap(), ("/r".into(), "exports/a.pdf".into(), vec![7, 8]));
        assert!(parse_write_bytes(&InvokeBody::Json(serde_json::json!({ "root": 1 })), &HeaderMap::new()).is_err());
    }
}
