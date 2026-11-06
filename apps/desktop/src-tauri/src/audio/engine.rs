//! The engine process: finding the sherpa CLI, running it with a timeout and a cancel flag, and synthesizing batches.
use super::batch::{engine_args, plan_batches, silence, Chunk};
use super::error::{other, AudioError};
use super::voices::VOICES;
use super::wav::parse_wav;
use crate::platform::sidecar::{self, find_executable, is_executable, search_dirs, Captured, Run};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

/// A batch that runs longer than this is killed (a slow machine still renders a few thousand characters in minutes).
const BATCH_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const BINARY: &str = if cfg!(windows) { "sherpa-onnx-offline-tts.exe" } else { "sherpa-onnx-offline-tts" };
const INSTALL_ADVICE: &str = "The voice engine that ships with CadabraCraft is missing; reinstall the app.";

/// Finds the engine. The webview cannot choose the program: release builds run only the sidecar bundled next to the app
/// executable. Debug builds (dev runs and tests) also honour `SHERPA_TTS_BIN`, then PATH.
pub fn find_sherpa() -> Result<PathBuf, AudioError> {
    let dev = cfg!(debug_assertions);
    let env_bin = if dev { std::env::var("SHERPA_TTS_BIN").ok() } else { None };
    find_sherpa_in(env_bin.as_deref(), sidecar::bundled_dir().as_deref(), std::env::var_os("PATH").as_deref(), dev)
}

/// `dev` false: only `bundled`; `env_bin` and `path_var` are ignored. `dev` true: `env_bin` (an error when it is not
/// runnable), then `bundled` and PATH.
pub fn find_sherpa_in(env_bin: Option<&str>, bundled: Option<&Path>, path_var: Option<&std::ffi::OsStr>, dev: bool) -> Result<PathBuf, AudioError> {
    if let Some(g) = env_bin.map(str::trim).filter(|g| dev && !g.is_empty()) {
        let p = PathBuf::from(g);
        return if is_executable(&p) {
            Ok(p)
        } else {
            Err(AudioError::NotFound { message: format!("No runnable voice engine at {g} (from SHERPA_TTS_BIN). {INSTALL_ADVICE}") })
        };
    }
    find_executable(&[BINARY], &search_dirs(bundled, path_var.filter(|_| dev), &[]))
        .ok_or_else(|| AudioError::NotFound { message: format!("The voice engine was not found. {INSTALL_ADVICE}") })
}

const FFMPEG: &str = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
const FFMPEG_ADVICE: &str = "The audio encoder that ships with CadabraCraft (ffmpeg) is missing; reinstall the app.";

/// Finds the encoder used for M4B. Release builds run only the bundled sidecar; debug builds also honour `FFMPEG_BIN`, then PATH.
pub fn find_ffmpeg() -> Result<PathBuf, AudioError> {
    let dev = cfg!(debug_assertions);
    let env_bin = if dev { std::env::var("FFMPEG_BIN").ok() } else { None };
    find_ffmpeg_in(env_bin.as_deref(), sidecar::bundled_dir().as_deref(), std::env::var_os("PATH").as_deref(), dev)
}

/// Same rules as `find_sherpa_in`.
pub fn find_ffmpeg_in(env_bin: Option<&str>, bundled: Option<&Path>, path_var: Option<&std::ffi::OsStr>, dev: bool) -> Result<PathBuf, AudioError> {
    if let Some(g) = env_bin.map(str::trim).filter(|g| dev && !g.is_empty()) {
        let p = PathBuf::from(g);
        return if is_executable(&p) {
            Ok(p)
        } else {
            Err(AudioError::NotFound { message: format!("No runnable encoder at {g} (from FFMPEG_BIN). {FFMPEG_ADVICE}") })
        };
    }
    find_executable(&[FFMPEG], &search_dirs(bundled, path_var.filter(|_| dev), &[]))
        .ok_or_else(|| AudioError::NotFound { message: format!("The audio encoder was not found. {FFMPEG_ADVICE}") })
}

/// Runs ffmpeg in `cwd` with a timeout and the cancel flag (the same process rules as the voice engine).
pub(crate) fn run_ffmpeg(bin: &Path, args: &[String], cwd: &Path, timeout: Duration, cancel: &AtomicBool) -> Result<Captured, AudioError> {
    Ok(sidecar::run(&Run { bin, args, cwd: Some(cwd), timeout, cancel: Some(cancel), shared_libs: false, install_advice: FFMPEG_ADVICE })?)
}

/// Runs `bin args` with output captured through files (no pipe deadlocks), a hard timeout and a cancel flag. Either
/// one kills the process and waits for it, so nothing is left running.
pub(crate) fn run_cancellable(bin: &Path, args: &[String], timeout: Duration, cancel: &AtomicBool) -> Result<Captured, AudioError> {
    // The "shared" sherpa archive keeps its libraries in ../lib next to bin/.
    Ok(sidecar::run(&Run { bin, args, cwd: None, timeout, cancel: Some(cancel), shared_libs: true, install_advice: INSTALL_ADVICE })?)
}

/// Runs the engine over the chunks and joins the batches with their pauses. Shared by a chapter render and a sample.
pub(crate) fn synthesize(
    chunks: &[Chunk],
    voice_id: &str,
    speed: f64,
    sherpa: &Path,
    voices: Option<&Path>,
    cancel: &AtomicBool,
    progress: &dyn Fn(f64),
) -> Result<(Vec<i16>, u32), AudioError> {
    let voice = VOICES
        .iter()
        .find(|v| v.id == voice_id)
        .filter(|v| voices.is_some_and(|r| v.installed(r)))
        .ok_or_else(|| AudioError::VoiceMissing { voice: voice_id.to_string() })?;
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
            return Err(AudioError::Synth {
                message: if msg.is_empty() {
                    "the voice engine exited with an error and no message".into()
                } else {
                    msg.chars().rev().take(2000).collect::<Vec<_>>().into_iter().rev().collect()
                },
            });
        }
        let pcm = parse_wav(&read_batch_wav(&out)?)?;
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

/// The most one batch's WAV may hold (a few thousand characters make a few MB; this only stops a runaway engine).
const MAX_BATCH_WAV_BYTES: u64 = 512 * 1024 * 1024;

/// A batch's WAV, if it is a regular file of at most `cap` bytes: a runaway engine cannot use all memory.
fn read_capped_wav(out: &Path, cap: u64) -> Result<Vec<u8>, AudioError> {
    let too_large = || crate::project::ProjectError::TooLarge { path: "batch.wav".into(), max_mb: cap / 1024 / 1024 };
    crate::project::read_regular(out, cap, "batch.wav", too_large).map_err(|e| AudioError::Synth { message: e.to_string() })
}

fn read_batch_wav(out: &Path) -> Result<Vec<u8>, AudioError> {
    read_capped_wav(out, MAX_BATCH_WAV_BYTES)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_batch_wav_over_the_cap_or_not_a_file_is_a_synth_error() {
        let dir = tempfile::tempdir().unwrap();
        let wav = dir.path().join("b0.wav");
        fs::write(&wav, [0u8; 8]).unwrap();
        assert_eq!(read_capped_wav(&wav, 8).unwrap().len(), 8);
        assert!(matches!(read_capped_wav(&wav, 7), Err(AudioError::Synth { .. })));
        assert!(matches!(read_capped_wav(dir.path(), 8), Err(AudioError::Synth { .. })));
        assert_eq!(read_batch_wav(&wav).unwrap().len(), 8);
    }

    fn fake_bin(dir: &Path, name: &str) -> PathBuf {
        let bin = dir.join(name);
        fs::write(&bin, b"#!/bin/sh\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&bin, fs::Permissions::from_mode(0o755)).unwrap();
        }
        bin
    }

    #[test]
    fn find_sherpa_prefers_the_env_path_and_does_not_fall_back_from_a_wrong_one() {
        let dir = tempfile::tempdir().unwrap();
        assert!(matches!(find_sherpa_in(None, Some(dir.path()), None, true), Err(AudioError::NotFound { .. })));
        let bin = fake_bin(dir.path(), BINARY);
        assert_eq!(find_sherpa_in(None, Some(dir.path()), None, true).unwrap(), bin);
        assert_eq!(find_sherpa_in(Some(bin.to_str().unwrap()), None, None, true).unwrap(), bin);
        assert!(find_sherpa_in(Some("/nope/engine"), Some(dir.path()), None, true).is_err());
    }

    #[test]
    fn find_ffmpeg_prefers_the_env_path_and_does_not_fall_back_from_a_wrong_one() {
        let dir = tempfile::tempdir().unwrap();
        assert!(matches!(find_ffmpeg_in(None, Some(dir.path()), None, true), Err(AudioError::NotFound { .. })));
        let bin = fake_bin(dir.path(), FFMPEG);
        assert_eq!(find_ffmpeg_in(None, Some(dir.path()), None, true).unwrap(), bin);
        assert_eq!(find_ffmpeg_in(Some(bin.to_str().unwrap()), None, None, true).unwrap(), bin);
        assert!(find_ffmpeg_in(Some("/nope/ffmpeg"), Some(dir.path()), None, true).is_err());
    }

    #[test]
    fn release_builds_ignore_the_env_override_and_path_and_use_only_the_bundled_program() {
        let (bundled, elsewhere) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let (sherpa, ffmpeg) = (fake_bin(elsewhere.path(), BINARY), fake_bin(elsewhere.path(), FFMPEG));
        let path = std::env::join_paths([elsewhere.path()]).unwrap();
        // Nothing bundled: the env override and PATH are not consulted.
        assert!(matches!(find_sherpa_in(sherpa.to_str(), Some(bundled.path()), Some(&path), false), Err(AudioError::NotFound { .. })));
        assert!(matches!(find_ffmpeg_in(ffmpeg.to_str(), Some(bundled.path()), Some(&path), false), Err(AudioError::NotFound { .. })));
        // The same inputs in a debug build find them.
        assert_eq!(find_sherpa_in(sherpa.to_str(), Some(bundled.path()), Some(&path), true).unwrap(), sherpa);
        assert_eq!(find_ffmpeg_in(None, Some(bundled.path()), Some(&path), true).unwrap(), ffmpeg);
        // The bundled one wins in a release build.
        let (bs, bf) = (fake_bin(bundled.path(), BINARY), fake_bin(bundled.path(), FFMPEG));
        assert_eq!(find_sherpa_in(sherpa.to_str(), Some(bundled.path()), Some(&path), false).unwrap(), bs);
        assert_eq!(find_ffmpeg_in(ffmpeg.to_str(), Some(bundled.path()), Some(&path), false).unwrap(), bf);
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
