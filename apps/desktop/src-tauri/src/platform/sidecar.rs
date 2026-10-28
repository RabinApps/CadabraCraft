//! Finding and running a bundled helper program (the typst and voice-engine sidecars). Each caller keeps its own error
//! type and install advice: `run` reports a `RunError` that the caller converts with a small `From` impl.
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

pub fn is_executable(p: &Path) -> bool {
    let Ok(md) = fs::metadata(p) else { return false };
    if !md.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        md.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

/// The folder of the app executable, where Tauri places a sidecar.
pub fn bundled_dir() -> Option<PathBuf> {
    std::env::current_exe().ok()?.parent().map(Path::to_path_buf)
}

/// Search order for a program: the bundled folder, then every PATH entry, then the fallback folders.
pub fn search_dirs(bundled: Option<&Path>, path_var: Option<&std::ffi::OsStr>, fallback_dirs: &[&str]) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = bundled.map(Path::to_path_buf).into_iter().collect();
    dirs.extend(path_var.map(|p| std::env::split_paths(p).collect::<Vec<_>>()).unwrap_or_default());
    dirs.extend(fallback_dirs.iter().map(PathBuf::from));
    dirs
}

/// The first executable named one of `names` in `dirs` (empty entries are skipped).
pub fn find_executable(names: &[&str], dirs: &[PathBuf]) -> Option<PathBuf> {
    dirs.iter().filter(|d| !d.as_os_str().is_empty()).flat_map(|d| names.iter().map(move |n| d.join(n))).find(|p| is_executable(p))
}

pub struct Captured {
    pub success: bool,
    pub stdout: Vec<u8>,
    pub stderr: String,
}

/// Why `run` failed; the caller maps it onto its own error type.
#[derive(Debug, PartialEq)]
pub enum RunError {
    /// The program does not exist (the message already carries the caller's install advice).
    NotFound(String),
    Timeout { seconds: u64 },
    Cancelled,
    Other(String),
}

fn other(m: impl std::fmt::Display) -> RunError {
    RunError::Other(m.to_string())
}

pub struct Run<'a> {
    pub bin: &'a Path,
    pub args: &'a [String],
    /// Working directory; the parent's when None.
    pub cwd: Option<&'a Path>,
    pub timeout: Duration,
    /// Killed (and waited for) as soon as this becomes true.
    pub cancel: Option<&'a AtomicBool>,
    /// Put `../lib` next to the program on the dynamic library path (the "shared" sherpa archive layout).
    pub shared_libs: bool,
    /// Appended to the "Could not start" message.
    pub install_advice: &'a str,
}

/// Runs the program with output captured through files (no pipe deadlocks) and a hard timeout; the timeout or the cancel
/// flag kills the process and waits for it, so nothing is left running.
pub fn run(r: &Run) -> Result<Captured, RunError> {
    let scratch = tempfile::Builder::new().prefix("cadabracraft-run-").tempdir().map_err(other)?;
    let (out_path, err_path) = (scratch.path().join("out"), scratch.path().join("err"));
    let mut cmd = Command::new(r.bin);
    cmd.args(r.args).stdin(Stdio::null()).stdout(File::create(&out_path).map_err(other)?).stderr(File::create(&err_path).map_err(other)?);
    if let Some(cwd) = r.cwd {
        cmd.current_dir(cwd);
    }
    if r.shared_libs {
        if let Some(dir) = r.bin.parent() {
            let lib = dir.join("..").join("lib");
            if lib.is_dir() {
                let var = if cfg!(target_os = "macos") { "DYLD_LIBRARY_PATH" } else { "LD_LIBRARY_PATH" };
                let joined = std::env::join_paths(std::iter::once(lib).chain(std::env::var_os(var).map(|v| std::env::split_paths(&v).collect::<Vec<_>>()).unwrap_or_default())).map_err(other)?;
                cmd.env(var, joined);
            }
        }
    }
    let mut child = cmd.spawn().map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => RunError::NotFound(format!("Could not start {}. {}", r.bin.display(), r.install_advice)),
        _ => other(format!("Could not start {}: {e}", r.bin.display())),
    })?;
    let deadline = Instant::now() + r.timeout;
    let status = loop {
        if r.cancel.is_some_and(|c| c.load(Ordering::Relaxed)) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(RunError::Cancelled);
        }
        match child.try_wait().map_err(other)? {
            Some(s) => break s,
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(RunError::Timeout { seconds: r.timeout.as_secs() });
            }
            None => std::thread::sleep(Duration::from_millis(20)),
        }
    };
    Ok(Captured { success: status.success(), stdout: fs::read(&out_path).map_err(other)?, stderr: String::from_utf8_lossy(&fs::read(&err_path).map_err(other)?).into_owned() })
}
