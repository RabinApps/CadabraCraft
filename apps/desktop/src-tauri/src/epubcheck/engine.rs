//! Finding the bundled EPUBCheck and its Java runtime, and running them on one EPUB.
use super::error::EpubcheckError;
use super::report::{parse_report, Report};
use crate::platform::sidecar::{self, find_executable, is_executable, Run};
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::OnceLock;
use std::time::Duration;

/// The JVM starts in a few seconds and a large book takes longer; past this the check is stopped.
pub const VALIDATE_TIMEOUT: Duration = Duration::from_secs(120);

const ADVICE: &str = "The EPUB checker ships inside CadabraCraft; reinstall the app.";

static RESOURCE_DIR: OnceLock<PathBuf> = OnceLock::new();

/// The app's resource folder (where `epubcheck/` and the `jre/<arch>/` runtimes are bundled), set once at startup.
pub fn set_resource_dir(dir: PathBuf) {
    let _ = RESOURCE_DIR.set(dir);
}

pub struct Runtime {
    pub java: PathBuf,
    pub jar: PathBuf,
    /// Both come from the app's resource folder (always so in a release build).
    pub bundled: bool,
}

fn java_names(windows: bool) -> &'static [&'static str] {
    if windows {
        &["java.exe", "java"]
    } else {
        &["java"]
    }
}

/// Where a bundled runtime lives for this CPU (a universal macOS app carries both and picks at run time).
fn jre_dir(resources: &Path, arch: &str) -> PathBuf {
    resources.join("jre").join(arch)
}

fn not_found(what: &str) -> EpubcheckError {
    EpubcheckError::NotFound { message: format!("{what} was not found. {ADVICE}") }
}

/// Release builds (`dev` false) use only the copy bundled in `resources`; the other arguments are ignored. Debug builds try
/// `env_dir` (a folder holding `epubcheck.jar`) and `env_java` (a `java` program), then `resources`, then `checkout` (the
/// `binaries/` folder of this source tree) and a `java` on PATH, so a checkout that skipped the runtime build still works.
pub fn find_runtime_in(
    resources: Option<&Path>,
    env_dir: Option<&str>,
    env_java: Option<&str>,
    checkout: Option<&Path>,
    path_var: Option<&OsStr>,
    arch: &str,
    dev: bool,
) -> Result<Runtime, EpubcheckError> {
    let names = java_names(cfg!(windows));
    let nonempty = |s: Option<&str>| s.map(str::trim).filter(|s| !s.is_empty()).map(PathBuf::from);
    let jar_dirs: Vec<PathBuf> = if dev {
        nonempty(env_dir).into_iter().chain(resources.map(|r| r.join("epubcheck"))).chain(checkout.map(|c| c.join("epubcheck"))).collect()
    } else {
        resources.map(|r| r.join("epubcheck")).into_iter().collect()
    };
    let jar = jar_dirs.iter().map(|d| d.join("epubcheck.jar")).find(|p| p.is_file()).ok_or_else(|| not_found("EPUBCheck"))?;

    let mut java_dirs: Vec<PathBuf> = Vec::new();
    if dev {
        if let Some(j) = nonempty(env_java) {
            return if is_executable(&j) {
                Ok(Runtime { java: j, jar, bundled: false })
            } else {
                Err(EpubcheckError::NotFound { message: format!("No runnable java at {} (from JAVA_BIN).", j.display()) })
            };
        }
    }
    java_dirs.extend(resources.map(|r| jre_dir(r, arch).join("bin")));
    if dev {
        java_dirs.extend(checkout.map(|c| jre_dir(c, arch).join("bin")));
        java_dirs.extend(path_var.map(|p| std::env::split_paths(p).collect::<Vec<_>>()).unwrap_or_default());
    }
    let java = find_executable(names, &java_dirs).ok_or_else(|| not_found("The Java runtime for EPUBCheck"))?;
    let bundled = resources.is_some_and(|r| jar.starts_with(r) && java.starts_with(r));
    Ok(Runtime { java, jar, bundled })
}

pub fn find_runtime() -> Result<Runtime, EpubcheckError> {
    let dev = cfg!(debug_assertions);
    let checkout = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
    find_runtime_in(
        RESOURCE_DIR.get().map(PathBuf::as_path),
        std::env::var("EPUBCHECK_DIR").ok().as_deref(),
        std::env::var("JAVA_BIN").ok().as_deref(),
        Some(&checkout),
        std::env::var_os("PATH").as_deref(),
        std::env::consts::ARCH,
        dev,
    )
}

/// The last lines of what the program printed, for a run that left no report.
fn tail(s: &str) -> String {
    let lines: Vec<&str> = s.lines().filter(|l| !l.trim().is_empty()).collect();
    lines[lines.len().saturating_sub(6)..].join("\n")
}

/// Runs EPUBCheck on `epub` and returns its report. EPUBCheck exits with a failure status when the book has errors, so the
/// report file, not the exit status, says whether the run worked.
pub fn validate(rt: &Runtime, epub: &Path, timeout: Duration, cancel: &AtomicBool) -> Result<Report, EpubcheckError> {
    let scratch = tempfile::Builder::new().prefix("cadabracraft-epubcheck-").tempdir().map_err(super::error::other)?;
    let report = scratch.path().join("report.json");
    let args: Vec<String> = vec![
        "-Xmx512m".into(),
        format!("-Djava.io.tmpdir={}", scratch.path().display()),
        "-Dfile.encoding=UTF-8".into(),
        "-jar".into(),
        rt.jar.to_string_lossy().into_owned(),
        epub.to_string_lossy().into_owned(),
        "--json".into(),
        report.to_string_lossy().into_owned(),
        "-q".into(),
    ];
    let out = sidecar::run(&Run { bin: &rt.java, args: &args, cwd: None, timeout, cancel: Some(cancel), shared_libs: false, install_advice: ADVICE })?;
    match fs::read_to_string(&report) {
        Ok(json) => parse_report(&json).map_err(|message| EpubcheckError::Failed { message }),
        Err(_) => Err(EpubcheckError::Failed { message: tail(&format!("{}\n{}", out.stderr, String::from_utf8_lossy(&out.stdout))) }),
    }
}

#[cfg(test)]
mod tests;
