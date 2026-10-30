//! The Tauri command layer for the PDF export (blocking work runs off the UI thread).
use super::engine::{compile, find_typst, list_fonts, query, version, COMPILE_TIMEOUT};
use super::error::{other, TypstError};
use super::request::{parse_compile_request, parse_query_request};
use crate::platform::blocking;
use serde::Serialize;
use std::path::PathBuf;
use tauri::ipc::{InvokeBody, Request, Response};

#[derive(Serialize, Debug, PartialEq)]
pub struct TypstInfo {
    pub path: String,
    pub version: String,
}

/// Locates the program (a box, so tests can point at a fake one without a second copy of each body).
type Finder = Box<dyn FnOnce() -> Result<PathBuf, TypstError> + Send + 'static>;

/// Locates typst and reports its version; `NotFound` carries install advice. The webview cannot pick the program.
#[tauri::command]
pub async fn typst_find() -> Result<TypstInfo, TypstError> {
    find_info(Box::new(find_typst)).await
}

async fn find_info(find: Finder) -> Result<TypstInfo, TypstError> {
    blocking(move || {
        let bin = find()?;
        let version = version(&bin)?;
        Ok(TypstInfo { path: bin.to_string_lossy().into_owned(), version })
    })
    .await
}

#[tauri::command]
pub async fn typst_list_fonts() -> Result<Vec<String>, TypstError> {
    fonts_of(Box::new(find_typst)).await
}

async fn fonts_of(find: Finder) -> Result<Vec<String>, TypstError> {
    blocking(move || list_fonts(&find()?)).await
}

/// The request is one binary body (see `parse_compile_request`): options, source and (relative name, bytes) image files
/// written next to the source. Returns the PDF as raw bytes.
async fn compile_body(body: &InvokeBody, find: Finder) -> Result<Response, TypstError> {
    let InvokeBody::Raw(body) = body else {
        return Err(other("typst_compile expects a binary body"));
    };
    let req = parse_compile_request(body)?;
    blocking(move || {
        let bin = find()?;
        compile(&bin, &std::env::temp_dir(), &req.source, &req.files, req.pdf_a, req.pdf_ua, COMPILE_TIMEOUT)
    })
    .await
    .map(Response::new)
}

#[tauri::command]
pub async fn typst_compile(request: Request<'_>) -> Result<Response, TypstError> {
    compile_body(request.body(), Box::new(find_typst)).await
}

/// The request is the compile frame with a `selector` instead of `pdfA` (see `parse_query_request`). Returns the JSON
/// text `typst query` printed, as raw bytes.
async fn query_body(body: &InvokeBody, find: Finder) -> Result<Response, TypstError> {
    let InvokeBody::Raw(body) = body else {
        return Err(other("typst_query expects a binary body"));
    };
    let req = parse_query_request(body)?;
    blocking(move || {
        let bin = find()?;
        query(&bin, &std::env::temp_dir(), &req.source, &req.files, &req.selector, COMPILE_TIMEOUT)
    })
    .await
    .map(Response::new)
}

#[tauri::command]
pub async fn typst_query(request: Request<'_>) -> Result<Response, TypstError> {
    query_body(request.body(), Box::new(find_typst)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    use crate::commands::testutil::raw as pdf;
    use crate::commands::testutil::run;

    #[cfg(unix)]
    fn script(dir: &std::path::Path, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let p = dir.join("fake-typst");
        std::fs::write(&p, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
        p
    }

    #[cfg(unix)]
    fn found(p: &std::path::Path) -> Finder {
        let p = p.to_path_buf();
        Box::new(move || Ok(p))
    }

    fn missing() -> Finder {
        Box::new(|| Err(TypstError::NotFound { message: "gone".into() }))
    }

    /// The framed body `parse_compile_request` reads: header length, JSON header, then the file bytes. The header also
    /// names a program (`typstPath`), which must have no effect.
    fn frame(source: &str, pdf_a: bool, files: &[(&str, &[u8])]) -> Vec<u8> {
        let header =
            serde_json::json!({ "typstPath": "/bin/false", "source": source, "pdfA": pdf_a, "files": files.iter().map(|(n, b)| serde_json::json!({ "name": n, "len": b.len() })).collect::<Vec<_>>() })
                .to_string();
        let mut out = (header.len() as u32).to_le_bytes().to_vec();
        out.extend(header.as_bytes());
        files.iter().for_each(|(_, b)| out.extend(*b));
        out
    }

    fn query_frame(source: &str, selector: &str) -> Vec<u8> {
        let header = serde_json::json!({ "typstPath": "/bin/false", "source": source, "selector": selector, "files": [] }).to_string();
        let mut out = (header.len() as u32).to_le_bytes().to_vec();
        out.extend(header.as_bytes());
        out
    }

    #[cfg(unix)]
    #[test]
    fn find_reports_the_path_and_version_and_list_fonts_one_family_per_line() {
        let d = tempfile::tempdir().unwrap();
        let fake = script(d.path(), "case \"$1\" in --version) echo 'typst 9.9.9';; fonts) printf 'Alpha\\n\\nBeta \\n';; esac");
        assert_eq!(run(find_info(found(&fake))).unwrap(), TypstInfo { path: fake.to_string_lossy().into_owned(), version: "typst 9.9.9".into() });
        assert_eq!(run(fonts_of(found(&fake))).unwrap(), vec!["Alpha".to_string(), "Beta".to_string()]);
    }

    #[test]
    fn find_and_list_fonts_report_a_missing_program() {
        assert!(matches!(run(find_info(missing())), Err(TypstError::NotFound { .. })));
        assert!(matches!(run(fonts_of(missing())), Err(TypstError::NotFound { .. })));
    }

    #[cfg(unix)]
    #[test]
    fn compile_body_runs_the_found_program_not_the_one_in_the_request() {
        let d = tempfile::tempdir().unwrap();
        let fake = script(d.path(), "cp main.typ out.pdf");
        let body = frame("%PDF-source", false, &[("assets/a.png", &[1, 2])]);
        assert_eq!(pdf(run(compile_body(&InvokeBody::Raw(body), found(&fake))).unwrap()), b"%PDF-source");
        let failing = script(d.path(), "echo 'error: boom' >&2; exit 1");
        let err = run(compile_body(&InvokeBody::Raw(frame("x", true, &[])), found(&failing))).err();
        assert!(matches!(err, Some(TypstError::Compile { message }) if message.contains("boom")));
    }

    #[cfg(unix)]
    #[test]
    fn query_body_runs_the_found_program_and_returns_its_output_or_its_error() {
        let d = tempfile::tempdir().unwrap();
        let fake = script(d.path(), "cp main.typ /dev/stdout");
        assert_eq!(pdf(run(query_body(&InvokeBody::Raw(query_frame("{\"total\":0}", "<r>")), found(&fake))).unwrap()), b"{\"total\":0}");
        let failing = script(d.path(), "echo 'error: boom' >&2; exit 1");
        let err = run(query_body(&InvokeBody::Raw(query_frame("x", "<r>")), found(&failing))).err();
        assert!(matches!(err, Some(TypstError::Compile { message }) if message.contains("boom")));
    }

    #[test]
    fn query_body_refuses_a_json_body_a_malformed_frame_and_a_missing_program() {
        assert_eq!(run(query_body(&InvokeBody::Json(serde_json::json!({})), missing())).err(), Some(other("typst_query expects a binary body")));
        assert!(matches!(run(query_body(&InvokeBody::Raw(vec![1, 2]), missing())).err(), Some(TypstError::Other { .. })));
        assert!(matches!(run(query_body(&InvokeBody::Raw(query_frame("x", "<r>")), missing())).err(), Some(TypstError::NotFound { .. })));
    }

    #[test]
    fn compile_body_refuses_a_json_body_a_malformed_frame_and_a_missing_program() {
        assert_eq!(run(compile_body(&InvokeBody::Json(serde_json::json!({})), missing())).err(), Some(other("typst_compile expects a binary body")));
        assert!(matches!(run(compile_body(&InvokeBody::Raw(vec![1, 2]), missing())).err(), Some(TypstError::Other { .. })));
        assert!(matches!(run(compile_body(&InvokeBody::Raw(frame("x", false, &[])), missing())).err(), Some(TypstError::NotFound { .. })));
    }
}
