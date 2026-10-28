//! The Tauri command layer for the PDF export (blocking work runs off the UI thread).
use super::engine::{compile, find_typst, list_fonts, version, COMPILE_TIMEOUT};
use super::error::{other, TypstError};
use super::request::parse_compile_request;
use crate::platform::blocking;
use serde::Serialize;
use tauri::ipc::{InvokeBody, Request, Response};

#[derive(Serialize, Debug, PartialEq)]
pub struct TypstInfo {
    pub path: String,
    pub version: String,
}

/// Locates typst and reports its version; `NotFound` carries install advice.
#[tauri::command]
pub async fn typst_find(typst_path: Option<String>) -> Result<TypstInfo, TypstError> {
    blocking(move || {
        let bin = find_typst(typst_path.as_deref())?;
        let version = version(&bin)?;
        Ok(TypstInfo { path: bin.to_string_lossy().into_owned(), version })
    })
    .await
}

#[tauri::command]
pub async fn typst_list_fonts(typst_path: Option<String>) -> Result<Vec<String>, TypstError> {
    blocking(move || list_fonts(&find_typst(typst_path.as_deref())?)).await
}

/// The request is one binary body (see `parse_compile_request`): options, source and (relative name, bytes) image files
/// written next to the source. Returns the PDF as raw bytes.
async fn compile_body(body: &InvokeBody) -> Result<Response, TypstError> {
    let InvokeBody::Raw(body) = body else {
        return Err(other("typst_compile expects a binary body"));
    };
    let req = parse_compile_request(body)?;
    blocking(move || {
        let bin = find_typst(req.typst_path.as_deref())?;
        compile(&bin, &std::env::temp_dir(), &req.source, &req.files, req.pdf_a, COMPILE_TIMEOUT)
    })
    .await
    .map(Response::new)
}

#[tauri::command]
pub async fn typst_compile(request: Request<'_>) -> Result<Response, TypstError> {
    compile_body(request.body()).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::testutil::{raw as pdf, run};

    #[cfg(unix)]
    fn script(dir: &std::path::Path, body: &str) -> String {
        use std::os::unix::fs::PermissionsExt;
        let p = dir.join("fake-typst");
        std::fs::write(&p, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
        p.to_string_lossy().into_owned()
    }

    /// The framed body `parse_compile_request` reads: header length, JSON header, then the file bytes.
    fn frame(typst_path: Option<&str>, source: &str, pdf_a: bool, files: &[(&str, &[u8])]) -> Vec<u8> {
        let header =
            serde_json::json!({ "typstPath": typst_path, "source": source, "pdfA": pdf_a, "files": files.iter().map(|(n, b)| serde_json::json!({ "name": n, "len": b.len() })).collect::<Vec<_>>() })
                .to_string();
        let mut out = (header.len() as u32).to_le_bytes().to_vec();
        out.extend(header.as_bytes());
        files.iter().for_each(|(_, b)| out.extend(*b));
        out
    }

    #[cfg(unix)]
    #[test]
    fn find_reports_the_path_and_version_and_list_fonts_one_family_per_line() {
        let d = tempfile::tempdir().unwrap();
        let fake = script(d.path(), "case \"$1\" in --version) echo 'typst 9.9.9';; fonts) printf 'Alpha\\n\\nBeta \\n';; esac");
        assert_eq!(run(typst_find(Some(fake.clone()))).unwrap(), TypstInfo { path: fake.clone(), version: "typst 9.9.9".into() });
        assert_eq!(run(typst_list_fonts(Some(fake))).unwrap(), vec!["Alpha".to_string(), "Beta".to_string()]);
    }

    #[test]
    fn find_and_list_fonts_report_a_missing_program() {
        assert!(matches!(run(typst_find(Some("/no/such/typst".into()))), Err(TypstError::NotFound { .. })));
        assert!(matches!(run(typst_list_fonts(Some("/no/such/typst".into()))), Err(TypstError::NotFound { .. })));
    }

    #[cfg(unix)]
    #[test]
    fn compile_body_runs_the_program_named_in_the_request_and_returns_the_pdf_bytes() {
        let d = tempfile::tempdir().unwrap();
        let fake = script(d.path(), "cp main.typ out.pdf");
        let body = frame(Some(&fake), "%PDF-source", false, &[("assets/a.png", &[1, 2])]);
        assert_eq!(pdf(run(compile_body(&InvokeBody::Raw(body))).unwrap()), b"%PDF-source");
        let failing = script(d.path(), "echo 'error: boom' >&2; exit 1");
        let err = run(compile_body(&InvokeBody::Raw(frame(Some(&failing), "x", true, &[])))).err();
        assert!(matches!(err, Some(TypstError::Compile { message }) if message.contains("boom")));
    }

    #[test]
    fn compile_body_refuses_a_json_body_and_a_malformed_frame() {
        assert_eq!(run(compile_body(&InvokeBody::Json(serde_json::json!({})))).err(), Some(other("typst_compile expects a binary body")));
        assert!(matches!(run(compile_body(&InvokeBody::Raw(vec![1, 2]))).err(), Some(TypstError::Other { .. })));
        let missing = frame(Some("/no/such/typst"), "x", false, &[]);
        assert!(matches!(run(compile_body(&InvokeBody::Raw(missing))).err(), Some(TypstError::NotFound { .. })));
    }
}
