//! Command arms the other IPC tests do not reach: the EPUBCheck and Typst commands, and a refused raw upload. Their
//! bodies are tested next to their definitions.
use super::*;

#[test]
fn epubcheck_cancel_and_validate_answer_through_the_ipc() {
    let (app, w) = mock_app();
    app.manage(crate::epubcheck::EpubcheckJob::default());
    assert!(call(&w, "epubcheck_cancel", json!({})).is_ok());
    let book = project();
    // No EPUB at that path: the check stops before any program is looked for.
    assert_eq!(kind_of(call(&w, "epubcheck_validate", json!({ "root": root(&book), "path": "exports/en/book.epub" }))), "no_epub");
    assert!(call(&w, "epubcheck_validate", json!({ "root": "", "path": "exports/en/book.epub" })).is_err());
}

#[test]
fn the_typst_commands_want_a_binary_body() {
    let (_app, w) = mock_app();
    for cmd in ["typst_compile", "typst_query"] {
        let err = call(&w, cmd, json!({})).expect_err("a JSON body is refused");
        assert_eq!(err["kind"], "other", "{cmd}");
        assert!(err["message"].as_str().unwrap().contains("binary body"), "{cmd}: {err}");
    }
}

#[test]
fn a_raw_image_upload_without_its_headers_is_refused() {
    let (_app, w) = mock_app();
    assert!(get_ipc_response(&w, request("import_asset_bytes", InvokeBody::Raw(PNG.to_vec()), &[])).is_err());
}
