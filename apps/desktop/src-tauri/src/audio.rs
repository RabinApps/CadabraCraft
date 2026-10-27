//! Audiobook synthesis with the `sherpa-onnx-offline-tts` CLI, which runs both Kokoro and Piper voices. The program
//! and the voice files are looked up, never downloaded here; a voice is "installed" when its files exist under the
//! voices folder (the layout of the sherpa model archives, extracted side by side). The TypeScript side
//! (`@cadabracraft/export-audio`) narrates and chunks the text and decides the order; this layer renders one chapter
//! per call, off the UI thread, and is the only place that starts processes.
//!
//! Threading: every command is `async` and runs its work on Tauri's blocking pool (`typst::blocking`), so the webview
//! and the async runtime never stall. A job id maps to a cancel flag (`AudioJobs`); the polling loop that waits for the
//! engine checks it every 20 ms and kills the process, so Cancel takes effect within a fraction of a second. Progress
//! goes back over a `Channel`. Arguments are always an array (no shell), the engine's output goes to a temp dir that is
//! removed on every path, and the finished file is written atomically under `exports/` of the project.
use crate::audio_encode;
use crate::project::{self, ProjectError};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

/// A batch that runs longer than this is killed (a slow machine still renders a few thousand characters in minutes).
const BATCH_TIMEOUT: Duration = Duration::from_secs(15 * 60);
/// Pauses of at least this long (headings, scene breaks) always end a batch, so they are never shortened.
const HARD_PAUSE_MS: u32 = 1000;
/// Paragraph pauses end a batch only once it has this many characters; inside a batch the engine's own sentence
/// silence is used. Starting a process costs about a second, so batches must not be tiny.
const MIN_BATCH_CHARS: usize = 1200;
const MAX_BATCH_CHARS: usize = 2500;
const PARAGRAPH_MS: u32 = 600;
const BINARY: &str = if cfg!(windows) { "sherpa-onnx-offline-tts.exe" } else { "sherpa-onnx-offline-tts" };
const INSTALL_ADVICE: &str = "The voice engine that ships with CadabraCraft is missing; reinstall the app.";

/// Errors sent to the UI as `{ kind, ... }` so it can show a specific, actionable message.
#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AudioError {
    NotFound { message: String },
    /// The voice is unknown or its files are not installed.
    VoiceMissing { voice: String },
    /// The engine ran and failed (its output).
    Synth { message: String },
    Encode { format: String, message: String },
    DiskFull,
    Timeout { seconds: u64 },
    Cancelled,
    /// A voice download failed (network, server answer, or the download ended early). The partial file is kept for a retry.
    Download { message: String },
    /// A downloaded voice file did not match its pinned sha256 and was deleted.
    Checksum { file: String },
    Other { message: String },
}

pub(crate) fn other(m: impl std::fmt::Display) -> AudioError {
    AudioError::Other { message: m.to_string() }
}

impl From<tauri::Error> for AudioError {
    fn from(e: tauri::Error) -> Self {
        other(e)
    }
}

impl From<ProjectError> for AudioError {
    fn from(e: ProjectError) -> Self {
        match e {
            ProjectError::DiskFull { .. } => AudioError::DiskFull,
            e => other(e),
        }
    }
}

// ---- voices --------------------------------------------------------------------------------------------------

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Engine {
    Kokoro,
    Piper,
}

pub struct VoiceDef {
    pub id: &'static str,
    pub engine: Engine,
    /// Folder of the model archive under the voices folder.
    pub dir: &'static str,
    pub model: &'static str,
    /// Speaker id for multi-speaker models.
    pub speaker: Option<u32>,
    /// Pronunciation lexicon, relative to the voices folder (Piper voices share one).
    pub lexicon: &'static str,
}

pub const VOICES: &[VoiceDef] = &[
    VoiceDef { id: "kokoro-heart", engine: Engine::Kokoro, dir: "kokoro-multi-lang-v1_0", model: "model.onnx", speaker: Some(3), lexicon: "kokoro-multi-lang-v1_0/lexicon-us-en.txt" },
    VoiceDef { id: "piper-amy", engine: Engine::Piper, dir: "vits-piper-en_US-amy-low", model: "en_US-amy-low.onnx", speaker: None, lexicon: "lexicon-en-us.txt" },
    VoiceDef { id: "piper-libritts-0", engine: Engine::Piper, dir: "vits-piper-en_US-libritts_r-medium", model: "en_US-libritts_r-medium.onnx", speaker: Some(0), lexicon: "lexicon-en-us.txt" },
];

impl VoiceDef {
    pub(crate) fn files(&self, root: &Path) -> Vec<PathBuf> {
        let dir = root.join(self.dir);
        let mut v = vec![dir.join(self.model), dir.join("tokens.txt"), root.join(self.lexicon)];
        if self.engine == Engine::Kokoro {
            v.push(dir.join("voices.bin"));
        }
        v
    }

    fn installed(&self, root: &Path) -> bool {
        self.files(root).iter().all(|f| f.is_file())
    }
}

#[derive(Serialize, Debug, PartialEq)]
pub struct VoiceInfo {
    pub id: &'static str,
    pub engine: Engine,
    pub installed: bool,
}

static VOICES_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Where voices live (set once at startup to the app data folder). `CADABRA_VOICES_DIR` overrides it for development.
pub fn set_voices_dir(dir: PathBuf) {
    let _ = VOICES_DIR.set(dir);
}

pub(crate) fn voices_root() -> Option<PathBuf> {
    std::env::var_os("CADABRA_VOICES_DIR").map(PathBuf::from).or_else(|| VOICES_DIR.get().cloned())
}

pub fn list_voices(root: Option<&Path>) -> Vec<VoiceInfo> {
    VOICES.iter().map(|v| VoiceInfo { id: v.id, engine: v.engine, installed: root.is_some_and(|r| v.installed(r)) }).collect()
}

// ---- the engine process --------------------------------------------------------------------------------------

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

struct Captured {
    success: bool,
    stderr: String,
}

/// Runs `bin args` with output captured through files (no pipe deadlocks), a hard timeout and a cancel flag. Either
/// one kills the process and waits for it, so nothing is left running.
fn run_cancellable(bin: &Path, args: &[String], timeout: Duration, cancel: &AtomicBool) -> Result<Captured, AudioError> {
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

// ---- WAV -----------------------------------------------------------------------------------------------------

pub struct Pcm {
    pub rate: u32,
    pub samples: Vec<i16>,
}

/// Reads 16-bit mono PCM WAV, which is what the engine writes. Anything else is refused rather than guessed at.
pub fn parse_wav(b: &[u8]) -> Result<Pcm, AudioError> {
    let bad = |what: &str| AudioError::Synth { message: format!("the engine wrote an unreadable WAV file: {what}") };
    if b.len() < 12 || &b[..4] != b"RIFF" || &b[8..12] != b"WAVE" {
        return Err(bad("no RIFF header"));
    }
    let (mut at, mut rate) = (12usize, None);
    while at + 8 <= b.len() {
        let id = &b[at..at + 4];
        let size = u32::from_le_bytes([b[at + 4], b[at + 5], b[at + 6], b[at + 7]]) as usize;
        let body = at + 8;
        if id == b"fmt " {
            let f = b.get(body..body + 16).ok_or_else(|| bad("short fmt chunk"))?;
            let (tag, channels, hz, bits) = (u16::from_le_bytes([f[0], f[1]]), u16::from_le_bytes([f[2], f[3]]), u32::from_le_bytes([f[4], f[5], f[6], f[7]]), u16::from_le_bytes([f[14], f[15]]));
            if tag != 1 || channels != 1 || bits != 16 || hz == 0 {
                return Err(bad("expected 16-bit mono PCM"));
            }
            rate = Some(hz);
        } else if id == b"data" {
            let rate = rate.ok_or_else(|| bad("data before fmt"))?;
            let end = body.saturating_add(size).min(b.len()); // streamed files may claim more than they hold
            return Ok(Pcm { rate, samples: b[body..end].chunks_exact(2).map(|c| i16::from_le_bytes([c[0], c[1]])).collect() });
        }
        at = body.saturating_add(size).saturating_add(size & 1);
    }
    Err(bad("no data chunk"))
}

pub fn write_wav(rate: u32, samples: &[i16]) -> Vec<u8> {
    let data = (samples.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + samples.len() * 2);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&[1, 0, 1, 0]);
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&(rate * 2).to_le_bytes());
    out.extend_from_slice(&[2, 0, 16, 0]);
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data.to_le_bytes());
    for s in samples {
        out.extend_from_slice(&s.to_le_bytes());
    }
    out
}

// ---- rendering one chapter -----------------------------------------------------------------------------------

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Chunk {
    pub text: String,
    pub pause_after_ms: u32,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChapterRequest {
    /// One id per audiobook export; `audio_cancel` with it stops this chapter and every later one.
    pub job_id: String,
    pub root: String,
    /// Output path without extension, for example `exports/audio/01-the-quay`.
    pub base: String,
    pub chunks: Vec<Chunk>,
    pub voice: String,
    pub speed: f64,
    pub formats: Vec<String>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SampleRequest {
    /// Stops this sample with `audio_cancel`.
    pub job_id: String,
    pub chunks: Vec<Chunk>,
    pub voice: String,
    pub speed: f64,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct RenderedFile {
    pub format: String,
    pub path: String,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RenderedChapter {
    pub files: Vec<RenderedFile>,
    pub duration_sec: f64,
}

#[derive(Debug, PartialEq)]
struct Batch {
    text: String,
    pause_after_ms: u32,
}

/// Groups chunks into engine calls. A heading or scene-break pause always ends a batch; a paragraph pause ends one
/// once it is big enough to be worth a process start; no batch grows past `MAX_BATCH_CHARS`.
fn plan_batches(chunks: &[Chunk]) -> Vec<Batch> {
    let mut out = Vec::new();
    let (mut text, mut pause) = (String::new(), 0);
    for c in chunks {
        let t = c.text.replace(['\n', '\r'], " ").trim().to_string();
        if t.is_empty() {
            continue;
        }
        if !text.is_empty() && text.len() + 1 + t.len() > MAX_BATCH_CHARS {
            out.push(Batch { text: std::mem::take(&mut text), pause_after_ms: pause });
        }
        if !text.is_empty() {
            text.push(' ');
        }
        text.push_str(&t);
        pause = c.pause_after_ms;
        if pause >= HARD_PAUSE_MS || (pause >= PARAGRAPH_MS && text.len() >= MIN_BATCH_CHARS) {
            out.push(Batch { text: std::mem::take(&mut text), pause_after_ms: pause });
        }
    }
    if !text.is_empty() {
        out.push(Batch { text, pause_after_ms: pause });
    }
    // The engine reads a leading "-" as one of its own options.
    for b in &mut out {
        b.text = b.text.trim_start_matches('-').trim_start().to_string();
    }
    out.retain(|b| !b.text.is_empty());
    out
}

fn engine_args(v: &VoiceDef, root: &Path, speed: f64, threads: usize, out: &Path, text: &str) -> Vec<String> {
    let dir = root.join(v.dir);
    let p = |x: PathBuf| x.to_string_lossy().into_owned();
    let scale = format!("{:.4}", 1.0 / speed);
    let mut a = match v.engine {
        Engine::Kokoro => vec![
            format!("--kokoro-model={}", p(dir.join(v.model))),
            format!("--kokoro-voices={}", p(dir.join("voices.bin"))),
            format!("--kokoro-tokens={}", p(dir.join("tokens.txt"))),
            format!("--kokoro-lexicon={}", p(root.join(v.lexicon))),
            format!("--kokoro-length-scale={scale}"),
        ],
        Engine::Piper => vec![
            format!("--vits-model={}", p(dir.join(v.model))),
            format!("--vits-tokens={}", p(dir.join("tokens.txt"))),
            format!("--vits-lexicon={}", p(root.join(v.lexicon))),
            format!("--vits-length-scale={scale}"),
        ],
    };
    if let Some(s) = v.speaker {
        a.push(format!("--sid={s}"));
    }
    a.extend([format!("--num-threads={threads}"), "--tts-max-num-sentences=2".into(), format!("--output-filename={}", p(out.to_path_buf())), text.to_string()]);
    a
}

fn silence(rate: u32, ms: u32) -> usize {
    (rate as u64 * ms as u64 / 1000) as usize
}

/// Formats this build can write. There is no MP3 on purpose (see docs/architecture.md, "Audio encoders").
const WRITABLE: &[&str] = &["wav", "flac", "opus"];

fn check_request(req: &ChapterRequest) -> Result<(), AudioError> {
    if req.chunks.iter().all(|c| c.text.trim().is_empty()) {
        return Err(other("there is nothing to read aloud in this chapter"));
    }
    if !(0.5..=2.0).contains(&req.speed) {
        return Err(other("speed must be between 0.5 and 2"));
    }
    if req.formats.is_empty() {
        return Err(other("choose at least one audio format"));
    }
    for f in &req.formats {
        if !WRITABLE.contains(&f.as_str()) {
            return Err(other(format!("unknown audio format {f:?}; choose WAV, FLAC or Opus")));
        }
    }
    if !req.base.starts_with("exports/") || req.base.ends_with('/') {
        return Err(AudioError::from(ProjectError::UnsafePath { path: req.base.clone() }));
    }
    Ok(())
}

/// Runs the engine over the chunks and joins the batches with their pauses. Shared by a chapter render and a sample.
fn synthesize(chunks: &[Chunk], voice_id: &str, speed: f64, sherpa: &Path, voices: Option<&Path>, cancel: &AtomicBool, progress: &dyn Fn(f64)) -> Result<(Vec<i16>, u32), AudioError> {
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

/// Most characters a sample may read: a few sentences, never a chapter.
const SAMPLE_MAX_CHARS: usize = 1200;

/// A short WAV of the given text for "Hear a sample". Nothing touches the project: the engine writes to a temp dir
/// that is removed on every path and the bytes are returned.
pub fn render_sample(req: &SampleRequest, sherpa: &Path, voices: Option<&Path>, cancel: &AtomicBool) -> Result<Vec<u8>, AudioError> {
    if req.chunks.iter().all(|c| c.text.trim().is_empty()) {
        return Err(other("there is nothing to read aloud in this chapter"));
    }
    if !(0.5..=2.0).contains(&req.speed) {
        return Err(other("speed must be between 0.5 and 2"));
    }
    if req.chunks.iter().map(|c| c.text.len()).sum::<usize>() > SAMPLE_MAX_CHARS {
        return Err(other("a sample is limited to a few sentences"));
    }
    let (samples, rate) = synthesize(&req.chunks, &req.voice, req.speed, sherpa, voices, cancel, &|_| {})?;
    Ok(write_wav(rate, &samples))
}

/// Renders one chapter. `progress` receives 0..1 after every batch. Everything is validated before the engine runs,
/// and nothing is written unless the whole chapter rendered.
pub fn render_chapter(req: &ChapterRequest, sherpa: &Path, voices: Option<&Path>, cancel: &AtomicBool, progress: &dyn Fn(f64)) -> Result<RenderedChapter, AudioError> {
    check_request(req)?;
    let root = project::require_project(&PathBuf::from(&req.root))?;
    for f in &req.formats {
        project::resolve(&root, &format!("{}.{f}", req.base))?;
    }
    let (samples, rate) = synthesize(&req.chunks, &req.voice, req.speed, sherpa, voices, cancel, progress)?;
    if cancel.load(Ordering::Relaxed) {
        return Err(AudioError::Cancelled);
    }
    let mut files = Vec::new();
    for f in &req.formats {
        if cancel.load(Ordering::Relaxed) {
            return Err(AudioError::Cancelled);
        }
        let encoded = match f.as_str() {
            "wav" => Ok(write_wav(rate, &samples)),
            "flac" => audio_encode::encode_flac(rate, &samples),
            _ => audio_encode::encode_opus(rate, &samples),
        };
        let bytes = encoded.map_err(|message| AudioError::Encode { format: f.clone(), message })?;
        let path = format!("{}.{f}", req.base);
        project::write_bytes(&root, &path, &bytes)?;
        files.push(RenderedFile { format: f.clone(), path });
    }
    Ok(RenderedChapter { files, duration_sec: samples.len() as f64 / rate as f64 })
}

// ---- jobs and Tauri commands ---------------------------------------------------------------------------------

/// Cancel flags by job id. A flag is created by whichever of render or cancel comes first, so a Cancel that arrives
/// between two chapters still stops the next one.
#[derive(Default)]
pub struct AudioJobs(Mutex<HashMap<String, Arc<AtomicBool>>>);

impl AudioJobs {
    pub(crate) fn flag(&self, id: &str) -> Arc<AtomicBool> {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).entry(id.to_string()).or_default().clone()
    }

    pub fn cancel(&self, id: &str) {
        self.flag(id).store(true, Ordering::Relaxed);
    }

    pub fn forget(&self, id: &str) {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).remove(id);
    }
}

#[tauri::command]
pub async fn audio_voices() -> Result<Vec<VoiceInfo>, AudioError> {
    crate::typst::blocking(|| Ok(list_voices(voices_root().as_deref()))).await
}

/// Renders one chapter off the UI thread and reports 0..1 progress on `on_progress`.
#[tauri::command]
pub async fn audio_render_chapter(state: tauri::State<'_, AudioJobs>, request: ChapterRequest, on_progress: tauri::ipc::Channel<f64>) -> Result<RenderedChapter, AudioError> {
    let flag = state.flag(&request.job_id);
    crate::typst::blocking(move || {
        let sherpa = find_sherpa()?;
        render_chapter(&request, &sherpa, voices_root().as_deref(), &flag, &|f| {
            let _ = on_progress.send(f);
        })
    })
    .await
}

/// Renders a short sample off the UI thread and returns the WAV bytes (a raw IPC response, not JSON).
#[tauri::command]
pub async fn audio_sample(state: tauri::State<'_, AudioJobs>, request: SampleRequest) -> Result<tauri::ipc::Response, AudioError> {
    let flag = state.flag(&request.job_id);
    crate::typst::blocking(move || {
        let sherpa = find_sherpa()?;
        render_sample(&request, &sherpa, voices_root().as_deref(), &flag).map(tauri::ipc::Response::new)
    })
    .await
}

#[tauri::command]
pub fn audio_cancel(state: tauri::State<'_, AudioJobs>, job_id: String) {
    state.cancel(&job_id);
}

/// Drops a finished job's flag. The TypeScript side calls it when an export ends, whatever the outcome.
#[tauri::command]
pub fn audio_forget(state: tauri::State<'_, AudioJobs>, job_id: String) {
    state.forget(&job_id);
}

/// Which of these project-relative paths are existing regular files. Used to trust a cached chapter only while its
/// audio files are still on disk. A path outside the project is refused like everywhere else.
pub(crate) fn files_exist(root: &std::path::Path, paths: &[String]) -> Result<Vec<bool>, AudioError> {
    paths
        .iter()
        .map(|rel| Ok(crate::project::resolve(root, rel)?.symlink_metadata().map(|m| m.is_file()).unwrap_or(false)))
        .collect()
}

#[tauri::command]
pub async fn audio_files_exist(root: String, paths: Vec<String>) -> Result<Vec<bool>, AudioError> {
    crate::typst::blocking(move || files_exist(std::path::Path::new(&root), &paths)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn files_exist_reports_files_only_and_refuses_outside_paths() {
        let dir = std::env::temp_dir().join(format!("cc-exist-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("a.opus"), b"x").unwrap();
        let got = files_exist(&dir, &["a.opus".into(), "missing.opus".into(), "sub".into()]).unwrap();
        assert_eq!(got, vec![true, false, false]);
        assert!(files_exist(&dir, &["../a.opus".into()]).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    fn chunk(text: &str, pause: u32) -> Chunk {
        Chunk { text: text.into(), pause_after_ms: pause }
    }

    #[test]
    fn wav_round_trips_and_refuses_other_formats() {
        let samples: Vec<i16> = (0..100).map(|i| (i * 300 - 15000) as i16).collect();
        let pcm = parse_wav(&write_wav(24000, &samples)).unwrap();
        assert_eq!((pcm.rate, pcm.samples), (24000, samples));
        assert!(matches!(parse_wav(b"not a wav file at all"), Err(AudioError::Synth { .. })));
        let mut stereo = write_wav(24000, &[1, 2]);
        stereo[22] = 2;
        assert!(parse_wav(&stereo).is_err());
        let mut streamed = write_wav(24000, &[5, 6, 7]);
        streamed[40..44].copy_from_slice(&u32::MAX.to_le_bytes());
        assert_eq!(parse_wav(&streamed).unwrap().samples, vec![5, 6, 7]);
    }

    #[test]
    fn batches_honour_hard_pauses_and_size_limits() {
        let long = "x".repeat(1300);
        let b = plan_batches(&[chunk("Title", 1000), chunk("short.", 600), chunk(&long, 600), chunk("tail", 600)]);
        assert_eq!(b.iter().map(|b| b.pause_after_ms).collect::<Vec<_>>(), vec![1000, 600, 600]);
        assert_eq!(b[0].text, "Title");
        assert!(b[1].text.starts_with("short. xxx"));
        let many: Vec<Chunk> = (0..40).map(|_| chunk(&"y".repeat(200), 250)).collect();
        assert!(plan_batches(&many).iter().all(|b| b.text.len() <= MAX_BATCH_CHARS));
        assert_eq!(plan_batches(&[chunk("--flag looking", 600), chunk("  ", 600)])[0].text, "flag looking");
    }

    #[test]
    fn engine_args_pass_speed_speaker_and_text_as_separate_arguments() {
        let v = VOICES.iter().find(|v| v.id == "kokoro-heart").unwrap();
        let a = engine_args(v, Path::new("/v"), 1.25, 3, Path::new("/o.wav"), "Hello; rm -rf /");
        assert!(a.contains(&"--kokoro-length-scale=0.8000".to_string()) && a.contains(&"--sid=3".to_string()));
        assert_eq!(a.last().unwrap(), "Hello; rm -rf /");
        let p = engine_args(VOICES.iter().find(|v| v.id == "piper-amy").unwrap(), Path::new("/v"), 1.0, 1, Path::new("/o.wav"), "x");
        assert!(p.iter().all(|s| !s.starts_with("--sid")) && p.contains(&"--vits-lexicon=/v/lexicon-en-us.txt".to_string()));
    }

    #[test]
    fn voices_are_installed_only_when_all_files_exist() {
        let dir = tempfile::tempdir().unwrap();
        assert!(list_voices(Some(dir.path())).iter().all(|v| !v.installed));
        assert!(list_voices(None).iter().all(|v| !v.installed));
        let amy = VOICES.iter().find(|v| v.id == "piper-amy").unwrap();
        for f in amy.files(dir.path()) {
            fs::create_dir_all(f.parent().unwrap()).unwrap();
            fs::write(f, b"x").unwrap();
        }
        let installed: Vec<_> = list_voices(Some(dir.path())).into_iter().filter(|v| v.installed).map(|v| v.id).collect();
        assert_eq!(installed, vec!["piper-amy"]);
    }

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

    #[test]
    fn jobs_cancel_before_or_after_a_render_starts() {
        let jobs = AudioJobs::default();
        jobs.cancel("a");
        assert!(jobs.flag("a").load(Ordering::Relaxed));
        let b = jobs.flag("b");
        assert!(!b.load(Ordering::Relaxed));
        jobs.cancel("b");
        assert!(b.load(Ordering::Relaxed));
        jobs.forget("a");
        assert!(!jobs.flag("a").load(Ordering::Relaxed));
    }

    #[cfg(unix)]
    mod process {
        use super::*;
        use std::os::unix::fs::PermissionsExt;

        /// A stand-in engine: copies `fixture` to the `--output-filename=` argument, or runs `body`.
        fn script(dir: &Path, body: &str) -> PathBuf {
            let p = dir.join("fake-engine");
            fs::write(&p, format!("#!/bin/sh\nfor a in \"$@\"; do case \"$a\" in --output-filename=*) out=\"${{a#--output-filename=}}\";; esac; done\n{body}\n")).unwrap();
            fs::set_permissions(&p, fs::Permissions::from_mode(0o755)).unwrap();
            p
        }

        struct Fixture {
            _dir: tempfile::TempDir,
            project: PathBuf,
            voices: PathBuf,
            engine: PathBuf,
        }

        fn fixture(body: impl Fn(&Path) -> String) -> Fixture {
            let dir = tempfile::tempdir().unwrap();
            let (project, voices) = (dir.path().join("book"), dir.path().join("voices"));
            fs::create_dir_all(&project).unwrap();
            fs::write(project.join("cadabra.json"), "{}").unwrap();
            let amy = VOICES.iter().find(|v| v.id == "piper-amy").unwrap();
            for f in amy.files(&voices) {
                fs::create_dir_all(f.parent().unwrap()).unwrap();
                fs::write(f, b"x").unwrap();
            }
            let wav = dir.path().join("fixture.wav");
            fs::write(&wav, write_wav(24000, &vec![1000i16; 2400])).unwrap(); // 0.1 s
            let engine = script(dir.path(), &body(&wav));
            Fixture { _dir: dir, project, voices, engine }
        }

        fn request(f: &Fixture, chunks: Vec<Chunk>) -> ChapterRequest {
            ChapterRequest { job_id: "j".into(), root: f.project.to_string_lossy().into_owned(), base: "exports/audio/01-one".into(), chunks, voice: "piper-amy".into(), speed: 1.0, formats: vec!["wav".into()] }
        }

        fn copy(wav: &Path) -> String {
            format!("cp '{}' \"$out\"", wav.display())
        }

        #[test]
        fn renders_batches_joins_them_with_pauses_and_writes_under_exports() {
            let f = fixture(copy);
            let seen = Mutex::new(Vec::new());
            let r = render_chapter(&request(&f, vec![chunk("Title", 1000), chunk("Body one.", 600), chunk("Body two.", 600)]), &f.engine, Some(&f.voices), &AtomicBool::new(false), &|p| seen.lock().unwrap().push(p)).unwrap();
            // two batches of 0.1 s plus a 1.0 s pause after the first and 0.6 s after the second
            assert!((r.duration_sec - 1.8).abs() < 0.001, "{}", r.duration_sec);
            assert_eq!(r.files, vec![RenderedFile { format: "wav".into(), path: "exports/audio/01-one.wav".into() }]);
            let pcm = parse_wav(&fs::read(f.project.join("exports/audio/01-one.wav")).unwrap()).unwrap();
            assert_eq!(pcm.samples.len(), (1.8 * 24000.0) as usize);
            let seen = seen.into_inner().unwrap();
            assert!(seen.windows(2).all(|w| w[0] <= w[1]) && (seen.last().unwrap() - 1.0).abs() < 1e-9);
        }

        #[test]
        fn a_sample_returns_wav_bytes_writes_nothing_and_cleans_up() {
            let f = fixture(copy);
            let req = SampleRequest { job_id: "s".into(), chunks: vec![chunk("Hello there.", 600)], voice: "piper-amy".into(), speed: 1.0 };
            let bytes = render_sample(&req, &f.engine, Some(&f.voices), &AtomicBool::new(false)).unwrap();
            assert_eq!(parse_wav(&bytes).unwrap().samples.len(), (0.7 * 24000.0) as usize);
            assert!(!f.project.join("exports").exists(), "a sample must not write into the project");
        }

        #[test]
        fn a_sample_refuses_long_text_bad_speed_and_a_missing_voice() {
            let f = fixture(copy);
            let mk = |text: String, speed: f64, voice: &str| SampleRequest { job_id: "s".into(), chunks: vec![chunk(&text, 0)], voice: voice.into(), speed };
            let off = AtomicBool::new(false);
            assert!(render_sample(&mk("a".repeat(SAMPLE_MAX_CHARS + 1), 1.0, "piper-amy"), &f.engine, Some(&f.voices), &off).is_err());
            assert!(render_sample(&mk("Hi.".into(), 3.0, "piper-amy"), &f.engine, Some(&f.voices), &off).is_err());
            assert!(matches!(render_sample(&mk("Hi.".into(), 1.0, "kokoro-heart"), &f.engine, Some(&f.voices), &off), Err(AudioError::VoiceMissing { .. })));
        }

        #[test]
        fn writes_every_requested_format_next_to_each_other() {
            let f = fixture(copy);
            let mut r = request(&f, vec![chunk("Hello there.", 600)]);
            r.formats = vec!["opus".into(), "flac".into(), "wav".into()];
            let done = render_chapter(&r, &f.engine, Some(&f.voices), &AtomicBool::new(false), &|_| {}).unwrap();
            assert_eq!(done.files.iter().map(|x| (x.format.as_str(), x.path.as_str())).collect::<Vec<_>>(), vec![("opus", "exports/audio/01-one.opus"), ("flac", "exports/audio/01-one.flac"), ("wav", "exports/audio/01-one.wav")]);
            let read = |n: &str| fs::read(f.project.join(format!("exports/audio/01-one.{n}"))).unwrap();
            assert_eq!(&read("opus")[..4], b"OggS");
            assert_eq!(&read("flac")[..4], b"fLaC");
            assert_eq!(&read("wav")[..4], b"RIFF");
        }

        #[test]
        fn cancel_kills_the_engine_promptly_and_writes_nothing() {
            let f = fixture(|_| "sleep 30".into());
            let cancel = Arc::new(AtomicBool::new(false));
            let c = cancel.clone();
            let t = std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(200));
                c.store(true, Ordering::Relaxed);
            });
            let started = Instant::now();
            let r = render_chapter(&request(&f, vec![chunk("Hello there.", 600)]), &f.engine, Some(&f.voices), &cancel, &|_| {});
            t.join().unwrap();
            assert_eq!(r, Err(AudioError::Cancelled));
            assert!(started.elapsed() < Duration::from_secs(5));
            assert!(!f.project.join("exports").exists());
        }

        #[test]
        fn a_cancel_that_arrived_earlier_stops_before_the_engine_starts() {
            let f = fixture(copy);
            let r = render_chapter(&request(&f, vec![chunk("Hello.", 600)]), &f.engine, Some(&f.voices), &AtomicBool::new(true), &|_| {});
            assert_eq!(r, Err(AudioError::Cancelled));
        }

        #[test]
        fn run_cancellable_times_out_and_leaves_no_process() {
            let dir = tempfile::tempdir().unwrap();
            let e = script(dir.path(), "sleep 30");
            let r = run_cancellable(&e, &[], Duration::from_millis(150), &AtomicBool::new(false));
            assert!(matches!(r, Err(AudioError::Timeout { .. })));
        }

        #[test]
        fn engine_failure_reports_its_message_and_writes_nothing() {
            let f = fixture(|_| "echo 'model file is corrupt' >&2; exit 3".into());
            let r = render_chapter(&request(&f, vec![chunk("Hello.", 600)]), &f.engine, Some(&f.voices), &AtomicBool::new(false), &|_| {});
            assert!(matches!(&r, Err(AudioError::Synth { message }) if message.contains("model file is corrupt")), "{r:?}");
            assert!(!f.project.join("exports").exists());
        }

        #[test]
        fn a_missing_output_file_or_garbage_wav_is_a_synth_error() {
            let f = fixture(|_| "true".into());
            assert!(matches!(render_chapter(&request(&f, vec![chunk("Hello.", 600)]), &f.engine, Some(&f.voices), &AtomicBool::new(false), &|_| {}), Err(AudioError::Synth { .. })));
            let g = fixture(|_| "echo garbage > \"$out\"".into());
            assert!(matches!(render_chapter(&request(&g, vec![chunk("Hello.", 600)]), &g.engine, Some(&g.voices), &AtomicBool::new(false), &|_| {}), Err(AudioError::Synth { .. })));
        }

        #[test]
        fn bad_requests_are_refused_before_the_engine_runs() {
            let f = fixture(|_| "touch \"$(dirname \"$0\")/ran\"".into());
            let run = |mutate: &dyn Fn(&mut ChapterRequest)| {
                let mut r = request(&f, vec![chunk("Hello.", 600)]);
                mutate(&mut r);
                render_chapter(&r, &f.engine, Some(&f.voices), &AtomicBool::new(false), &|_| {})
            };
            assert!(matches!(run(&|r| r.voice = "kokoro-heart".into()), Err(AudioError::VoiceMissing { .. })));
            assert!(matches!(run(&|r| r.voice = "nope".into()), Err(AudioError::VoiceMissing { .. })));
            assert!(matches!(run(&|r| r.formats = vec!["mp3".into()]), Err(AudioError::Other { .. })));
            assert!(matches!(run(&|r| r.formats = vec!["ogg".into()]), Err(AudioError::Other { .. })));
            assert!(matches!(run(&|r| r.formats = vec![]), Err(AudioError::Other { .. })));
            assert!(matches!(run(&|r| r.speed = 3.0), Err(AudioError::Other { .. })));
            assert!(matches!(run(&|r| r.chunks = vec![chunk("  ", 0)]), Err(AudioError::Other { .. })));
            for base in ["manifest", "exports/../cadabra", "/etc/x", "exports/"] {
                assert!(matches!(run(&|r| r.base = base.into()), Err(AudioError::Other { .. })), "{base}");
            }
            assert!(matches!(run(&|r| r.root = "relative/book".into()), Err(AudioError::Other { .. })));
            assert!(!f.engine.parent().unwrap().join("ran").exists());
            assert!(matches!(render_chapter(&request(&f, vec![chunk("Hello.", 600)]), &f.engine, None, &AtomicBool::new(false), &|_| {}), Err(AudioError::VoiceMissing { .. })));
        }
    }

    /// The real engine and voices, or None (test skipped) unless `REQUIRE_SHERPA=1`. Set `SHERPA_TTS_BIN` and
    /// `CADABRA_VOICES_DIR` (a folder holding the extracted sherpa model archives and `lexicon-en-us.txt`).
    fn real_engine() -> Option<(PathBuf, PathBuf)> {
        let found = find_sherpa().ok().zip(voices_root());
        if found.is_none() {
            assert!(std::env::var("REQUIRE_SHERPA").as_deref() != Ok("1"), "REQUIRE_SHERPA=1 but the engine or voices were not found");
            eprintln!("skipping: voice engine not installed");
        }
        found
    }

    #[test]
    fn real_engine_renders_a_short_chapter_with_a_piper_voice() {
        let Some((bin, voices)) = real_engine() else { return };
        if !list_voices(Some(&voices)).iter().any(|v| v.id == "piper-amy" && v.installed) {
            eprintln!("skipping: piper-amy is not installed");
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("cadabra.json"), "{}").unwrap();
        let req = ChapterRequest { job_id: "real".into(), root: dir.path().to_string_lossy().into_owned(), base: "exports/audio/01-real".into(), chunks: vec![chunk("The quay was empty. A gull cried once.", 600)], voice: "piper-amy".into(), speed: 1.0, formats: vec!["wav".into()] };
        let r = render_chapter(&req, &bin, Some(&voices), &AtomicBool::new(false), &|_| {}).unwrap();
        assert!(r.duration_sec > 1.0 && r.duration_sec < 30.0, "{}", r.duration_sec);
        assert!(dir.path().join("exports/audio/01-real.wav").is_file());
    }
}
