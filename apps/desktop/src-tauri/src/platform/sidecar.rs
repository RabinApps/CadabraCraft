//! Finding and running a bundled helper program (the typst and voice-engine sidecars). Each caller keeps its own error
//! type and install advice: `run` reports a `RunError` that the caller converts with a small `From` impl.
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

pub fn is_executable(p: &Path) -> bool {
    let Ok(md) = fs::metadata(p) else { return false };
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        md.is_file() && md.permissions().mode() & 0o111 != 0
    }
    // Windows decides by extension (`java_names`, `find_executable`'s callers), not by a permission bit.
    #[cfg(not(unix))]
    {
        md.is_file()
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

/// Windows creates a console window for every console program a GUI app starts, which flashes over the app while Typst,
/// ffmpeg or the voice engine run. `CREATE_NO_WINDOW` stops that (the flag Rust's `CommandExt` takes).
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Keeps a console program from opening a window; nothing to do everywhere else.
#[cfg(windows)]
fn hide_console(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_console(_cmd: &mut Command) {}

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
    Timeout {
        seconds: u64,
    },
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

/// Kills the child and everything it started, then reaps the child. Unix: SIGKILL to the child's process group (made with
/// `process_group(0)`, so the group id is the child's pid). Windows: `taskkill /T /F`. Both fall back to killing the child.
#[allow(unsafe_code)] // the one unsafe block in the crate: the `kill` syscall below
fn kill_tree(child: &mut Child) {
    #[cfg(unix)]
    {
        extern "C" {
            fn kill(pid: i32, sig: i32) -> i32;
        }
        const SIGKILL: i32 = 9;
        // SAFETY: plain syscall; a negative pid addresses the group, which only holds processes started by the child.
        let _ = unsafe { kill(-(child.id() as i32), SIGKILL) };
    }
    #[cfg(windows)]
    {
        let mut kill = Command::new("taskkill");
        kill.args(["/T", "/F", "/PID", &child.id().to_string()]).stdout(Stdio::null()).stderr(Stdio::null());
        hide_console(&mut kill);
        let _ = kill.status();
    }
    let _ = child.kill();
    let _ = child.wait();
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
    hide_console(&mut cmd);
    if r.shared_libs {
        if let Some(dir) = r.bin.parent() {
            let lib = dir.join("..").join("lib");
            if lib.is_dir() {
                let var = if cfg!(target_os = "macos") { "DYLD_LIBRARY_PATH" } else { "LD_LIBRARY_PATH" };
                let joined = std::env::join_paths(
                    std::iter::once(lib).chain(std::env::var_os(var).map(|v| std::env::split_paths(&v).collect::<Vec<_>>()).unwrap_or_default()),
                )
                .map_err(other)?;
                cmd.env(var, joined);
            }
        }
    }
    // Its own process group on Unix, so a timeout or cancel can kill the program and everything it started.
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    let mut child = cmd.spawn().map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => RunError::NotFound(format!("Could not start {}. {}", r.bin.display(), r.install_advice)),
        _ => other(format!("Could not start {}: {e}", r.bin.display())),
    })?;
    let deadline = Instant::now() + r.timeout;
    let status = loop {
        if r.cancel.is_some_and(|c| c.load(Ordering::Relaxed)) {
            kill_tree(&mut child);
            return Err(RunError::Cancelled);
        }
        match child.try_wait().map_err(other)? {
            Some(s) => break s,
            None if Instant::now() >= deadline => {
                kill_tree(&mut child);
                return Err(RunError::Timeout { seconds: r.timeout.as_secs() });
            }
            None => std::thread::sleep(Duration::from_millis(20)),
        }
    };
    Ok(Captured {
        success: status.success(),
        stdout: fs::read(&out_path).map_err(other)?,
        stderr: String::from_utf8_lossy(&fs::read(&err_path).map_err(other)?).into_owned(),
    })
}

#[cfg(all(test, unix))]
#[allow(clippy::unwrap_used, clippy::expect_used)] // clippy's allow-*-in-tests only recognises a plain `#[cfg(test)]`
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn script(dir: &Path, name: &str, body: &str) -> PathBuf {
        let p = dir.join(name);
        fs::write(&p, format!("#!/bin/sh\n{body}\n")).unwrap();
        fs::set_permissions(&p, fs::Permissions::from_mode(0o755)).unwrap();
        p
    }

    fn run_of<'a>(bin: &'a Path, args: &'a [String]) -> Run<'a> {
        Run { bin, args, cwd: None, timeout: Duration::from_secs(30), cancel: None, shared_libs: false, install_advice: "Install it." }
    }

    #[test]
    fn executables_are_regular_files_with_an_execute_bit() {
        let d = tempfile::tempdir().unwrap();
        let exe = script(d.path(), "tool", "true");
        let plain = d.path().join("plain");
        fs::write(&plain, "x").unwrap();
        assert!(is_executable(&exe));
        assert!(!is_executable(&plain));
        assert!(!is_executable(d.path()), "a folder is not a program");
        assert!(!is_executable(&d.path().join("missing")));
    }

    #[test]
    fn search_order_is_bundled_then_path_then_fallbacks_and_finding_skips_empty_entries() {
        let dirs = search_dirs(Some(Path::new("/b")), Some(std::ffi::OsStr::new("/p1:/p2")), &["/f"]);
        assert_eq!(dirs, vec![PathBuf::from("/b"), PathBuf::from("/p1"), PathBuf::from("/p2"), PathBuf::from("/f")]);
        assert_eq!(search_dirs(None, None, &[]), Vec::<PathBuf>::new());
        assert!(bundled_dir().is_some());
        let d = tempfile::tempdir().unwrap();
        let exe = script(d.path(), "tool", "true");
        assert_eq!(find_executable(&["nope", "tool"], &[PathBuf::new(), d.path().to_path_buf()]), Some(exe));
        assert_eq!(find_executable(&["nope"], &[d.path().to_path_buf()]), None);
    }

    #[test]
    fn captures_output_status_and_honours_the_working_directory() {
        let d = tempfile::tempdir().unwrap();
        let bin = script(d.path(), "t", "pwd; echo oops >&2; exit \"$1\"");
        let work = fs::canonicalize(d.path()).unwrap();
        let args = ["3".to_string()];
        let got = run(&Run { cwd: Some(&work), ..run_of(&bin, &args) }).unwrap();
        assert!(!got.success);
        assert_eq!(String::from_utf8(got.stdout).unwrap().trim(), work.to_str().unwrap());
        assert_eq!(got.stderr.trim(), "oops");
        assert!(run(&run_of(&bin, &["0".to_string()])).unwrap().success);
    }

    #[test]
    fn a_missing_program_carries_the_install_advice_and_an_unrunnable_one_is_other() {
        let d = tempfile::tempdir().unwrap();
        let gone = d.path().join("gone");
        let Err(RunError::NotFound(m)) = run(&run_of(&gone, &[])) else { panic!("expected NotFound") };
        assert!(m.contains("Could not start") && m.ends_with("Install it."), "{m}");
        let plain = d.path().join("plain");
        fs::write(&plain, "x").unwrap();
        let Err(RunError::Other(m)) = run(&run_of(&plain, &[])) else { panic!("expected Other") };
        assert!(m.starts_with("Could not start"), "{m}");
    }

    #[test]
    fn a_program_path_without_a_parent_cannot_start_and_gets_no_library_path() {
        let got = run(&Run { shared_libs: true, ..run_of(Path::new("/"), &[]) });
        assert!(matches!(got, Err(RunError::Other(_))));
    }

    #[test]
    fn a_slow_program_is_killed_at_the_timeout_and_a_cancel_flag_stops_it_at_once() {
        let d = tempfile::tempdir().unwrap();
        let bin = script(d.path(), "slow", "sleep 30");
        let started = Instant::now();
        let got = run(&Run { timeout: Duration::from_millis(100), ..run_of(&bin, &[]) });
        assert_eq!(got.err(), Some(RunError::Timeout { seconds: 0 }));
        let cancel = AtomicBool::new(true);
        let got = run(&Run { cancel: Some(&cancel), ..run_of(&bin, &[]) });
        assert_eq!(got.err(), Some(RunError::Cancelled));
        assert!(started.elapsed() < Duration::from_secs(20), "neither run waited for the program");
    }

    fn alive(pid: i32) -> bool {
        std::process::Command::new("kill").args(["-0", &pid.to_string()]).stderr(Stdio::null()).status().is_ok_and(|s| s.success())
    }

    fn grandchild_is_killed(cancel: Option<&AtomicBool>, timeout: Duration) {
        let d = tempfile::tempdir().unwrap();
        let pidfile = d.path().join("pid");
        let bin = script(d.path(), "wrapper", &format!("sleep 60 &\necho $! > {}\nwait", pidfile.display()));
        let started = Instant::now();
        let got = run(&Run { timeout, cancel, ..run_of(&bin, &[]) });
        assert!(matches!(got, Err(RunError::Timeout { .. } | RunError::Cancelled)));
        let pid: i32 = fs::read_to_string(&pidfile).unwrap().trim().parse().unwrap();
        // The orphaned sleep is reparented and reaped by init, which can take a moment.
        let until = Instant::now() + Duration::from_secs(5);
        while alive(pid) && Instant::now() < until {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(!alive(pid), "the grandchild survived");
        assert!(started.elapsed() < Duration::from_secs(30));
    }

    #[test]
    fn a_timeout_kills_the_grandchildren_too() {
        grandchild_is_killed(None, Duration::from_millis(1500));
    }

    #[test]
    fn a_cancel_kills_the_grandchildren_too() {
        let cancel = AtomicBool::new(false);
        std::thread::scope(|s| {
            s.spawn(|| {
                std::thread::sleep(Duration::from_millis(1000));
                cancel.store(true, Ordering::Relaxed);
            });
            grandchild_is_killed(Some(&cancel), Duration::from_secs(30));
        });
    }

    #[test]
    fn shared_libraries_next_to_the_program_go_on_the_library_path() {
        let d = tempfile::tempdir().unwrap();
        fs::create_dir_all(d.path().join("bin")).unwrap();
        fs::create_dir_all(d.path().join("lib")).unwrap();
        let bin = script(&d.path().join("bin"), "t", "echo \"$DYLD_LIBRARY_PATH:$LD_LIBRARY_PATH\"");
        let got = run(&Run { shared_libs: true, ..run_of(&bin, &[]) }).unwrap();
        assert!(got.success);
        // macOS strips DYLD_* variables when it starts the system shell, so only Linux can observe the variable.
        #[cfg(target_os = "linux")]
        assert!(String::from_utf8(got.stdout).unwrap().contains("/bin/../lib"));
        // Without a lib folder the environment is left alone.
        let bare = tempfile::tempdir().unwrap();
        let bin = script(bare.path(), "t", "echo \"[$DYLD_LIBRARY_PATH$LD_LIBRARY_PATH]\"");
        // The CI container presets LD_LIBRARY_PATH, so compare with what the script sees without the feature.
        let before = run(&run_of(&bin, &[])).unwrap();
        let got = run(&Run { shared_libs: true, ..run_of(&bin, &[]) }).unwrap();
        assert!(got.success);
        assert_eq!(got.stdout, before.stdout);
    }

    #[cfg(unix)]
    #[test]
    fn a_library_folder_whose_path_holds_the_separator_is_an_error_not_a_wrong_path() {
        let d = tempfile::tempdir().unwrap();
        let odd = d.path().join("a:b"); // `:` separates library paths, so this one cannot be put on one
        fs::create_dir_all(odd.join("bin")).unwrap();
        fs::create_dir_all(odd.join("lib")).unwrap();
        let bin = script(&odd.join("bin"), "t", "true");
        let got = run(&Run { shared_libs: true, ..run_of(&bin, &[]) });
        assert!(matches!(got, Err(RunError::Other(_))));
    }
}

#[cfg(all(test, windows))]
#[allow(clippy::unwrap_used, clippy::expect_used)] // clippy's allow-*-in-tests only recognises a plain `#[cfg(test)]`
mod windows_tests {
    use super::*;

    /// A console program started without a console window still runs and its output still reaches the capture files.
    #[test]
    fn a_hidden_program_still_runs_and_its_output_is_captured() {
        let args = ["/C".to_string(), "echo hi".to_string()];
        let got = run(&Run {
            bin: Path::new("cmd.exe"),
            args: &args,
            cwd: None,
            timeout: Duration::from_secs(30),
            cancel: None,
            shared_libs: false,
            install_advice: "Start cmd.exe.",
        })
        .unwrap();
        assert!(got.success);
        assert!(String::from_utf8_lossy(&got.stdout).contains("hi"), "{}", got.stderr);
    }
}
