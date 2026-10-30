//! Decoding of the binary requests (`write_project_bytes`, `import_asset_bytes`).
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

/// Pulls the named header values and the raw body out of a binary request: the invoke payload is the raw file bytes and
/// the small string arguments travel in `encodeURIComponent`-encoded headers (never a JSON number array, which would
/// use several times the payload in memory before any size check). A JSON body is refused.
fn parse_raw<const N: usize>(command: &str, names: [&str; N], body: &InvokeBody, headers: &tauri::http::HeaderMap) -> Result<([String; N], Vec<u8>), ProjectError> {
    let bad = |what: &str| ProjectError::Io { message: format!("{command}: {what}") };
    let InvokeBody::Raw(bytes) = body else {
        return Err(bad("expected a binary request body"));
    };
    let mut values: [String; N] = std::array::from_fn(|_| String::new());
    for (slot, name) in values.iter_mut().zip(names) {
        let v = headers.get(name).and_then(|v| v.to_str().ok()).ok_or_else(|| bad(&format!("missing {name} header")))?;
        *slot = percent_decode(v).ok_or_else(|| bad(&format!("bad {name} header")))?;
    }
    Ok((values, bytes.clone()))
}

/// `(root, path, bytes)` of a `write_project_bytes` call.
pub(super) fn parse_write_bytes(body: &InvokeBody, headers: &tauri::http::HeaderMap) -> Result<(String, String, Vec<u8>), ProjectError> {
    let ([root, path], bytes) = parse_raw("write_project_bytes", ["root", "path"], body, headers)?;
    Ok((root, path, bytes))
}

/// `(root, name, bytes)` of an `import_asset_bytes` call.
pub(super) fn parse_asset_bytes(body: &InvokeBody, headers: &tauri::http::HeaderMap) -> Result<(String, String, Vec<u8>), ProjectError> {
    let ([root, name], bytes) = parse_raw("import_asset_bytes", ["root", "name"], body, headers)?;
    Ok((root, name, bytes))
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
    fn a_header_with_a_bad_escape_is_an_error_that_names_it() {
        let err = parse_write_bytes(&InvokeBody::Raw(vec![1]), &headers("%zz", "exports%2Fa.bin")).unwrap_err();
        assert!(matches!(&err, ProjectError::Io { message } if message.contains("bad root header")), "{err:?}");
    }

    #[test]
    fn raw_body_without_headers_is_an_error() {
        let err = parse_write_bytes(&InvokeBody::Raw(vec![1]), &HeaderMap::new()).unwrap_err();
        assert!(matches!(err, ProjectError::Io { .. }), "{err:?}");
    }

    #[test]
    fn a_json_body_is_refused() {
        let body = InvokeBody::Json(serde_json::json!({ "root": "/r", "path": "exports/a.pdf", "bytes": [7, 8] }));
        let err = parse_write_bytes(&body, &HeaderMap::new()).unwrap_err();
        assert!(matches!(&err, ProjectError::Io { message } if message.contains("binary")), "{err:?}");
        assert!(parse_asset_bytes(&body, &HeaderMap::new()).is_err());
    }

    #[test]
    fn asset_bytes_take_root_and_name_from_headers() {
        let mut h = HeaderMap::new();
        h.insert("root", HeaderValue::from_static("%2Fr"));
        h.insert("name", HeaderValue::from_static("my%20pic.png"));
        let (r, n, b) = parse_asset_bytes(&InvokeBody::Raw(vec![9]), &h).unwrap();
        assert_eq!((r.as_str(), n.as_str(), b), ("/r", "my pic.png", vec![9]));
        assert!(parse_asset_bytes(&InvokeBody::Raw(vec![]), &headers("%2Fr", "x")).is_err(), "no name header");
    }
}
