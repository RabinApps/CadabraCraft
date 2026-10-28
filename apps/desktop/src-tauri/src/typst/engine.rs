//! Finding the typst program and running it: version, fonts and compile.
use super::error::{other, TypstError};
use crate::platform::sidecar::{self, bundled_dir, find_executable, is_executable, search_dirs, Captured, Run};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

pub const COMPILE_TIMEOUT: Duration = Duration::from_secs(120);
const FONTS_TIMEOUT: Duration = Duration::from_secs(30);
const INSTALL_ADVICE: &str = "The Typst program that ships with CadabraCraft is missing; reinstall the app. You can also install Typst yourself (https://typst.app) and set its path in the export dialog.";

/// Folder of bundled fonts (Inter), passed to Typst as `--font-path`. Set once at startup from the resource dir.
static FONT_DIR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

pub fn set_font_dir(dir: PathBuf) {
    if dir.is_dir() {
        let _ = FONT_DIR.set(dir);
    }
}

/// `--font-path <dir>`; Typst accepts it only after the subcommand (`typst fonts --font-path d`).
fn font_args(dir: Option<&Path>) -> Vec<String> {
    dir.map(|d| vec!["--font-path".to_string(), d.to_string_lossy().into_owned()]).unwrap_or_default()
}

/// Finds `typst`: `explicit` (a user-configured path), then `TYPST_BIN`, then the bundled sidecar, then PATH, then
/// `/opt/homebrew/bin` and `/usr/local/bin` (a GUI app launched from Finder does not inherit the shell's PATH).
pub fn find_typst(explicit: Option<&str>) -> Result<PathBuf, TypstError> {
    find_typst_in(explicit, std::env::var("TYPST_BIN").ok().as_deref(), bundled_dir().as_deref(), std::env::var_os("PATH").as_deref(), &["/opt/homebrew/bin", "/usr/local/bin"])
}

pub fn find_typst_in(explicit: Option<&str>, env_bin: Option<&str>, bundled: Option<&Path>, path_var: Option<&std::ffi::OsStr>, fallback_dirs: &[&str]) -> Result<PathBuf, TypstError> {
    for (given, what) in [(explicit, "the configured path"), (env_bin, "TYPST_BIN")] {
        if let Some(g) = given.map(str::trim).filter(|g| !g.is_empty()) {
            let p = PathBuf::from(g);
            return if is_executable(&p) {
                Ok(p)
            } else {
                Err(TypstError::NotFound { message: format!("No runnable typst program at {g} (from {what}). {INSTALL_ADVICE}") })
            };
        }
    }
    let names: &[&str] = if cfg!(windows) { &["typst.exe", "typst"] } else { &["typst"] };
    find_executable(names, &search_dirs(bundled, path_var, fallback_dirs))
        .ok_or_else(|| TypstError::NotFound { message: format!("The \"typst\" program was not found (searched the app folder, PATH, /opt/homebrew/bin and /usr/local/bin). {INSTALL_ADVICE}") })
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
    list_fonts_with(bin, FONT_DIR.get().map(PathBuf::as_path))
}

fn list_fonts_with(bin: &Path, font_dir: Option<&Path>) -> Result<Vec<String>, TypstError> {
    let mut args = vec!["fonts".to_string()];
    args.extend(font_args(font_dir));
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

/// Writes `source` and `files` into a fresh temp directory under `tmp_base`, runs `typst compile`, returns the PDF.
/// The directory is removed on every path out (success, error, timeout).
pub fn compile(bin: &Path, tmp_base: &Path, source: &str, files: &[(String, Vec<u8>)], pdf_a: bool, timeout: Duration) -> Result<Vec<u8>, TypstError> {
    let rels = files.iter().map(|(n, _)| safe_rel(n)).collect::<Result<Vec<_>, _>>()?; // validate before touching disk
    let dir = tempfile::Builder::new().prefix("cadabracraft-pdf-").tempdir_in(tmp_base).map_err(other)?;
    for (rel, (_, bytes)) in rels.iter().zip(files) {
        let target = dir.path().join(rel);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(other)?;
        }
        File::create(&target).and_then(|mut f| f.write_all(bytes)).map_err(other)?;
    }
    fs::write(dir.path().join("main.typ"), source).map_err(other)?;
    let mut args: Vec<String> = vec!["compile".into(), "--root".into(), ".".into(), "--diagnostic-format".into(), "short".into()];
    args.extend(font_args(FONT_DIR.get().map(PathBuf::as_path)));
    if pdf_a {
        args.extend(["--pdf-standard".into(), "a-2b".into()]);
    }
    args.extend(["main.typ".into(), "out.pdf".into()]);
    let r = run_capture(bin, &args, dir.path(), timeout)?;
    if !r.success {
        let msg = r.stderr.trim();
        return Err(TypstError::Compile { message: if msg.is_empty() { "typst exited with an error and no message".into() } else { msg.to_string() } });
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
        match find_typst(None) {
            Ok(p) => Some(p),
            Err(e) => {
                assert!(std::env::var("REQUIRE_TYPST").as_deref() != Ok("1"), "REQUIRE_TYPST=1 but typst was not found: {e:?}");
                eprintln!("skipping: typst not installed");
                None
            }
        }
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
        assert_eq!(find_typst_in(Some(fake.to_str().unwrap()), None, None, None, &[]).unwrap(), fake);
        assert_eq!(find_typst_in(None, Some(fake.to_str().unwrap()), None, None, &[]).unwrap(), fake);
        assert_eq!(find_typst_in(None, None, Some(d.path()), None, &[]).unwrap(), fake);
        assert_eq!(find_typst_in(None, None, None, Some(d.path().as_os_str()), &[]).unwrap(), fake);
        assert_eq!(find_typst_in(None, None, None, None, &[dir]).unwrap(), fake);
        // The bundled sidecar wins over PATH.
        let other_dir = tempfile::tempdir().unwrap();
        assert_eq!(find_typst_in(None, None, Some(d.path()), Some(other_dir.path().as_os_str()), &[]).unwrap(), fake);
        // An explicit path that is wrong is an error, not a silent fallback to the bundled copy or PATH.
        let missing = find_typst_in(Some("/no/such/typst"), None, Some(d.path()), Some(d.path().as_os_str()), &[]);
        assert!(matches!(&missing, Err(TypstError::NotFound { message }) if message.contains("/no/such/typst") && message.contains("reinstall")));
        let none = find_typst_in(None, None, None, Some(std::ffi::OsStr::new("")), &["/no/such/dir"]);
        assert!(matches!(&none, Err(TypstError::NotFound { message }) if message.contains("reinstall")));
    }

    /// Regression: `--font-path` must follow the subcommand, so the bundled Inter shows up in `typst fonts`.
    #[test]
    fn bundled_fonts_are_listed_when_a_font_dir_is_given() {
        let Some(bin) = real_typst() else { return };
        let fonts = Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries/fonts");
        if !fonts.is_dir() {
            assert!(std::env::var("REQUIRE_TYPST").as_deref() != Ok("1"), "binaries/fonts missing; run scripts/fetch-typst.sh");
            return;
        }
        assert!(list_fonts_with(&bin, Some(&fonts)).unwrap().iter().any(|f| f == "Inter"));
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
