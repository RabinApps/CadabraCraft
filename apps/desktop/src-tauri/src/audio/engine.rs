//! The engine process: finding the sherpa CLI, running it with a timeout and a cancel flag, and synthesizing batches.
use super::batch::{engine_args, plan_batches, silence, Chunk};
use super::error::{other, AudioError};
use super::voices::VOICES;
use super::wav::parse_wav;
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

/// A batch that runs longer than this is killed (a slow machine still renders a few thousand characters in minutes).
const BATCH_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const BINARY: &str = if cfg!(windows) { "sherpa-onnx-offline-tts.exe" } else { "sherpa-onnx-offline-tts" };
const INSTALL_ADVICE: &str = "The voice engine that ships with CadabraCraft is missing; reinstall the app.";

fn is_executable(p: &Path) -> bool {
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

/// Finds the engine: `SHERPA_TTS_BIN`, then the folder of the app executable (the bundled sidecar), then PATH.
pub fn find_sherpa() -> Result<PathBuf, AudioError> {
    find_sherpa_in(std::env::var("SHERPA_TTS_BIN").ok().as_deref(), std::env::current_exe().ok().and_then(|e| e.parent().map(Path::to_path_buf)).as_deref(), std::env::var_os("PATH").as_deref())
}

pub fn find_sherpa_in(env_bin: Option<&str>, bundled: Option<&Path>, path_var: Option<&std::ffi::OsStr>) -> Result<PathBuf, AudioError> {
    if let Some(g) = env_bin.map(str::trim).filter(|g| !g.is_empty()) {
        let p = PathBuf::from(g);
        return if is_executable(&p) { Ok(p) } else { Err(AudioError::NotFound { message: format!("No runnable voice engine at {g} (from SHERPA_TTS_BIN). {INSTALL_ADVICE}") }) };
    }
    let mut dirs: Vec<PathBuf> = bundled.map(Path::to_path_buf).into_iter().collect();
    dirs.extend(path_var.map(|p| std::env::split_paths(p).collect::<Vec<_>>()).unwrap_or_default());
    dirs.iter().filter(|d| !d.as_os_str().is_empty()).map(|d| d.join(BINARY)).find(|p| is_executable(p)).ok_or_else(|| AudioError::NotFound { message: format!("The voice engine was not found. {INSTALL_ADVICE}") })
}

pub(crate) struct Captured {
    pub(crate) success: bool,
    pub(crate) stderr: String,
}

/// Runs `bin args` with output captured through files (no pipe deadlocks), a hard timeout and a cancel flag. Either
/// one kills the process and waits for it, so nothing is left running.
pub(crate) fn run_cancellable(bin: &Path, args: &[String], timeout: Duration, cancel: &AtomicBool) -> Result<Captured, AudioError> {
    let scratch = tempfile::Builder::new().prefix("cadabracraft-audio-run-").tempdir().map_err(other)?;
    let err_path = scratch.path().join("err");
    let mut cmd = Command::new(bin);
    cmd.args(args).stdin(Stdio::null()).stdout(File::create(scratch.path().join("out")).map_err(other)?).stderr(File::create(&err_path).map_err(other)?);
    // The "shared" sherpa archive keeps its libraries in ../lib next to bin/.
    if let Some(dir) = bin.parent() {
        let lib = dir.join("..").join("lib");
        if lib.is_dir() {
            let var = if cfg!(target_os = "macos") { "DYLD_LIBRARY_PATH" } else { "LD_LIBRARY_PATH" };
            let joined = std::env::join_paths(std::iter::once(lib).chain(std::env::var_os(var).map(|v| std::env::split_paths(&v).collect::<Vec<_>>()).unwrap_or_default())).map_err(other)?;
            cmd.env(var, joined);
        }
    }
    let mut child = cmd.spawn().map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => AudioError::NotFound { message: format!("Could not start {}. {INSTALL_ADVICE}", bin.display()) },
        _ => other(format!("Could not start {}: {e}", bin.display())),
    })?;
    let deadline = Instant::now() + timeout;
    let status = loop {
        if cancel.load(Ordering::Relaxed) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(AudioError::Cancelled);
        }
        match child.try_wait().map_err(other)? {
            Some(s) => break s,
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(AudioError::Timeout { seconds: timeout.as_secs() });
            }
            None => std::thread::sleep(Duration::from_millis(20)),
        }
    };
    Ok(Captured { success: status.success(), stderr: String::from_utf8_lossy(&fs::read(&err_path).map_err(other)?).into_owned() })
}

/// Runs the engine over the chunks and joins the batches with their pauses. Shared by a chapter render and a sample.
pub(crate) fn synthesize(chunks: &[Chunk], voice_id: &str, speed: f64, sherpa: &Path, voices: Option<&Path>, cancel: &AtomicBool, progress: &dyn Fn(f64)) -> Result<(Vec<i16>, u32), AudioError> {
    let voice = VOICES.iter().find(|v| v.id == voice_id).filter(|v| voices.is_some_and(|r| v.installed(r))).ok_or_else(|| AudioError::VoiceMissing { voice: voice_id.to_string() })?;
    let voices = voices.unwrap_or(Path::new(""));
    let batches = plan_batches(chunks);
    let total: usize = batches.iter().map(|b| b.text.len()).sum::<usize>().max(1);
    let threads = std::thread::available_parallelism().map(|n| n.get().min(4)).unwrap_or(2);
    let scratch = tempfile::Builder::new().prefix("cadabracraft-audio-").tempdir().map_err(other)?;
    let (mut samples, mut rate, mut done) = (Vec::<i16>::new(), 0u32, 0usize);
    for (i, b) in batches.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            return Err(AudioError::Cancelled);
        }
        let out = scratch.path().join(format!("b{i}.wav"));
        let r = run_cancellable(sherpa, &engine_args(voice, voices, speed, threads, &out, &b.text), BATCH_TIMEOUT, cancel)?;
        if !r.success || !out.is_file() {
            let msg = r.stderr.trim();
            return Err(AudioError::Synth { message: if msg.is_empty() { "the voice engine exited with an error and no message".into() } else { msg.chars().rev().take(2000).collect::<Vec<_>>().into_iter().rev().collect() } });
        }
        let pcm = parse_wav(&fs::read(&out).map_err(other)?)?;
        if rate != 0 && pcm.rate != rate {
            return Err(AudioError::Synth { message: "the voice engine changed its sample rate part-way".into() });
        }
        rate = pcm.rate;
        samples.extend_from_slice(&pcm.samples);
        samples.extend(std::iter::repeat_n(0, silence(rate, b.pause_after_ms)));
        let _ = fs::remove_file(&out);
        done += b.text.len();
        progress(done as f64 / total as f64);
    }
    if cancel.load(Ordering::Relaxed) {
        return Err(AudioError::Cancelled);
    }
    Ok((samples, rate))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn find_sherpa_prefers_the_env_path_and_does_not_fall_back_from_a_wrong_one() {
        let dir = tempfile::tempdir().unwrap();
        assert!(matches!(find_sherpa_in(None, Some(dir.path()), None), Err(AudioError::NotFound { .. })));
        let bin = dir.path().join(BINARY);
        fs::write(&bin, b"#!/bin/sh\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&bin, fs::Permissions::from_mode(0o755)).unwrap();
        }
        assert_eq!(find_sherpa_in(None, Some(dir.path()), None).unwrap(), bin);
        assert_eq!(find_sherpa_in(Some(bin.to_str().unwrap()), None, None).unwrap(), bin);
        assert!(find_sherpa_in(Some("/nope/engine"), Some(dir.path()), None).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn run_cancellable_times_out_and_leaves_no_process() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let e = dir.path().join("fake-engine");
        fs::write(&e, "#!/bin/sh\nsleep 30\n").unwrap();
        fs::set_permissions(&e, fs::Permissions::from_mode(0o755)).unwrap();
        let r = run_cancellable(&e, &[], Duration::from_millis(150), &AtomicBool::new(false));
        assert!(matches!(r, Err(AudioError::Timeout { .. })));
    }
}
