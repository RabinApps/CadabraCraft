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

/// `s` without leading whitespace, opening parentheses and comments (`/* .. */`, which nest in Typst, and `// ..`),
/// which Typst ignores between `import` and its path. None when a block comment never ends: the rest of the source is
/// then unreadable to us, so the caller refuses it (the safest answer; Typst itself would report the error).
fn skip_noise(mut s: &str) -> Option<&str> {
    loop {
        let t = s.trim_start_matches(|c: char| c.is_whitespace() || c == '(');
        s = if let Some(rest) = t.strip_prefix("/*") {
            skip_block_comment(rest)?
        } else if let Some(rest) = t.strip_prefix("//") {
            rest.split_once('\n').map_or("", |(_, after)| after)
        } else {
            return Some(t);
        };
    }
}

/// What follows the block comment whose `/*` was just consumed, counting nested `/* */`; None if it is unterminated.
fn skip_block_comment(s: &str) -> Option<&str> {
    let mut depth = 1usize;
    let mut i = 0;
    while i < s.len() {
        let rest = &s[i..];
        if rest.starts_with("/*") {
            depth += 1;
            i += 2;
        } else if rest.starts_with("*/") {
            depth -= 1;
            i += 2;
            if depth == 0 {
                return Some(&s[i..]);
            }
        } else {
            i += rest.chars().next().map_or(1, char::len_utf8);
        }
    }
    None
}

/// Refuses a source that imports or includes a package (`#import "@preview/name:1.0.0"`). Typst downloads a package
/// it does not have over the network and its CLI has no offline switch, so the way to keep v1 network-free is to never
/// let such an import reach it. Our templates import none. Best effort: Typst can also build the path from an
/// expression, which this does not catch; the empty package folders only stop installed or cached packages.
fn refuse_packages(source: &str) -> Result<(), TypstError> {
    for kw in ["import", "include"] {
        for (i, _) in source.match_indices(kw) {
            if skip_noise(&source[i + kw.len()..]).is_none_or(|rest| rest.starts_with("\"@")) {
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
pub fn compile(bin: &Path, tmp_base: &Path, source: &str, files: &[(String, Vec<u8>)], pdf_a: bool, pdf_ua: bool, timeout: Duration) -> Result<Vec<u8>, TypstError> {
    let dir = stage(tmp_base, source, files)?;
    let mut args: Vec<String> = vec!["compile".into(), "--root".into(), ".".into(), "--diagnostic-format".into(), "short".into()];
    args.extend(font_args(&font_dirs()));
    args.extend(package_args(dir.path())?);
    // PDF/A-2b and PDF/UA-1 can be combined; Typst takes them as one comma-separated value.
    let standards: Vec<&str> = [(pdf_a, "a-2b"), (pdf_ua, "ua-1")].into_iter().filter(|(on, _)| *on).map(|(_, s)| s).collect();
    if !standards.is_empty() {
        args.extend(["--pdf-standard".into(), standards.join(",")]);
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
mod tests;
