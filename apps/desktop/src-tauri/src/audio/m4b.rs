//! The M4B: one MP4 audiobook for the whole book, with a chapter list, the cover and tags. The audio is the lossless parts
//! the chapter renders left under `.cadabra/audio/parts/`; ffmpeg (an LGPL-only build, run as a separate program) joins
//! them and encodes AAC. Everything but the process is plain data: the chapter metadata and the file list are built here
//! and checked in tests; the process rules (no shell, timeout, cancel, temp dir removed) come from `platform::sidecar`.
use super::engine::run_ffmpeg;
use super::error::{other, AudioError};
use crate::project::{self, ProjectError};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::time::Duration;

/// Joining and encoding a long book takes a few minutes at most; anything longer is stuck.
const TIMEOUT: Duration = Duration::from_secs(60 * 60);
/// Mono speech: transparent enough for narration and about 29 MB per hour.
const AAC_BITRATE: &str = "64k";

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct M4bChapter {
    pub title: String,
    /// `.cadabra/audio/parts/<name>.flac`, as written by `render_chapter`.
    pub part: String,
    pub duration_sec: f64,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct M4bRequest {
    /// Stops the build with `audio_cancel`.
    pub job_id: String,
    pub root: String,
    /// Output path without extension, for example `exports/audio/my-book`.
    pub base: String,
    pub title: String,
    pub author: String,
    /// `assets/<name>.png|jpg|jpeg`; none means no cover.
    pub cover: Option<String>,
    pub chapters: Vec<M4bChapter>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BuiltM4b {
    pub path: String,
    pub duration_sec: f64,
}

/// A part name is a plain file name in the parts folder; the file list handed to ffmpeg then needs no escaping.
fn part_name(part: &str) -> Result<&str, AudioError> {
    let name = part.strip_prefix(project::AUDIO_PARTS_DIR).filter(|_| project::is_audio_part(part));
    name.filter(|n| n.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))).ok_or_else(|| AudioError::from(ProjectError::UnsafePath { path: part.to_string() }))
}

fn is_cover_ext(rel: &str) -> bool {
    let lower = rel.to_ascii_lowercase();
    [".png", ".jpg", ".jpeg"].iter().any(|e| lower.ends_with(e))
}

/// One value of an ffmetadata file: `=`, `;`, `#`, `\` and line breaks are escaped with a backslash.
fn meta_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '=' | ';' | '#' | '\\' => {
                out.push('\\');
                out.push(c);
            }
            '\n' | '\r' => out.push_str("\\\n"),
            c => out.push(c),
        }
    }
    out
}

/// The ffmetadata file: book tags, then one `[CHAPTER]` per chapter in milliseconds, back to back.
pub fn ffmetadata(title: &str, author: &str, chapters: &[M4bChapter]) -> String {
    let mut out = format!(";FFMETADATA1\ntitle={}\nartist={}\nalbum={}\ngenre=Audiobook\n", meta_escape(title), meta_escape(author), meta_escape(title));
    let mut start = 0u64;
    for c in chapters {
        let end = start + (c.duration_sec.max(0.0) * 1000.0).round() as u64;
        out.push_str(&format!("[CHAPTER]\nTIMEBASE=1/1000\nSTART={start}\nEND={end}\ntitle={}\n", meta_escape(&c.title)));
        start = end;
    }
    out
}

/// On Windows the separators become `/`, which ffmpeg accepts and which keeps backslashes out of the list file.
fn forward_slashes(path: &str, windows: bool) -> String {
    if windows {
        path.replace('\\', "/")
    } else {
        path.to_string()
    }
}

/// The concat demuxer's list: one `file` line per part, in order, with absolute paths (the demuxer resolves relative
/// ones against the list's own folder). A single quote in a path is written as `'\''`; on Windows the separators become
/// `/`, which ffmpeg accepts and which keeps backslashes out of the file.
pub fn concat_list(paths: &[PathBuf]) -> String {
    paths
        .iter()
        .map(|p| format!("file '{}'\n", forward_slashes(&p.to_string_lossy(), cfg!(windows)).replace('\'', "'\\''")))
        .collect()
}

/// ffmpeg's arguments (`-safe 0` because the part paths are absolute). Input 0 is the part list, input 1 the metadata and, with a cover, input 2 the picture (kept as an
/// attached picture, not re-encoded).
pub fn ffmpeg_args(list: &Path, meta: &Path, cover: Option<&Path>, out: &Path) -> Vec<String> {
    let s = |p: &Path| p.to_string_lossy().into_owned();
    let mut a: Vec<String> = ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i"].map(String::from).into();
    a.extend([s(list), "-i".into(), s(meta)]);
    if let Some(c) = cover {
        a.extend(["-i".into(), s(c)]);
    }
    a.extend(["-map", "0:a"].map(String::from));
    if cover.is_some() {
        a.extend(["-map", "2:v"].map(String::from));
    }
    a.extend(["-map_metadata", "1", "-map_chapters", "1", "-c:a", "aac", "-b:a", AAC_BITRATE].map(String::from));
    if cover.is_some() {
        a.extend(["-c:v", "copy", "-disposition:v:0", "attached_pic"].map(String::from));
    }
    a.extend(["-f", "ipod"].map(String::from));
    a.push(s(out));
    a
}

fn check(req: &M4bRequest) -> Result<(), AudioError> {
    if req.chapters.is_empty() {
        return Err(other("there are no chapters to put in the audiobook"));
    }
    if !req.base.starts_with("exports/") || req.base.ends_with('/') {
        return Err(AudioError::from(ProjectError::UnsafePath { path: req.base.clone() }));
    }
    if let Some(c) = &req.cover {
        if !c.starts_with("assets/") || !is_cover_ext(c) {
            return Err(AudioError::from(ProjectError::NotImageAsset { path: c.clone() }));
        }
    }
    req.chapters.iter().try_for_each(|c| part_name(&c.part).map(|_| ()))
}

/// Builds `<base>.m4b` from the parts. Nothing is written unless ffmpeg succeeded; the temp dir (list, metadata, output)
/// is removed on every path.
pub fn build_m4b(req: &M4bRequest, ffmpeg: &Path, cancel: &AtomicBool) -> Result<BuiltM4b, AudioError> {
    check(req)?;
    let root = project::require_project(&PathBuf::from(&req.root))?;
    let path = format!("{}.m4b", req.base);
    project::resolve(&root, &path)?;
    for c in &req.chapters {
        let part = project::resolve(&root, &c.part)?;
        if !part.symlink_metadata().is_ok_and(|m| m.is_file()) {
            return Err(other(format!("the audio for {:?} is missing; render the chapters again", c.title)));
        }
    }
    let cover = req.cover.as_deref().map(|c| project::resolve(&root, c)).transpose()?;
    if cover.as_ref().is_some_and(|c| !c.symlink_metadata().is_ok_and(|m| m.is_file())) {
        return Err(AudioError::from(ProjectError::NotImageAsset { path: req.cover.clone().unwrap_or_default() }));
    }
    let parts: Vec<PathBuf> = req.chapters.iter().map(|c| project::resolve(&root, &c.part)).collect::<Result<_, _>>()?;
    let scratch = tempfile::Builder::new().prefix("cadabracraft-m4b-").tempdir().map_err(other)?;
    let (list, meta, out) = (scratch.path().join("parts.txt"), scratch.path().join("book.ffmeta"), scratch.path().join("book.m4b"));
    fs::write(&list, concat_list(&parts)).map_err(other)?;
    fs::write(&meta, ffmetadata(&req.title, &req.author, &req.chapters)).map_err(other)?;
    let r = run_ffmpeg(ffmpeg, &ffmpeg_args(&list, &meta, cover.as_deref(), &out), scratch.path(), TIMEOUT, cancel)?;
    if !r.success || !out.is_file() {
        let msg = r.stderr.trim();
        let message = if msg.is_empty() { "the encoder exited with an error and no message".to_string() } else { msg.chars().rev().take(2000).collect::<Vec<_>>().into_iter().rev().collect() };
        return Err(AudioError::Encode { format: "m4b".into(), message });
    }
    let bytes = fs::read(&out).map_err(other)?;
    project::write_bytes(&root, &path, &bytes)?;
    Ok(BuiltM4b { path, duration_sec: req.chapters.iter().map(|c| c.duration_sec).sum() })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chapter(title: &str, part: &str, secs: f64) -> M4bChapter {
        M4bChapter { title: title.into(), part: format!(".cadabra/audio/parts/{part}"), duration_sec: secs }
    }

    #[test]
    fn metadata_lists_chapters_back_to_back_in_milliseconds_and_escapes_values() {
        let m = ffmetadata("A=B; #1", "Ann\\Lee", &[chapter("One", "a.flac", 1.5), chapter("Two\nlines", "b.flac", 0.0004), chapter("Three", "c.flac", 2.0)]);
        assert!(m.starts_with(";FFMETADATA1\ntitle=A\\=B\\; \\#1\nartist=Ann\\\\Lee\n"), "{m}");
        assert!(m.contains("[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1500\ntitle=One\n"));
        assert!(m.contains("START=1500\nEND=1500\ntitle=Two\\\nlines\n"));
        assert!(m.contains("START=1500\nEND=3500\ntitle=Three\n"));
    }

    #[test]
    fn part_names_must_be_plain_files_in_the_parts_folder() {
        assert_eq!(part_name(".cadabra/audio/parts/ch-1_a.flac").unwrap(), "ch-1_a.flac");
        for bad in [".cadabra/audio/parts/a'b.flac", ".cadabra/audio/parts/a b.flac", "exports/a.flac", ".cadabra/audio/parts/../a.flac", ".cadabra/audio/parts/a.wav", ".cadabra/audio/parts/é.flac"] {
            assert!(part_name(bad).is_err(), "{bad}");
        }
        let list = concat_list(&[PathBuf::from("/p/it's/a.flac"), PathBuf::from("/p/b.flac")]);
        assert_eq!(list, "file '/p/it'\\''s/a.flac'\nfile '/p/b.flac'\n");
    }

    #[test]
    fn windows_paths_use_forward_slashes_in_the_list() {
        assert_eq!(forward_slashes("C:\\Books\\a.flac", true), "C:/Books/a.flac");
        assert_eq!(forward_slashes("/p/a\\b.flac", false), "/p/a\\b.flac");
    }

    #[test]
    fn arguments_map_the_audio_chapters_and_the_cover_as_an_attached_picture() {
        let (l, m, o, c) = (Path::new("/t/l"), Path::new("/t/m"), Path::new("/t/o"), Path::new("/p/assets/c.png"));
        let with = ffmpeg_args(l, m, Some(c), o).join(" ");
        assert!(with.contains("-f concat -safe 0 -i /t/l -i /t/m -i /p/assets/c.png -map 0:a -map 2:v -map_metadata 1 -map_chapters 1 -c:a aac -b:a 64k -c:v copy -disposition:v:0 attached_pic -f ipod /t/o"), "{with}");
        let without = ffmpeg_args(l, m, None, o).join(" ");
        assert!(!without.contains("2:v") && !without.contains("attached_pic") && without.ends_with("-f ipod /t/o"), "{without}");
    }

    #[cfg(unix)]
    mod process {
        use super::*;
        use std::os::unix::fs::PermissionsExt;

        struct Fixture {
            _dir: tempfile::TempDir,
            project: PathBuf,
            ffmpeg: PathBuf,
        }

        /// A project with two parts, a cover and a stand-in ffmpeg that runs `body` (the output path is `$OUT`).
        fn fixture(body: &str) -> Fixture {
            let dir = tempfile::tempdir().unwrap();
            let project = dir.path().join("book");
            fs::create_dir_all(project.join(".cadabra/audio/parts")).unwrap();
            fs::create_dir_all(project.join("assets")).unwrap();
            fs::write(project.join("cadabra.json"), "{}").unwrap();
            fs::write(project.join(".cadabra/audio/parts/a.flac"), b"fLaC-a").unwrap();
            fs::write(project.join(".cadabra/audio/parts/b.flac"), b"fLaC-b").unwrap();
            fs::write(project.join("assets/cover.png"), b"png").unwrap();
            let ffmpeg = dir.path().join("fake-ffmpeg");
            fs::write(&ffmpeg, format!("#!/bin/sh\nfor a in \"$@\"; do OUT=\"$a\"; done\n{body}\n")).unwrap();
            fs::set_permissions(&ffmpeg, fs::Permissions::from_mode(0o755)).unwrap();
            Fixture { _dir: dir, project, ffmpeg }
        }

        fn request(f: &Fixture) -> M4bRequest {
            M4bRequest {
                job_id: "j".into(),
                root: f.project.to_string_lossy().into_owned(),
                base: "exports/audio/book".into(),
                title: "Book".into(),
                author: "Me".into(),
                cover: Some("assets/cover.png".into()),
                chapters: vec![chapter("One", "a.flac", 1.0), chapter("Two", "b.flac", 2.0)],
            }
        }

        #[test]
        fn writes_the_m4b_under_exports_from_the_tools_output_and_cleans_up() {
            // The stand-in notes where its output goes (inside the temp dir), so the test can check that folder is gone.
            let f = fixture("echo m4b-bytes > \"$OUT\"; dirname \"$OUT\" > \"$NOTE\"");
            let note = f.project.join("note.txt");
            fs::write(&f.ffmpeg, fs::read_to_string(&f.ffmpeg).unwrap().replace("$NOTE", &note.to_string_lossy())).unwrap();
            let built = build_m4b(&request(&f), &f.ffmpeg, &AtomicBool::new(false)).unwrap();
            assert_eq!(built, BuiltM4b { path: "exports/audio/book.m4b".into(), duration_sec: 3.0 });
            assert_eq!(fs::read(f.project.join("exports/audio/book.m4b")).unwrap(), b"m4b-bytes\n");
            let scratch = fs::read_to_string(&note).unwrap();
            assert!(!Path::new(scratch.trim()).exists(), "the temp dir must be removed");
        }

        #[test]
        fn the_tool_gets_the_parts_in_order_as_absolute_paths() {
            let f = fixture("for a in \"$@\"; do case \"$a\" in *parts.txt) cat \"$a\" > \"$OUT\";; esac; done");
            build_m4b(&request(&f), &f.ffmpeg, &AtomicBool::new(false)).unwrap();
            let list = fs::read_to_string(f.project.join("exports/audio/book.m4b")).unwrap();
            let lines: Vec<&str> = list.lines().collect();
            assert_eq!(lines.len(), 2);
            assert!(lines[0].starts_with("file '/") && lines[0].ends_with("/.cadabra/audio/parts/a.flac'"), "{list}");
            assert!(lines[1].ends_with("/.cadabra/audio/parts/b.flac'"), "{list}");
        }

        #[test]
        fn a_failing_tool_is_an_encode_error_with_its_message_and_writes_nothing() {
            let f = fixture("echo 'bad input' >&2; exit 1");
            let e = build_m4b(&request(&f), &f.ffmpeg, &AtomicBool::new(false)).unwrap_err();
            assert_eq!(e, AudioError::Encode { format: "m4b".into(), message: "bad input".into() });
            assert!(!f.project.join("exports").exists());
        }

        #[test]
        fn a_tool_that_fails_silently_still_gets_a_message() {
            let f = fixture("exit 1");
            let e = build_m4b(&request(&f), &f.ffmpeg, &AtomicBool::new(false)).unwrap_err();
            assert!(matches!(e, AudioError::Encode { format, message } if format == "m4b" && message.contains("no message")));
        }

        #[test]
        fn cancel_kills_the_tool_promptly_and_leaves_nothing() {
            let f = fixture("sleep 30");
            let cancel = std::sync::Arc::new(AtomicBool::new(false));
            let flag = cancel.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(200));
                flag.store(true, std::sync::atomic::Ordering::Relaxed);
            });
            let started = std::time::Instant::now();
            assert_eq!(build_m4b(&request(&f), &f.ffmpeg, &cancel).unwrap_err(), AudioError::Cancelled);
            assert!(started.elapsed() < Duration::from_secs(5));
            assert!(!f.project.join("exports").exists());
        }

        #[test]
        fn bad_requests_are_refused_before_the_tool_runs() {
            let f = fixture("echo ran > \"$OUT\"");
            let off = AtomicBool::new(false);
            let mut r = request(&f);
            r.base = "elsewhere/book".into();
            assert!(build_m4b(&r, &f.ffmpeg, &off).is_err());
            let mut r = request(&f);
            r.chapters[0].part = "exports/a.flac".into();
            assert!(build_m4b(&r, &f.ffmpeg, &off).is_err());
            let mut r = request(&f);
            r.cover = Some("manuscript/c.png".into());
            assert!(build_m4b(&r, &f.ffmpeg, &off).is_err());
            let mut r = request(&f);
            r.cover = Some("assets/missing.png".into());
            assert!(build_m4b(&r, &f.ffmpeg, &off).is_err());
            let mut r = request(&f);
            r.chapters[1].part = ".cadabra/audio/parts/gone.flac".into();
            assert!(build_m4b(&r, &f.ffmpeg, &off).is_err());
            let mut r = request(&f);
            r.chapters.clear();
            assert!(build_m4b(&r, &f.ffmpeg, &off).is_err());
            let mut r = request(&f);
            r.cover = None;
            assert!(build_m4b(&r, &f.ffmpeg, &off).is_ok(), "no cover is allowed");
        }

        #[test]
        fn a_missing_tool_is_not_found() {
            let f = fixture("true");
            let e = build_m4b(&request(&f), Path::new("/nope/ffmpeg"), &AtomicBool::new(false)).unwrap_err();
            assert!(matches!(e, AudioError::NotFound { .. }), "{e:?}");
        }
    }

    /// A real ffmpeg (`FFMPEG_BIN`, the bundled sidecar or PATH); `REQUIRE_FFMPEG=1` turns a missing one into a failure.
    fn real_ffmpeg() -> Option<PathBuf> {
        let found = super::super::engine::find_ffmpeg().ok();
        assert!(found.is_some() || std::env::var_os("REQUIRE_FFMPEG").is_none(), "REQUIRE_FFMPEG is set but ffmpeg was not found");
        found
    }

    /// What `ffmpeg -i <file>` prints about the file (it exits with an error for lack of an output, which is fine).
    fn describe(ffmpeg: &Path, file: &Path) -> String {
        let out = std::process::Command::new(ffmpeg).args(["-hide_banner", "-i"]).arg(file).output().unwrap();
        String::from_utf8_lossy(&out.stderr).into_owned()
    }

    #[test]
    fn real_ffmpeg_builds_an_aac_m4b_with_chapters_and_a_cover() {
        let Some(ffmpeg) = real_ffmpeg() else { return };
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().join("book");
        fs::create_dir_all(project.join(".cadabra/audio/parts")).unwrap();
        fs::create_dir_all(project.join("assets")).unwrap();
        fs::write(project.join("cadabra.json"), "{}").unwrap();
        let tone = |hz: f64, secs: f64| -> Vec<i16> { (0..(24000.0 * secs) as usize).map(|i| ((i as f64 * hz * std::f64::consts::TAU / 24000.0).sin() * 8000.0) as i16).collect() };
        for (name, hz, secs) in [("one", 300.0, 2.0), ("two", 500.0, 1.0)] {
            fs::write(project.join(format!(".cadabra/audio/parts/{name}.flac")), super::super::encode::encode_flac(24000, &tone(hz, secs)).unwrap()).unwrap();
        }
        fs::copy(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../fixtures/assets/pixel.png"), project.join("assets/cover.png")).unwrap();
        let req = M4bRequest {
            job_id: "r".into(),
            root: project.to_string_lossy().into_owned(),
            base: "exports/audio/book".into(),
            title: "Real Book".into(),
            author: "Me".into(),
            cover: Some("assets/cover.png".into()),
            chapters: vec![chapter("Chapter One", "one.flac", 2.0), chapter("Chapter Two", "two.flac", 1.0)],
        };
        let built = build_m4b(&req, &ffmpeg, &AtomicBool::new(false)).unwrap();
        let out = project.join(&built.path);
        let info = describe(&ffmpeg, &out);
        assert!(info.contains("Audio: aac"), "{info}");
        assert!(info.contains("(attached pic)"), "{info}");
        assert!(info.contains("Chapter #0:0: start 0.000000, end 2.000000") && info.contains("Chapter #0:1: start 2.000000, end 3.000000"), "{info}");
        for title in ["Chapter One", "Chapter Two", "Real Book"] {
            assert!(info.contains(&format!(": {title}")), "{title} is missing:\n{info}");
        }
        assert!(info.contains("Duration: 00:00:03."), "{info}");
    }
}
