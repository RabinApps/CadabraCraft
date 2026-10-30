//! Finding the typst program and running it: version, fonts and compile.
use super::error::{other, TypstError};
use crate::platform::sidecar::{self, bundled_dir, find_executable, is_executable, search_dirs, Captured, Run};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

pub const COMPILE_TIMEOUT: Duration = Duration::from_secs(120);
const FONTS_TIMEOUT: Duration = Duration::from_secs(30);
const INSTALL_ADVICE: &str = "The Typst program that ships with CadabraCraft is missing; reinstall the app.";

/// Folder of bundled fonts (Inter), passed to Typst as `--font-path`. Set once at startup from the resource dir.
static FONT_DIR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

pub fn set_font_dir(dir: PathBuf) {
    if dir.is_dir() {
        let _ = FONT_DIR.set(dir);
    }
}

/// `--font-path <dir>` for each folder; Typst accepts it only after the subcommand (`typst fonts --font-path d`).
fn font_args(dirs: &[PathBuf]) -> Vec<String> {
    dirs.iter().flat_map(|d| ["--font-path".to_string(), d.to_string_lossy().into_owned()]).collect()
}

/// The bundled fonts, then the author's downloaded and imported ones (`fonts/` in the app data folder) when that folder
/// exists. Looked up on every call: the folder appears with the first download.
fn font_dirs() -> Vec<PathBuf> {
    ordered_dirs(FONT_DIR.get().cloned(), crate::fonts::typst_font_dir())
}

fn ordered_dirs(bundled: Option<PathBuf>, user: Option<PathBuf>) -> Vec<PathBuf> {
    bundled.into_iter().chain(user).collect()
}

/// Finds `typst`. The webview cannot choose the program: release builds run only the sidecar bundled next to the app
/// executable. Debug builds (dev runs and tests) also honour the `TYPST_BIN` environment variable of the process, then
/// PATH and `/opt/homebrew/bin` and `/usr/local/bin`, so a checkout that skipped `scripts/fetch-typst.sh` still works.
pub fn find_typst() -> Result<PathBuf, TypstError> {
    let dev = cfg!(debug_assertions);
    let env_bin = if dev { std::env::var("TYPST_BIN").ok() } else { None };
    find_typst_in(env_bin.as_deref(), bundled_dir().as_deref(), std::env::var_os("PATH").as_deref(), &["/opt/homebrew/bin", "/usr/local/bin"], dev)
}

/// File names to look for: Windows has `typst.exe`.
fn binary_names(windows: bool) -> &'static [&'static str] {
    if windows {
        &["typst.exe", "typst"]
    } else {
        &["typst"]
    }
}

/// `dev` false: only `bundled`; `env_bin`, `path_var` and `fallback_dirs` are ignored. `dev` true: `env_bin` (an error
/// when it is not runnable), then `bundled`, PATH and the fallback folders.
pub fn find_typst_in(env_bin: Option<&str>, bundled: Option<&Path>, path_var: Option<&std::ffi::OsStr>, fallback_dirs: &[&str], dev: bool) -> Result<PathBuf, TypstError> {
    if let Some(g) = env_bin.map(str::trim).filter(|g| dev && !g.is_empty()) {
        let p = PathBuf::from(g);
        return if is_executable(&p) { Ok(p) } else { Err(TypstError::NotFound { message: format!("No runnable typst program at {g} (from TYPST_BIN). {INSTALL_ADVICE}") }) };
    }
    let dirs = if dev { search_dirs(bundled, path_var, fallback_dirs) } else { search_dirs(bundled, None, &[]) };
    find_executable(binary_names(cfg!(windows)), &dirs).ok_or_else(|| TypstError::NotFound { message: format!("The bundled \"typst\" program was not found next to the app. {INSTALL_ADVICE}") })
}

/// Typst's package folders, both pointed at empty folders inside the compile directory, so no package installed on the
/// machine (and none cached from an earlier run) can be imported. The folders are removed with the compile directory.
fn package_args(dir: &Path) -> Result<Vec<String>, TypstError> {
    let mut args = Vec::new();
    for (flag, name) in [("--package-path", "no-local-packages"), ("--package-cache-path", "no-package-cache")] {
        let p = dir.join(name);
        fs::create_dir(&p).map_err(other)?;
        args.extend([flag.to_string(), p.to_string_lossy().into_owned()]);
    }
    Ok(args)
}

/// `s` without leading whitespace, opening parentheses and comments (`/* .. */`, `// ..`), which Typst ignores between
/// `import` and its path.
fn skip_noise(mut s: &str) -> &str {
    loop {
        let t = s.trim_start_matches(|c: char| c.is_whitespace() || c == '(');
        s = if let Some(rest) = t.strip_prefix("/*") {
            rest.split_once("*/").map_or("", |(_, after)| after)
        } else if let Some(rest) = t.strip_prefix("//") {
            rest.split_once('\n').map_or("", |(_, after)| after)
        } else {
            return t;
        };
    }
}

/// Refuses a source that imports or includes a package (`#import "@preview/name:1.0.0"`). Typst downloads a package
/// it does not have over the network and its CLI has no offline switch, so the way to keep v1 network-free is to never
/// let such an import reach it. Our templates import none. Best effort: Typst can also build the path from an
/// expression, which this does not catch; the empty package folders only stop installed or cached packages.
fn refuse_packages(source: &str) -> Result<(), TypstError> {
    for kw in ["import", "include"] {
        for (i, _) in source.match_indices(kw) {
            if skip_noise(&source[i + kw.len()..]).starts_with("\"@") {
                return Err(TypstError::Compile { message: "Packages are not available in the PDF export (it never uses the network): remove the \"@...\" import.".into() });
            }
        }
    }
    Ok(())
}

/// Runs `bin args` in `cwd` with output captured through files (no pipe deadlocks) and a hard timeout (the process is killed).
fn run_capture(bin: &Path, args: &[String], cwd: &Path, timeout: Duration) -> Result<Captured, TypstError> {
    Ok(sidecar::run(&Run { bin, args, cwd: Some(cwd), timeout, cancel: None, shared_libs: false, install_advice: INSTALL_ADVICE })?)
}

pub fn version(bin: &Path) -> Result<String, TypstError> {
    let r = run_capture(bin, &["--version".into()], Path::new("."), FONTS_TIMEOUT)?;
    if !r.success {
        return Err(other(format!("{} --version failed: {}", bin.display(), r.stderr.trim())));
    }
    Ok(String::from_utf8_lossy(&r.stdout).trim().to_string())
}

/// Font family names from `typst fonts` (system and bundled).
pub fn list_fonts(bin: &Path) -> Result<Vec<String>, TypstError> {
    list_fonts_with(bin, &font_dirs())
}

fn list_fonts_with(bin: &Path, font_dirs: &[PathBuf]) -> Result<Vec<String>, TypstError> {
    let mut args = vec!["fonts".to_string()];
    args.extend(font_args(font_dirs));
    let r = run_capture(bin, &args, Path::new("."), FONTS_TIMEOUT)?;
    if !r.success {
        return Err(other(format!("typst fonts failed: {}", r.stderr.trim())));
    }
    Ok(String::from_utf8_lossy(&r.stdout).lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect())
}

/// A relative path that stays inside the compile directory and does not collide with the files we write ourselves.
pub fn safe_rel(name: &str) -> Result<PathBuf, TypstError> {
    let p = Path::new(name);
    let ok = !name.is_empty()
        && !name.contains('\\')
        && !name.contains('\0')
        && !name.ends_with('/')
        && p.components().all(|c| matches!(c, Component::Normal(_)))
        && !name.split('/').any(str::is_empty)
        && name != "main.typ"
        && name != "out.pdf";
    if ok {
        Ok(p.to_path_buf())
    } else {
        Err(other(format!("unsafe file name for the PDF export: {name:?}")))
    }
}

/// Writes `source` (as `main.typ`) and `files` into a fresh temp directory under `tmp_base`; the directory is removed
/// when the returned guard drops, so every path out (success, error, timeout) cleans up.
fn stage(tmp_base: &Path, source: &str, files: &[(String, Vec<u8>)]) -> Result<tempfile::TempDir, TypstError> {
    refuse_packages(source)?;
    let rels = files.iter().map(|(n, _)| safe_rel(n)).collect::<Result<Vec<_>, _>>()?; // validate before touching disk
    let dir = tempfile::Builder::new().prefix("cadabracraft-pdf-").tempdir_in(tmp_base).map_err(other)?;
    for (rel, (_, bytes)) in rels.iter().zip(files) {
        let target = dir.path().join(rel);
        fs::create_dir_all(target.parent().unwrap_or(dir.path())).map_err(other)?; // a file inside `dir` always has a parent
        File::create(&target).and_then(|mut f| f.write_all(bytes)).map_err(other)?;
    }
    fs::write(dir.path().join("main.typ"), source).map_err(other)?;
    Ok(dir)
}

/// A failed typst run as `TypstError::Compile`, carrying typst's own message.
fn compile_failure(stderr: &str) -> TypstError {
    let msg = stderr.trim();
    TypstError::Compile { message: if msg.is_empty() { "typst exited with an error and no message".into() } else { msg.to_string() } }
}

/// Runs `typst query` on `source` (with `files` next to it) and returns its stdout: the JSON value of the single
/// element `selector` matches (`--field value --one`). Same temp directory, timeout and font handling as `compile`; no PDF is made.
pub fn query(bin: &Path, tmp_base: &Path, source: &str, files: &[(String, Vec<u8>)], selector: &str, timeout: Duration) -> Result<Vec<u8>, TypstError> {
    if selector.starts_with('-') || selector.trim().is_empty() {
        return Err(other(format!("unsafe selector for the PDF export: {selector:?}")));
    }
    let dir = stage(tmp_base, source, files)?;
    let mut args: Vec<String> = vec!["query".into(), "--root".into(), ".".into(), "--diagnostic-format".into(), "short".into()];
    args.extend(font_args(&font_dirs()));
    args.extend(package_args(dir.path())?);
    // Options first, then `--`: nothing after it (the selector included) can be parsed as a flag.
    args.extend(["--field".into(), "value".into(), "--one".into(), "--".into(), "main.typ".into(), selector.into()]);
    let r = run_capture(bin, &args, dir.path(), timeout)?;
    if !r.success {
        return Err(compile_failure(&r.stderr));
    }
    Ok(r.stdout)
}

/// Writes `source` and `files` into a fresh temp directory under `tmp_base`, runs `typst compile`, returns the PDF.
/// The directory is removed on every path out (success, error, timeout).
pub fn compile(bin: &Path, tmp_base: &Path, source: &str, files: &[(String, Vec<u8>)], pdf_a: bool, timeout: Duration) -> Result<Vec<u8>, TypstError> {
    let dir = stage(tmp_base, source, files)?;
    let mut args: Vec<String> = vec!["compile".into(), "--root".into(), ".".into(), "--diagnostic-format".into(), "short".into()];
    args.extend(font_args(&font_dirs()));
    args.extend(package_args(dir.path())?);
    if pdf_a {
        args.extend(["--pdf-standard".into(), "a-2b".into()]);
    }
    args.extend(["main.typ".into(), "out.pdf".into()]);
    let r = run_capture(bin, &args, dir.path(), timeout)?;
    if !r.success {
        return Err(compile_failure(&r.stderr));
    }
    if let Some(line) = r.stderr.lines().map(str::trim).find(|l| l.to_lowercase().contains("warning: unknown font family")) {
        let family = line.rsplit_once(':').map(|(_, f)| f.trim()).unwrap_or("unknown").to_string();
        return Err(TypstError::Font { family });
    }
    fs::read(dir.path().join("out.pdf")).map_err(other)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    /// The real typst, or None (test skipped) unless `REQUIRE_TYPST=1`, in which case a missing typst fails the test.
    fn real_typst() -> Option<PathBuf> {
        real_typst_from(find_typst(), std::env::var("REQUIRE_TYPST").as_deref() == Ok("1"))
    }

    fn real_typst_from(found: Result<PathBuf, TypstError>, required: bool) -> Option<PathBuf> {
        match found {
            Ok(p) => Some(p),
            Err(e) => {
                assert!(!required, "REQUIRE_TYPST=1 but typst was not found: {e:?}");
                eprintln!("skipping: typst not installed");
                None
            }
        }
    }

    #[test]
    fn a_missing_typst_skips_the_real_tests_unless_it_is_required() {
        let missing = || Err(TypstError::NotFound { message: "n".into() });
        assert_eq!(real_typst_from(missing(), false), None);
        assert_eq!(real_typst_from(Ok(PathBuf::from("/x/typst")), true), Some(PathBuf::from("/x/typst")));
        assert!(std::panic::catch_unwind(|| real_typst_from(Err(TypstError::NotFound { message: "n".into() }), true)).is_err());
    }
    const HELLO: &str = "#set page(width: 5in, height: 8in)\nHello from the Rust test\n";
    fn leftovers(d: &Path) -> usize {
        fs::read_dir(d).unwrap().count()
    }

    #[test]
    fn safe_rel_rejects_escapes_and_collisions() {
        for bad in ["", "..", "../x", "a/../b", "/abs", "a//b", "a/", "./a", "a\\b", "main.typ", "out.pdf", "a\0b"] {
            assert!(safe_rel(bad).is_err(), "{bad:?} should be rejected");
        }
        for ok in ["assets/img-1.png", "x.png", "a/b/c.jpg"] {
            assert!(safe_rel(ok).is_ok(), "{ok:?} should be accepted");
        }
    }

    #[test]
    fn find_honors_explicit_env_path_and_fallbacks() {
        let d = tempfile::tempdir().unwrap();
        let fake = d.path().join("typst");
        fs::write(&fake, "#!/bin/sh\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&fake, fs::Permissions::from_mode(0o755)).unwrap();
        }
        let dir = d.path().to_str().unwrap();
        let env = Some(fake.to_str().unwrap());
        assert_eq!(find_typst_in(env, None, None, &[], true).unwrap(), fake);
        assert_eq!(find_typst_in(None, Some(d.path()), None, &[], true).unwrap(), fake);
        assert_eq!(find_typst_in(None, None, Some(d.path().as_os_str()), &[], true).unwrap(), fake);
        assert_eq!(find_typst_in(None, None, None, &[dir], true).unwrap(), fake);
        // The bundled sidecar wins over PATH.
        let other_dir = tempfile::tempdir().unwrap();
        assert_eq!(find_typst_in(None, Some(d.path()), Some(other_dir.path().as_os_str()), &[], true).unwrap(), fake);
        // A wrong TYPST_BIN is an error, not a silent fallback to the bundled copy or PATH.
        let missing = find_typst_in(Some("/no/such/typst"), Some(d.path()), Some(d.path().as_os_str()), &[], true);
        assert!(matches!(&missing, Err(TypstError::NotFound { message }) if message.contains("/no/such/typst") && message.contains("reinstall")));
        let none = find_typst_in(None, None, Some(std::ffi::OsStr::new("")), &["/no/such/dir"], true);
        assert!(matches!(&none, Err(TypstError::NotFound { message }) if message.contains("reinstall")));
    }

    #[test]
    fn a_release_build_runs_only_the_bundled_program() {
        let d = tempfile::tempdir().unwrap();
        let fake = d.path().join("typst");
        fs::write(&fake, "#!/bin/sh\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&fake, fs::Permissions::from_mode(0o755)).unwrap();
        }
        let elsewhere = tempfile::tempdir().unwrap();
        let (env, dir) = (Some(fake.to_str().unwrap()), d.path().to_str().unwrap());
        // The environment, PATH and the Homebrew folders are ignored; the bundled folder is used.
        assert_eq!(
            find_typst_in(env, Some(elsewhere.path()), None, &[], false).unwrap_err(),
            TypstError::NotFound { message: format!("The bundled \"typst\" program was not found next to the app. {INSTALL_ADVICE}") }
        );
        assert!(find_typst_in(None, None, Some(d.path().as_os_str()), &[dir], false).is_err());
        assert_eq!(find_typst_in(env, Some(d.path()), None, &[], false).unwrap(), fake);
    }

    #[test]
    fn every_compile_gets_empty_package_folders_inside_its_own_directory() {
        let d = tempfile::tempdir().unwrap();
        let args = package_args(d.path()).unwrap();
        assert_eq!(args.len(), 4);
        assert_eq!(args[0], "--package-path");
        assert_eq!(args[2], "--package-cache-path");
        for p in [&args[1], &args[3]] {
            let p = Path::new(p);
            assert!(p.starts_with(d.path()) && p.is_dir() && fs::read_dir(p).unwrap().count() == 0);
        }
        assert!(package_args(Path::new("/no/such/dir")).is_err(), "an unwritable directory is an error");
    }

    #[test]
    fn a_package_import_is_refused_before_typst_runs() {
        for bad in [
            "#import \"@preview/cetz:0.3.0\": canvas",
            "#import \"@local/x:1.0.0\"",
            "#include \"@preview/x:1.0.0\"",
            "#import(\"@preview/x:1.0.0\")",
            "= Title\n\n#let a = 1\n#import   \"@preview/x:1.0.0\": *",
            "#import /* hidden */ \"@preview/x:1.0.0\"",
            "#include // hidden\n\"@preview/x:1.0.0\"",
        ] {
            assert!(matches!(refuse_packages(bad), Err(TypstError::Compile { message }) if message.contains("Packages")), "{bad:?}");
        }
        for ok in ["#import \"template.typ\": *", "Please import \"quoted\" text and write to me@preview/x", "#set page(width: 5in)", "important \"@handle\""] {
            assert!(refuse_packages(ok).is_ok(), "{ok:?}");
        }
        // The compile and query entry points both refuse, without leaving a temp directory behind.
        let base = tempfile::tempdir().unwrap();
        let src = "#import \"@preview/x:1.0.0\"";
        let t = Duration::from_secs(5);
        assert!(matches!(compile(Path::new("/no/such/typst"), base.path(), src, &[], false, t), Err(TypstError::Compile { .. })));
        assert!(matches!(query(Path::new("/no/such/typst"), base.path(), src, &[], "<x>", t), Err(TypstError::Compile { .. })));
        assert_eq!(leftovers(base.path()), 0);
    }

    #[cfg(unix)]
    #[test]
    fn compile_and_query_pass_empty_package_folders_to_typst() {
        let d = tempfile::tempdir().unwrap();
        let base = tempfile::tempdir().unwrap();
        let echo_args = fake(d.path(), "echo \"$@\" > out.pdf; echo \"$@\"");
        let pdf = String::from_utf8(compile(&echo_args, base.path(), "x", &[], false, COMPILE_TIMEOUT).unwrap()).unwrap();
        assert!(pdf.contains("--package-path") && pdf.contains("no-local-packages") && pdf.contains("--package-cache-path") && pdf.contains("no-package-cache"), "{pdf}");
        let q = String::from_utf8(query(&echo_args, base.path(), "x", &[], "<r>", COMPILE_TIMEOUT).unwrap()).unwrap();
        assert!(q.contains("--package-path") && q.contains("--package-cache-path"), "{q}");
    }

    /// Regression: `--font-path` must follow the subcommand, so the bundled Inter shows up in `typst fonts`.
    #[test]
    fn bundled_fonts_are_listed_when_a_font_dir_is_given() {
        let Some(bin) = real_typst() else { return };
        let fonts = Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries/fonts");
        check_bundled_fonts(&bin, &fonts, std::env::var("REQUIRE_TYPST").as_deref() == Ok("1"));
    }

    fn check_bundled_fonts(bin: &Path, fonts: &Path, required: bool) {
        if !fonts.is_dir() {
            assert!(!required, "binaries/fonts missing; run scripts/fetch-typst.sh");
            return;
        }
        assert!(list_fonts_with(bin, &[fonts.to_path_buf()]).unwrap().iter().any(|f| f == "Inter"));
    }

    #[test]
    fn a_missing_fonts_folder_skips_the_font_check_unless_it_is_required() {
        let gone = Path::new("/no/such/fonts");
        check_bundled_fonts(Path::new("/no/such/typst"), gone, false);
        assert!(std::panic::catch_unwind(|| check_bundled_fonts(Path::new("/no/such/typst"), Path::new("/no/such/fonts"), true)).is_err());
    }

    #[test]
    fn the_program_name_depends_on_the_platform() {
        assert_eq!(binary_names(true), ["typst.exe", "typst"]);
        assert_eq!(binary_names(false), ["typst"]);
    }

    #[test]
    fn a_font_folder_is_used_only_when_it_exists() {
        let missing = std::env::temp_dir().join("cadabracraft-no-such-fonts");
        set_font_dir(missing.clone());
        assert_ne!(FONT_DIR.get(), Some(&missing));
        // An existing folder is remembered for the rest of the run (an empty one adds no fonts).
        // (The folder is deleted when this test ends; the tests that use the remembered path run fake programs that ignore it.)
        let fonts = tempfile::tempdir().unwrap();
        set_font_dir(fonts.path().to_path_buf());
        assert!(FONT_DIR.get().is_some());
    }

    #[test]
    fn every_font_folder_gets_its_own_font_path_after_the_subcommand() {
        assert!(font_args(&[]).is_empty());
        assert_eq!(font_args(&[PathBuf::from("/a"), PathBuf::from("/b")]), ["--font-path", "/a", "--font-path", "/b"]);
        let (bundled, user) = (PathBuf::from("/bundled"), PathBuf::from("/user"));
        assert_eq!(ordered_dirs(Some(bundled.clone()), Some(user.clone())), [bundled.clone(), user.clone()]);
        assert_eq!(ordered_dirs(Some(bundled.clone()), None), [bundled]);
        assert_eq!(ordered_dirs(None, Some(user.clone())), [user]);
        assert!(ordered_dirs(None, None).is_empty());
    }

    #[cfg(unix)]
    fn fake(dir: &Path, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let p = dir.join("fake-typst");
        fs::write(&p, format!("#!/bin/sh\n{body}\n")).unwrap();
        fs::set_permissions(&p, fs::Permissions::from_mode(0o755)).unwrap();
        p
    }

    #[cfg(unix)]
    #[test]
    fn a_program_that_fails_is_an_error_with_its_message_for_version_fonts_and_compile() {
        let d = tempfile::tempdir().unwrap();
        let loud = fake(d.path(), "echo 'bad things' >&2; exit 2");
        assert!(matches!(version(&loud), Err(TypstError::Other { message }) if message.contains("--version failed") && message.contains("bad things")));
        assert!(matches!(list_fonts(&loud), Err(TypstError::Other { message }) if message.contains("typst fonts failed") && message.contains("bad things")));
        assert!(matches!(compile(&loud, d.path(), "x", &[], false, COMPILE_TIMEOUT), Err(TypstError::Compile { message }) if message == "bad things"));
        let silent = fake(d.path(), "exit 2");
        assert!(matches!(compile(&silent, d.path(), "x", &[], false, COMPILE_TIMEOUT), Err(TypstError::Compile { message }) if message.contains("no message")));
    }

    #[cfg(unix)]
    #[test]
    fn compile_passes_the_pdf_standard_and_reports_a_missing_output() {
        let d = tempfile::tempdir().unwrap();
        let base = tempfile::tempdir().unwrap();
        let echo_args = fake(d.path(), "echo \"$@\" > out.pdf");
        let pdf = compile(&echo_args, base.path(), "x", &[], true, COMPILE_TIMEOUT).unwrap();
        assert!(String::from_utf8_lossy(&pdf).contains("--pdf-standard a-2b main.typ out.pdf"));
        let nothing = fake(d.path(), "true");
        assert!(matches!(compile(&nothing, base.path(), "x", &[], false, COMPILE_TIMEOUT), Err(TypstError::Other { .. })));
        assert_eq!(leftovers(base.path()), 0);
    }

    #[cfg(unix)]
    #[test]
    fn run_capture_kills_on_timeout() {
        let start = Instant::now();
        let r = run_capture(Path::new("/bin/sleep"), &["30".into()], Path::new("."), Duration::from_millis(200));
        assert_eq!(r.err(), Some(TypstError::Timeout { seconds: 0 }));
        assert!(start.elapsed() < Duration::from_secs(10));
    }

    #[test]
    fn compile_rejects_unsafe_names_without_creating_a_directory() {
        let base = tempfile::tempdir().unwrap();
        let err = compile(Path::new("/definitely/not/typst"), base.path(), "x", &[("../evil.png".into(), vec![1])], false, COMPILE_TIMEOUT);
        assert!(matches!(err, Err(TypstError::Other { .. })));
        assert_eq!(leftovers(base.path()), 0);
        assert!(!base.path().parent().unwrap().join("evil.png").exists());
    }

    #[test]
    fn missing_binary_cleans_up_and_reports_not_found() {
        let base = tempfile::tempdir().unwrap();
        let err = compile(Path::new("/definitely/not/typst"), base.path(), "x", &[("assets/a.png".into(), vec![1])], false, COMPILE_TIMEOUT);
        assert!(matches!(err, Err(TypstError::NotFound { .. })), "{err:?}");
        assert_eq!(leftovers(base.path()), 0);
    }

    #[test]
    fn compile_with_real_typst_makes_a_pdf_of_the_right_size_and_cleans_up() {
        let Some(bin) = real_typst() else { return };
        let base = tempfile::tempdir().unwrap();
        let pdf = compile(&bin, base.path(), HELLO, &[], false, COMPILE_TIMEOUT).unwrap();
        assert!(pdf.starts_with(b"%PDF-"));
        let text = String::from_utf8_lossy(&pdf);
        assert!(text.contains("/MediaBox[0 0 360 576]"), "5x8in is 360x576pt");
        assert!(!text.contains("pdfaid:part"));
        assert_eq!(leftovers(base.path()), 0, "temp dir removed");
    }

    #[test]
    fn compile_with_real_typst_pdf_a_and_image() {
        let Some(bin) = real_typst() else { return };
        let png = fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../fixtures/manuscripts/assets/gradient.png")).unwrap();
        let base = tempfile::tempdir().unwrap();
        let src = "#set page(width: 5in, height: 8in)\n#image(\"assets/img-1.png\", width: 2in)\n";
        let pdf = compile(&bin, base.path(), src, &[("assets/img-1.png".into(), png)], true, COMPILE_TIMEOUT).unwrap();
        assert!(String::from_utf8_lossy(&pdf).contains("<pdfaid:part>2</pdfaid:part>"));
        assert_eq!(leftovers(base.path()), 0);
    }

    #[test]
    fn compile_errors_carry_typst_message_and_clean_up() {
        let Some(bin) = real_typst() else { return };
        let base = tempfile::tempdir().unwrap();
        let err = compile(&bin, base.path(), "#nonexistent-function()\n", &[], false, COMPILE_TIMEOUT);
        assert!(matches!(&err, Err(TypstError::Compile { message }) if message.contains("error")), "{err:?}");
        assert_eq!(leftovers(base.path()), 0);
        // The source cannot read outside the compile directory.
        let err = compile(&bin, base.path(), "#read(\"/etc/hosts\")\n", &[], false, COMPILE_TIMEOUT);
        assert!(matches!(err, Err(TypstError::Compile { .. })), "{err:?}");
    }

    #[cfg(unix)]
    #[test]
    fn query_passes_the_selector_flags_and_returns_stdout_and_cleans_up() {
        let d = tempfile::tempdir().unwrap();
        let base = tempfile::tempdir().unwrap();
        let echo_args = fake(d.path(), "echo \"$@\"; cat main.typ");
        let out = query(&echo_args, base.path(), "SRC", &[("assets/a.png".into(), vec![1])], "<page-report>", COMPILE_TIMEOUT).unwrap();
        let text = String::from_utf8_lossy(&out);
        assert!(text.contains("query --root . --diagnostic-format short"), "{text}");
        assert!(text.contains("--field value --one -- main.typ <page-report>"), "{text}");
        assert!(text.contains("SRC"));
        assert_eq!(leftovers(base.path()), 0);
        let loud = fake(d.path(), "echo 'error: no match' >&2; exit 1");
        assert!(matches!(query(&loud, base.path(), "x", &[], "<a>", COMPILE_TIMEOUT), Err(TypstError::Compile { message }) if message.contains("no match")));
        let silent = fake(d.path(), "exit 1");
        assert!(matches!(query(&silent, base.path(), "x", &[], "<a>", COMPILE_TIMEOUT), Err(TypstError::Compile { message }) if message.contains("no message")));
        assert_eq!(leftovers(base.path()), 0);
    }

    #[test]
    fn a_selector_that_could_be_a_flag_is_refused_before_anything_is_staged() {
        let base = tempfile::tempdir().unwrap();
        for bad in ["--root", "-h", "--input=x", "", "  "] {
            let err = query(Path::new("/definitely/not/typst"), base.path(), "x", &[], bad, COMPILE_TIMEOUT);
            assert!(matches!(err, Err(TypstError::Other { .. })), "{bad:?}: {err:?}");
        }
        assert_eq!(leftovers(base.path()), 0);
        assert_eq!(skip_noise("  ( /* a */ // b\n \"@x"), "\"@x");
        assert_eq!(skip_noise("/* never closed"), "");
        assert_eq!(skip_noise("// no newline"), "");
    }

    #[test]
    fn query_rejects_unsafe_names_and_a_missing_program_without_leftovers() {
        let base = tempfile::tempdir().unwrap();
        let err = query(Path::new("/definitely/not/typst"), base.path(), "x", &[("../evil.png".into(), vec![1])], "<a>", COMPILE_TIMEOUT);
        assert!(matches!(err, Err(TypstError::Other { .. })));
        let err = query(Path::new("/definitely/not/typst"), base.path(), "x", &[], "<a>", COMPILE_TIMEOUT);
        assert!(matches!(err, Err(TypstError::NotFound { .. })), "{err:?}");
        assert_eq!(leftovers(base.path()), 0);
    }

    #[test]
    fn query_with_real_typst_returns_the_labelled_value_as_json() {
        let Some(bin) = real_typst() else { return };
        let base = tempfile::tempdir().unwrap();
        let src = "#metadata((total: 3, starts: ())) <page-report>\nHello\n";
        let out = query(&bin, base.path(), src, &[], "<page-report>", COMPILE_TIMEOUT).unwrap();
        let v: serde_json::Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(v["total"], 3);
        assert_eq!(leftovers(base.path()), 0);
        let err = query(&bin, base.path(), src, &[], "<missing>", COMPILE_TIMEOUT);
        assert!(matches!(err, Err(TypstError::Compile { .. })), "{err:?}");
        assert_eq!(leftovers(base.path()), 0);
    }

    #[test]
    fn unknown_font_is_refused() {
        let Some(bin) = real_typst() else { return };
        let base = tempfile::tempdir().unwrap();
        let err = compile(&bin, base.path(), "#set text(font: \"Definitely Not A Font\")\nhi\n", &[], false, COMPILE_TIMEOUT);
        assert!(matches!(&err, Err(TypstError::Font { family }) if family.to_lowercase().contains("definitely not a font")), "{:?}", err.as_ref().err());
    }

    #[test]
    fn lists_bundled_fonts_and_reports_a_version() {
        let Some(bin) = real_typst() else { return };
        assert!(list_fonts(&bin).unwrap().iter().any(|f| f == "Libertinus Serif"));
        assert!(version(&bin).unwrap().starts_with("typst"));
    }
}
