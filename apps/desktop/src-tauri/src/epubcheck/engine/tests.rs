use super::*;
use std::sync::atomic::Ordering;

fn touch(p: &Path) {
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, "x").unwrap();
}

#[cfg(unix)]
fn make_executable(p: &Path) {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(p, fs::Permissions::from_mode(0o755)).unwrap();
}

#[cfg(unix)]
fn script(p: &Path, body: &str) {
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, format!("#!/bin/sh\n{body}\n")).unwrap();
    make_executable(p);
}

#[test]
fn a_release_build_uses_only_the_bundled_copy() {
    let dir = tempfile::tempdir().unwrap();
    let env = dir.path().join("env");
    touch(&env.join("epubcheck.jar"));
    let err = find_runtime_in(Some(dir.path()), Some(env.to_str().unwrap()), Some("/bin/sh"), None, None, "x86_64", false).err().unwrap();
    assert!(matches!(err, EpubcheckError::NotFound { .. }));
}

#[cfg(unix)]
#[test]
fn the_bundled_runtime_is_found_by_cpu() {
    let dir = tempfile::tempdir().unwrap();
    touch(&dir.path().join("epubcheck/epubcheck.jar"));
    script(&dir.path().join("jre/aarch64/bin/java"), "exit 0");
    script(&dir.path().join("jre/x86_64/bin/java"), "exit 0");
    let rt = find_runtime_in(Some(dir.path()), None, None, None, None, "x86_64", false).unwrap();
    assert_eq!(rt.java, dir.path().join("jre/x86_64/bin/java"));
    assert_eq!(rt.jar, dir.path().join("epubcheck/epubcheck.jar"));
    assert!(rt.bundled);
    assert!(find_runtime_in(Some(dir.path()), None, None, None, None, "riscv64", false).is_err());
}

#[cfg(unix)]
#[test]
fn a_debug_build_honours_the_environment_then_path() {
    let dir = tempfile::tempdir().unwrap();
    touch(&dir.path().join("jar/epubcheck.jar"));
    script(&dir.path().join("bin/java"), "exit 0");
    let jar = dir.path().join("jar");
    let path = std::env::join_paths([dir.path().join("bin")]).unwrap();
    let rt = find_runtime_in(None, Some(jar.to_str().unwrap()), None, None, Some(path.as_os_str()), "x86_64", true).unwrap();
    assert_eq!(rt.java, dir.path().join("bin/java"));
    let bad = find_runtime_in(None, Some(jar.to_str().unwrap()), Some("/nope/java"), None, Some(path.as_os_str()), "x86_64", true).err().unwrap();
    assert!(matches!(bad, EpubcheckError::NotFound { ref message } if message.contains("JAVA_BIN")));
    let none = find_runtime_in(None, None, None, None, None, "x86_64", true).err().unwrap();
    assert!(matches!(none, EpubcheckError::NotFound { .. }));
}

/// A fake `java` that writes `report` where `--json` points, then exits with `code`.
#[cfg(unix)]
fn fake_java(dir: &Path, report: &str, code: i32) -> Runtime {
    let java = dir.join("java");
    let body =
        format!("while [ $# -gt 0 ]; do if [ \"$1\" = \"--json\" ]; then out=\"$2\"; fi; shift; done\ncat > \"$out\" <<'EOF'\n{report}\nEOF\nexit {code}");
    script(&java, &body);
    Runtime { java, jar: dir.join("epubcheck.jar"), bundled: false }
}

#[cfg(unix)]
#[test]
fn a_report_that_is_not_json_is_a_failure() {
    let dir = tempfile::tempdir().unwrap();
    let rt = fake_java(dir.path(), "this is not a report", 0);
    let e = validate(&rt, &dir.path().join("book.epub"), Duration::from_secs(20), &AtomicBool::new(false)).unwrap_err();
    assert!(matches!(e, EpubcheckError::Failed { .. }), "{e:?}");
}

#[cfg(unix)]
#[test]
fn a_failing_exit_status_still_returns_the_report() {
    let dir = tempfile::tempdir().unwrap();
    let rt = fake_java(
        dir.path(),
        r#"{"messages":[{"ID":"RSC-005","severity":"ERROR","message":"bad","locations":[]}],"checker":{"checkerVersion":"5.4.0","nError":1}}"#,
        1,
    );
    let r = validate(&rt, &dir.path().join("book.epub"), Duration::from_secs(20), &AtomicBool::new(false)).unwrap();
    assert_eq!((r.counts.error, r.messages.len(), r.version.as_str()), (1, 1, "5.4.0"));
}

#[cfg(unix)]
#[test]
fn a_run_without_a_report_is_a_failure_with_its_output() {
    let dir = tempfile::tempdir().unwrap();
    let java = dir.path().join("java");
    script(&java, "echo 'Unsupported class file' >&2\nexit 1");
    let rt = Runtime { java, jar: dir.path().join("epubcheck.jar"), bundled: false };
    let err = validate(&rt, &dir.path().join("book.epub"), Duration::from_secs(20), &AtomicBool::new(false)).err().unwrap();
    assert!(matches!(err, EpubcheckError::Failed { ref message } if message.contains("Unsupported class file")));
}

#[cfg(unix)]
#[test]
fn a_slow_check_times_out_and_a_cancel_stops_it() {
    let dir = tempfile::tempdir().unwrap();
    let java = dir.path().join("java");
    script(&java, "sleep 30");
    let rt = Runtime { java, jar: dir.path().join("epubcheck.jar"), bundled: false };
    let epub = dir.path().join("book.epub");
    let err = validate(&rt, &epub, Duration::from_millis(200), &AtomicBool::new(false)).err().unwrap();
    assert!(matches!(err, EpubcheckError::Timeout { .. }));
    let cancel = AtomicBool::new(true);
    cancel.store(true, Ordering::Relaxed);
    assert_eq!(validate(&rt, &epub, Duration::from_secs(20), &cancel).err().unwrap(), EpubcheckError::Cancelled);
}

#[test]
fn the_tail_keeps_the_last_lines() {
    let text = (1..=10).map(|n| format!("line {n}")).collect::<Vec<_>>().join("\n\n");
    let t = tail(&text);
    assert!(t.starts_with("line 5") && t.ends_with("line 10"));
}

#[test]
fn the_resource_folder_is_set_once_and_the_first_value_stays() {
    set_resource_dir(PathBuf::from("first"));
    set_resource_dir(PathBuf::from("second"));
    assert!(RESOURCE_DIR.get().is_some());
}

#[test]
fn windows_looks_for_java_exe_first() {
    assert_eq!(java_names(true), ["java.exe", "java"]);
    assert_eq!(java_names(false), ["java"]);
}

#[cfg(unix)]
#[test]
fn a_debug_build_runs_the_java_named_by_java_bin() {
    let dir = tempfile::tempdir().unwrap();
    touch(&dir.path().join("epubcheck/epubcheck.jar"));
    script(&dir.path().join("my-java"), "exit 0");
    let java = dir.path().join("my-java");
    let rt = find_runtime_in(Some(dir.path()), None, java.to_str(), None, None, "x86_64", true).unwrap();
    assert_eq!(rt.java, java);
    assert!(!rt.bundled);
}

#[cfg(unix)]
#[test]
fn a_debug_build_falls_back_to_the_checkout_runtime() {
    let dir = tempfile::tempdir().unwrap();
    touch(&dir.path().join("epubcheck/epubcheck.jar"));
    script(&dir.path().join("jre/x86_64/bin/java"), "exit 0");
    let rt = find_runtime_in(None, None, None, Some(dir.path()), None, "x86_64", true).unwrap();
    assert_eq!(rt.java, dir.path().join("jre/x86_64/bin/java"));
    assert!(!rt.bundled);
}
