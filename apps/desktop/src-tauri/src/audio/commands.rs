//! The Tauri command layer for the audiobook export and the voice packs. Work runs on Tauri's blocking pool.
use super::download::{build_client, download_pack, DownloadProgress};
use super::engine::{find_ffmpeg, find_sherpa};
use super::error::{other, AudioError};
use super::jobs::{voices_root, AudioJobs};
use super::m4b::{build_m4b, BuiltM4b, M4bRequest};
use super::packs::{delete_pack, find_pack, list_packs, Pack, PackInfo};
use super::render::{render_chapter, render_sample, write_transcript, ChapterRequest, RenderedChapter, SampleRequest};
use super::voices::{list_voices, VoiceInfo};
use std::path::PathBuf;

/// Locates an external program (a box, so tests can point at a fake one without a second copy of each body).
type Finder = Box<dyn FnOnce() -> Result<PathBuf, AudioError> + Send + 'static>;

#[tauri::command]
pub async fn audio_voices() -> Result<Vec<VoiceInfo>, AudioError> {
    crate::platform::blocking(|| Ok(list_voices(voices_root().as_deref()))).await
}

/// The body of `audio_render_chapter`. `find` locates the engine; `on_progress` gets 0..1 after every batch.
async fn render_chapter_job(
    jobs: &AudioJobs,
    request: ChapterRequest,
    on_progress: tauri::ipc::Channel<f64>,
    find: Finder,
    voices: Option<PathBuf>,
) -> Result<RenderedChapter, AudioError> {
    let flag = jobs.flag(&request.job_id);
    crate::platform::blocking(move || {
        let sherpa = find()?;
        render_chapter(&request, &sherpa, voices.as_deref(), &flag, &|f| {
            let _ = on_progress.send(f);
        })
    })
    .await
}

/// Renders one chapter off the UI thread and reports 0..1 progress on `on_progress`.
#[tauri::command]
pub async fn audio_render_chapter(
    state: tauri::State<'_, AudioJobs>,
    request: ChapterRequest,
    on_progress: tauri::ipc::Channel<f64>,
) -> Result<RenderedChapter, AudioError> {
    render_chapter_job(&state, request, on_progress, Box::new(find_sherpa), voices_root()).await
}

/// The body of `audio_sample`.
async fn sample_job(jobs: &AudioJobs, request: SampleRequest, find: Finder, voices: Option<PathBuf>) -> Result<tauri::ipc::Response, AudioError> {
    let flag = jobs.flag(&request.job_id);
    crate::platform::blocking(move || {
        let sherpa = find()?;
        render_sample(&request, &sherpa, voices.as_deref(), &flag).map(tauri::ipc::Response::new)
    })
    .await
}

/// Renders a short sample off the UI thread and returns the WAV bytes (a raw IPC response, not JSON).
#[tauri::command]
pub async fn audio_sample(state: tauri::State<'_, AudioJobs>, request: SampleRequest) -> Result<tauri::ipc::Response, AudioError> {
    sample_job(&state, request, Box::new(find_sherpa), voices_root()).await
}

/// The body of `audio_build_m4b`.
async fn build_m4b_job(jobs: &AudioJobs, request: M4bRequest, find: Finder) -> Result<BuiltM4b, AudioError> {
    let flag = jobs.flag(&request.job_id);
    crate::platform::blocking(move || {
        let ffmpeg = find()?;
        build_m4b(&request, &ffmpeg, &flag)
    })
    .await
}

/// Builds the whole-book M4B from the chapter parts off the UI thread. Stop it with `audio_cancel`.
#[tauri::command]
pub async fn audio_build_m4b(state: tauri::State<'_, AudioJobs>, request: M4bRequest) -> Result<BuiltM4b, AudioError> {
    build_m4b_job(&state, request, Box::new(find_ffmpeg)).await
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
    paths.iter().map(|rel| Ok(crate::project::resolve(root, rel)?.symlink_metadata().map(|m| m.is_file()).unwrap_or(false))).collect()
}

#[tauri::command]
pub async fn audio_files_exist(root: String, paths: Vec<String>) -> Result<Vec<bool>, AudioError> {
    crate::platform::blocking(move || files_exist(&crate::project::require_project(&PathBuf::from(root))?, &paths)).await
}

/// Saves a transcript (`.txt` or `.vtt` in an `audio` folder under `exports/`) next to the audiobook. Local file only.
#[tauri::command]
pub async fn audio_write_transcript(root: String, path: String, contents: String) -> Result<(), AudioError> {
    crate::platform::blocking(move || write_transcript(&crate::project::require_project(&PathBuf::from(root))?, &path, &contents)).await
}

fn require_root(root: Option<PathBuf>) -> Result<PathBuf, AudioError> {
    root.ok_or_else(|| other("there is no folder for voices on this computer"))
}

#[tauri::command]
pub async fn audio_packs() -> Result<Vec<PackInfo>, AudioError> {
    crate::platform::blocking(|| Ok(list_packs(voices_root().as_deref()))).await
}

/// The body of `audio_download_pack`. `pack` is the catalog lookup and `client` builds the HTTP client, so tests can use a
/// stand-in pack and a client that talks to a loopback server.
async fn download_pack_job(
    jobs: &AudioJobs,
    pack: Result<&Pack, AudioError>,
    job_id: String,
    on_progress: tauri::ipc::Channel<DownloadProgress>,
    voices: Option<PathBuf>,
    client: fn() -> Result<reqwest::Client, AudioError>,
) -> Result<(), AudioError> {
    let pack = pack?;
    let root = require_root(voices)?;
    let _running = jobs.begin_download(pack.id).ok_or_else(|| other("this voice pack is already downloading"))?;
    let flag = jobs.flag(&job_id);
    let client = client()?;
    download_pack(&client, pack, &root, &flag, &|p| {
        let _ = on_progress.send(p);
    })
    .await
}

/// Downloads a voice pack. `on_progress` gets the bytes of the whole pack. Stop it with `audio_cancel(job_id)`; a stopped
/// or failed download resumes on the next call.
#[tauri::command]
pub async fn audio_download_pack(
    state: tauri::State<'_, AudioJobs>,
    pack: String,
    job_id: String,
    on_progress: tauri::ipc::Channel<DownloadProgress>,
) -> Result<(), AudioError> {
    download_pack_job(&state, find_pack(&pack), job_id, on_progress, voices_root(), build_client).await
}

/// The body of `audio_delete_pack`.
async fn delete_pack_job(pack: Result<&'static Pack, AudioError>, voices: Option<PathBuf>) -> Result<(), AudioError> {
    let pack = pack?;
    let root = require_root(voices)?;
    crate::platform::blocking(move || delete_pack(pack, &root)).await
}

#[tauri::command]
pub async fn audio_delete_pack(pack: String) -> Result<(), AudioError> {
    delete_pack_job(find_pack(&pack), voices_root()).await
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::download::{client, stub};
    #[cfg(unix)]
    use crate::audio::wav::{parse_wav, write_wav};
    #[cfg(unix)]
    use crate::commands::testutil::raw;
    use crate::commands::testutil::{run, text};
    use std::sync::{Arc, Mutex};
    use tauri::ipc::Channel;

    #[test]
    fn files_exist_reports_files_only_and_refuses_outside_paths() {
        let dir = std::env::temp_dir().join(format!("cc-exist-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("a.opus"), b"x").unwrap();
        let got = files_exist(&dir, &["a.opus".into(), "missing.opus".into(), "sub".into()]).unwrap();
        assert_eq!(got, vec![true, false, false]);
        assert!(files_exist(&dir, &["../a.opus".into()]).is_err());
        let root = dir.to_string_lossy().into_owned();
        // The command only answers for a real project (a folder with cadabra.json).
        assert!(run(audio_files_exist(root.clone(), vec!["a.opus".into()])).is_err());
        std::fs::write(dir.join("cadabra.json"), "{}").unwrap();
        assert_eq!(run(audio_files_exist(root.clone(), vec!["a.opus".into(), "nope".into()])).unwrap(), vec![true, false]);
        assert!(run(audio_files_exist(root, vec!["/etc/hosts".into()])).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn the_transcript_command_writes_text_in_a_project_only() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_string_lossy().into_owned();
        let write = |path: &str| run(audio_write_transcript(root.clone(), path.into(), "Hello.\n".into()));
        assert!(write("exports/audio/t.txt").is_err(), "not a project yet");
        std::fs::write(dir.path().join("cadabra.json"), "{}").unwrap();
        write("exports/audio/t.txt").unwrap();
        assert_eq!(std::fs::read_to_string(dir.path().join("exports/audio/t.txt")).unwrap(), "Hello.\n");
        assert!(write("exports/audio/t.json").is_err());
    }

    #[test]
    fn the_voice_and_pack_lists_come_from_the_catalog() {
        assert_eq!(run(audio_voices()).unwrap().iter().map(|v| v.id).collect::<Vec<_>>(), vec!["kokoro-heart", "piper-amy", "piper-libritts-0"]);
        assert_eq!(run(audio_packs()).unwrap().iter().map(|p| p.id).collect::<Vec<_>>(), vec!["piper", "kokoro"]);
    }

    #[test]
    fn without_a_voices_folder_or_with_an_unknown_pack_a_pack_job_is_refused() {
        assert!(matches!(require_root(None), Err(AudioError::Other { message }) if message.contains("no folder for voices")));
        assert_eq!(require_root(Some(PathBuf::from("/v"))).unwrap(), PathBuf::from("/v"));
        assert!(matches!(run(audio_delete_pack("nope".into())), Err(AudioError::Other { message }) if message.contains("unknown voice pack")));
        assert!(run(delete_pack_job(find_pack("piper"), None)).is_err());
    }

    fn stub_client() -> Result<reqwest::Client, AudioError> {
        client(false)
    }

    /// Progress messages of a channel, as JSON text.
    fn collect<T>() -> (Channel<T>, Arc<Mutex<Vec<String>>>) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let log = seen.clone();
        let channel = Channel::new(move |body| {
            log.lock().unwrap().push(text(body));
            Ok(())
        });
        (channel, seen)
    }

    #[test]
    fn a_pack_job_downloads_through_the_client_it_is_given_and_reports_progress() {
        let data = stub::body(5_000);
        let server = stub::serve(data.clone(), stub::Mode::Normal);
        let pack = stub::stub_pack("stub", &[], &server.url, &data, &["one.bin"]);
        let (jobs, voices) = (AudioJobs::default(), tempfile::tempdir().unwrap());
        let (progress, seen) = collect::<DownloadProgress>();
        run(download_pack_job(&jobs, Ok(pack), "dl".into(), progress, Some(voices.path().to_path_buf()), stub_client)).unwrap();
        assert!(pack.installed(voices.path()));
        assert_eq!(seen.lock().unwrap().last().map(String::as_str), Some(r#"{"done":5000,"total":5000}"#));
        // the cancel flag of that job id stops the next run, which resumes later
        jobs.cancel("again");
        let other = tempfile::tempdir().unwrap();
        let (progress, _) = collect::<DownloadProgress>();
        let r = run(download_pack_job(&jobs, Ok(pack), "again".into(), progress, Some(other.path().to_path_buf()), stub_client));
        assert_eq!(r, Err(AudioError::Cancelled));
        // and the job refuses before downloading when the pack is unknown, there is no folder or the client cannot be built
        let (progress, _) = collect::<DownloadProgress>();
        assert!(run(download_pack_job(&jobs, find_pack("nope"), "x".into(), progress, Some(other.path().to_path_buf()), stub_client)).is_err());
        let (progress, _) = collect::<DownloadProgress>();
        assert!(run(download_pack_job(&jobs, Ok(pack), "x".into(), progress, None, stub_client)).is_err());
        let (progress, _) = collect::<DownloadProgress>();
        let r = run(download_pack_job(&jobs, Ok(pack), "x".into(), progress, Some(other.path().to_path_buf()), || Err(AudioError::DiskFull)));
        assert_eq!(r, Err(AudioError::DiskFull));
    }

    #[test]
    fn a_second_download_of_a_pack_that_is_running_is_refused_and_the_mark_is_released() {
        let data = stub::body(100);
        let pack = stub::stub_pack("stub-busy", &[], "http://127.0.0.1:1/x", &data, &["one.bin"]);
        let (jobs, voices) = (AudioJobs::default(), tempfile::tempdir().unwrap());
        let running = jobs.begin_download("stub-busy").unwrap();
        let (progress, _) = collect::<DownloadProgress>();
        let r = run(download_pack_job(&jobs, Ok(pack), "x".into(), progress, Some(voices.path().to_path_buf()), stub_client));
        assert!(matches!(r, Err(AudioError::Other { message }) if message.contains("already downloading")));
        drop(running);
        // a failed run (the server is not there) must not leave the pack marked as running
        let (progress, _) = collect::<DownloadProgress>();
        assert!(run(download_pack_job(&jobs, Ok(pack), "x".into(), progress, Some(voices.path().to_path_buf()), stub_client)).is_err());
        assert!(jobs.begin_download("stub-busy").is_some());
    }

    #[test]
    fn a_pack_job_deletes_what_it_installed() {
        let data = stub::body(100);
        let pack = stub::stub_pack("stub", &[], "http://127.0.0.1:1/x", &data, &["one.bin"]);
        let voices = tempfile::tempdir().unwrap();
        std::fs::write(voices.path().join(pack.files[0].rel), &data).unwrap();
        run(delete_pack_job(Ok(pack), Some(voices.path().to_path_buf()))).unwrap();
        assert!(!voices.path().join(pack.files[0].rel).exists());
    }

    #[cfg(unix)]
    mod process {
        use super::*;
        use std::os::unix::fs::PermissionsExt;

        struct Fixture {
            _dir: tempfile::TempDir,
            project: PathBuf,
            voices: PathBuf,
            engine: PathBuf,
        }

        /// A project, an installed piper-amy and a stand-in program that runs `body` (`$out` is the engine's output file
        /// and `$OUT` the last argument, for the encoder).
        fn fixture(body: &str) -> Fixture {
            let dir = tempfile::tempdir().unwrap();
            let (project, voices) = (dir.path().join("book"), dir.path().join("voices"));
            std::fs::create_dir_all(project.join(".cadabra/audio/parts")).unwrap();
            std::fs::write(project.join("cadabra.json"), "{}").unwrap();
            std::fs::write(project.join(".cadabra/audio/parts/a.flac"), b"fLaC").unwrap();
            for f in crate::audio::voices::VOICES.iter().find(|v| v.id == "piper-amy").unwrap().files(&voices) {
                std::fs::create_dir_all(f.parent().unwrap()).unwrap();
                std::fs::write(f, b"x").unwrap();
            }
            let wav = dir.path().join("fixture.wav");
            std::fs::write(&wav, write_wav(24000, &[1000i16; 2400]).unwrap()).unwrap();
            let engine = dir.path().join("fake-engine");
            let script = format!(
                "#!/bin/sh\nfor a in \"$@\"; do case \"$a\" in --output-filename=*) out=\"${{a#--output-filename=}}\";; esac; OUT=\"$a\"; done\n{}\n",
                body.replace("$WAV", &wav.to_string_lossy())
            );
            std::fs::write(&engine, script).unwrap();
            std::fs::set_permissions(&engine, std::fs::Permissions::from_mode(0o755)).unwrap();
            Fixture { _dir: dir, project, voices, engine }
        }

        fn found(f: &Fixture) -> Finder {
            let engine = f.engine.clone();
            Box::new(move || Ok(engine))
        }

        fn chapter_request(f: &Fixture) -> ChapterRequest {
            serde_json::from_value(serde_json::json!({ "jobId": "j", "root": f.project, "base": "exports/audio/01", "chunks": [{ "text": "Hello there.", "pauseAfterMs": 600 }], "voice": "piper-amy", "speed": 1.0, "formats": ["wav"] })).unwrap()
        }

        #[test]
        fn a_chapter_job_renders_through_the_engine_it_finds_and_reports_progress() {
            let f = fixture("cp \"$WAV\" \"$out\"");
            let (progress, seen) = collect::<f64>();
            let done = run(render_chapter_job(&AudioJobs::default(), chapter_request(&f), progress, found(&f), Some(f.voices.clone()))).unwrap();
            assert_eq!(done.files.iter().map(|x| x.path.as_str()).collect::<Vec<_>>(), vec!["exports/audio/01.wav"]);
            assert!(f.project.join("exports/audio/01.wav").is_file());
            assert_eq!(seen.lock().unwrap().last().map(String::as_str), Some("1.0"));
        }

        #[test]
        fn a_chapter_job_reports_a_missing_engine_and_honours_an_earlier_cancel() {
            let f = fixture("cp \"$WAV\" \"$out\"");
            let (progress, _) = collect::<f64>();
            let missing = || -> Finder { Box::new(|| Err(AudioError::NotFound { message: "no engine".into() })) };
            let r = run(render_chapter_job(&AudioJobs::default(), chapter_request(&f), progress, missing(), Some(f.voices.clone())));
            assert_eq!(r, Err(AudioError::NotFound { message: "no engine".into() }));
            let jobs = AudioJobs::default();
            jobs.cancel("j");
            let (progress, _) = collect::<f64>();
            assert_eq!(run(render_chapter_job(&jobs, chapter_request(&f), progress, found(&f), Some(f.voices.clone()))), Err(AudioError::Cancelled));
        }

        fn sample_request() -> SampleRequest {
            serde_json::from_value(serde_json::json!({ "jobId": "s", "chunks": [{ "text": "Hello.", "pauseAfterMs": 0 }], "voice": "piper-amy", "speed": 1.0 }))
                .unwrap()
        }

        #[test]
        fn a_sample_job_returns_wav_bytes() {
            let f = fixture("cp \"$WAV\" \"$out\"");
            let wav = raw(run(sample_job(&AudioJobs::default(), sample_request(), found(&f), Some(f.voices.clone()))).unwrap());
            assert_eq!(parse_wav(&wav).unwrap().samples.len(), 2400);
            let missing = || -> Finder { Box::new(|| Err(AudioError::NotFound { message: "no engine".into() })) };
            assert!(run(sample_job(&AudioJobs::default(), sample_request(), missing(), None)).is_err());
        }

        #[test]
        fn an_m4b_job_runs_the_encoder_it_finds() {
            let f = fixture("echo m4b > \"$OUT\"");
            let request = || -> M4bRequest {
                serde_json::from_value(serde_json::json!({ "jobId": "m", "root": f.project, "base": "exports/audio/book", "title": "Book", "author": "Me", "cover": null, "chapters": [{ "title": "One", "part": ".cadabra/audio/parts/a.flac", "durationSec": 1.0 }] })).unwrap()
            };
            let built = run(build_m4b_job(&AudioJobs::default(), request(), found(&f))).unwrap();
            assert_eq!(built.path, "exports/audio/book.m4b");
            assert!(f.project.join("exports/audio/book.m4b").is_file());
            let missing = || -> Finder { Box::new(|| Err(AudioError::NotFound { message: "no encoder".into() })) };
            assert!(matches!(run(build_m4b_job(&AudioJobs::default(), request(), missing())), Err(AudioError::NotFound { .. })));
        }
    }
}
