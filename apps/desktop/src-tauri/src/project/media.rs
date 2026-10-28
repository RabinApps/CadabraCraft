//! Audio and video references read in slices for the `cadabra-ref` scheme (see `commands/media.rs`), so a player can
//! stream and seek a large file without the whole file ever being in memory. Same path rules as every other reference
//! read (`reference_path`: flat `references/<name>`, no traversal, no link out of the project, regular files only).
use super::references::{extension, open_regular, reference_path, IoCtx};
use super::{ProjectError, Result};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

/// Most bytes one response carries. A player that wants more asks again from where the response ended.
pub const MAX_SLICE: u64 = 8 * 1024 * 1024;

/// Content type of a streamable extension (audio and video only: images, PDFs and text are read with `read_reference`,
/// and SVG, scripts and web pages are never served).
fn media_type(ext: &str) -> Option<&'static str> {
    Some(match ext {
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" | "oga" => "audio/ogg",
        "m4a" => "audio/mp4",
        "flac" => "audio/flac",
        _ => return None,
    })
}

/// Checks that `rel` is a streamable reference path; returns its content type. No file access.
pub fn media_path(root: &Path, rel: &str) -> Result<&'static str> {
    reference_path(root, rel)?;
    let ext = extension(rel).map_err(|_| ProjectError::UnsupportedReference { name: rel.to_string() })?;
    media_type(&ext).ok_or_else(|| ProjectError::UnsupportedReference { name: rel.to_string() })
}

/// What a `Range` header asks for, against a file of a known size.
#[derive(Debug, PartialEq, Clone, Copy)]
enum Plan {
    /// The whole file (no usable `Range` header and it fits in one response): status 200.
    Whole,
    /// Bytes `start..=end` (already limited to the file and `MAX_SLICE`): status 206.
    Part { start: u64, end: u64 },
    /// The first byte asked for is past the end: status 416.
    Unsatisfiable,
}

/// A single `bytes=a-b`, `bytes=a-` or `bytes=-n` range. Anything else (another unit, several ranges, `a` greater than
/// `b`, not numbers) is ignored, as RFC 9110 allows, and the request is served as if it had no `Range` header.
fn parse_spec(header: &str) -> Option<(Option<u64>, Option<u64>)> {
    let (first, last) = header.strip_prefix("bytes=")?.trim().split_once('-')?;
    let num = |s: &str| if s.is_empty() { Some(None) } else { s.parse::<u64>().ok().map(Some) };
    let (first, last) = (num(first.trim())?, num(last.trim())?);
    match (first, last) {
        (None, None) => None,
        (Some(a), Some(b)) if a > b => None,
        spec => Some(spec),
    }
}

fn plan(header: Option<&str>, size: u64) -> Plan {
    let Some((first, last)) = header.and_then(parse_spec) else {
        return if size <= MAX_SLICE { Plan::Whole } else { Plan::Part { start: 0, end: MAX_SLICE - 1 } };
    };
    let (start, end) = match (first, last) {
        (Some(a), b) => (a, b.unwrap_or(u64::MAX)),
        (None, n) => (size.saturating_sub(n.unwrap_or(0)), u64::MAX), // the last `n` bytes; n is never None here
    };
    if size == 0 || start >= size || (first.is_none() && last == Some(0)) {
        return Plan::Unsatisfiable;
    }
    Plan::Part { start, end: end.min(size - 1).min(start + (MAX_SLICE - 1)) }
}

/// A slice of a media file, or a note that the range starts past its end.
#[derive(Debug, PartialEq)]
pub enum MediaRead {
    /// `partial` is true for a range (206): the bytes are `start..start + bytes.len()` of `total`.
    Slice { bytes: Vec<u8>, start: u64, total: u64, partial: bool, content_type: &'static str },
    OutOfRange { total: u64 },
}

/// Reads what `range` (the value of a `Range` header, if any) asks for from `references/<name>`.
pub fn read_media(root: &Path, rel: &str, range: Option<&str>) -> Result<MediaRead> {
    let content_type = media_path(root, rel)?;
    let (file, total) = open_regular(root, rel)?;
    read_open(file, total, rel, range, content_type)
}

/// `read_media` on an open file of `total` bytes (separate so a file that shrank after its size was read can be tested).
fn read_open(mut file: File, total: u64, rel: &str, range: Option<&str>, content_type: &'static str) -> Result<MediaRead> {
    let (start, len, partial) = match plan(range, total) {
        Plan::Unsatisfiable => return Ok(MediaRead::OutOfRange { total }),
        Plan::Whole => (0, total, false),
        Plan::Part { start, end } => (start, end - start + 1, true),
    };
    file.seek(SeekFrom::Start(start)).ctx(rel)?;
    let mut bytes = Vec::new();
    file.take(len).read_to_end(&mut bytes).ctx(rel)?;
    if partial && bytes.is_empty() {
        return Ok(MediaRead::OutOfRange { total }); // the file shrank after the size was read
    }
    Ok(MediaRead::Slice { bytes, start, total, partial, content_type })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    const M: u64 = MAX_SLICE;

    #[test]
    fn only_audio_and_video_have_a_content_type() {
        for (ext, ty) in [("mp4", "video/mp4"), ("m4v", "video/mp4"), ("mov", "video/quicktime"), ("webm", "video/webm"), ("mp3", "audio/mpeg"), ("wav", "audio/wav"), ("ogg", "audio/ogg"), ("oga", "audio/ogg"), ("m4a", "audio/mp4"), ("flac", "audio/flac")] {
            assert_eq!(media_type(ext), Some(ty), "{ext}");
        }
        for ext in ["png", "svg", "pdf", "txt", "html", "js", "exe", ""] {
            assert_eq!(media_type(ext), None, "{ext}");
        }
    }

    #[test]
    fn range_headers_parse_to_one_range_or_are_ignored() {
        assert_eq!(parse_spec("bytes=0-99"), Some((Some(0), Some(99))));
        assert_eq!(parse_spec("bytes=5-"), Some((Some(5), None)));
        assert_eq!(parse_spec("bytes=-20"), Some((None, Some(20))));
        assert_eq!(parse_spec("bytes= 1 - 2 "), Some((Some(1), Some(2))));
        for bad in ["", "bytes=", "bytes=-", "bytes=9-3", "bytes=a-b", "bytes=1-2,5-6", "items=0-1", "bytes=0", "bytes=-1-2", "bytes=99999999999999999999-"] {
            assert_eq!(parse_spec(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn a_request_is_planned_against_the_file_size_and_the_slice_cap() {
        assert_eq!(plan(None, 100), Plan::Whole);
        assert_eq!(plan(None, 0), Plan::Whole);
        assert_eq!(plan(Some("bytes=nonsense"), 100), Plan::Whole);
        assert_eq!(plan(None, M), Plan::Whole);
        assert_eq!(plan(None, M + 1), Plan::Part { start: 0, end: M - 1 }); // no Range on a big file: first slice
        assert_eq!(plan(Some("bytes=0-1"), 100), Plan::Part { start: 0, end: 1 });
        assert_eq!(plan(Some("bytes=0-"), 100), Plan::Part { start: 0, end: 99 });
        assert_eq!(plan(Some("bytes=90-500"), 100), Plan::Part { start: 90, end: 99 });
        assert_eq!(plan(Some("bytes=-10"), 100), Plan::Part { start: 90, end: 99 });
        assert_eq!(plan(Some("bytes=-500"), 100), Plan::Part { start: 0, end: 99 });
        assert_eq!(plan(Some("bytes=100-"), 100), Plan::Unsatisfiable);
        assert_eq!(plan(Some("bytes=0-"), 0), Plan::Unsatisfiable);
        assert_eq!(plan(Some("bytes=-0"), 100), Plan::Unsatisfiable);
        let big = 10 * M;
        assert_eq!(plan(Some("bytes=0-"), big), Plan::Part { start: 0, end: M - 1 });
        assert_eq!(plan(Some(&format!("bytes={M}-")), big), Plan::Part { start: M, end: 2 * M - 1 });
        assert_eq!(plan(Some("bytes=-100"), big), Plan::Part { start: big - 100, end: big - 1 });
        assert_eq!(plan(Some("bytes=5-19"), big), Plan::Part { start: 5, end: 19 });
    }

    fn book() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        fs::create_dir(d.path().join("references")).unwrap();
        d
    }

    fn slice(r: MediaRead) -> (Vec<u8>, u64, u64, bool, &'static str) {
        match r {
            MediaRead::Slice { bytes, start, total, partial, content_type } => (bytes, start, total, partial, content_type),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn a_media_file_is_read_whole_or_by_range() {
        let b = book();
        fs::write(b.path().join("references/clip.MP4"), b"0123456789").unwrap();
        let rel = "references/clip.MP4";
        assert_eq!(slice(read_media(b.path(), rel, None).unwrap()), (b"0123456789".to_vec(), 0, 10, false, "video/mp4"));
        assert_eq!(slice(read_media(b.path(), rel, Some("bytes=2-4")).unwrap()), (b"234".to_vec(), 2, 10, true, "video/mp4"));
        assert_eq!(slice(read_media(b.path(), rel, Some("bytes=-3")).unwrap()), (b"789".to_vec(), 7, 10, true, "video/mp4"));
        assert_eq!(read_media(b.path(), rel, Some("bytes=10-")).unwrap(), MediaRead::OutOfRange { total: 10 });
    }

    #[test]
    fn a_big_file_is_sent_one_capped_slice_at_a_time() {
        let b = book();
        let f = fs::File::create(b.path().join("references/long.webm")).unwrap();
        f.set_len(M + 10).unwrap(); // sparse
        let (bytes, start, total, partial, _) = slice(read_media(b.path(), "references/long.webm", Some("bytes=0-")).unwrap());
        assert_eq!((bytes.len() as u64, start, total, partial), (M, 0, M + 10, true));
        let (bytes, start, ..) = slice(read_media(b.path(), "references/long.webm", Some(&format!("bytes={M}-"))).unwrap());
        assert_eq!((bytes.len(), start), (10, M));
    }

    #[test]
    fn an_empty_file_and_a_file_that_shrank_are_handled() {
        let b = book();
        fs::write(b.path().join("references/a.mp3"), b"").unwrap();
        assert_eq!(read_media(b.path(), "references/a.mp3", Some("bytes=0-")).unwrap(), MediaRead::OutOfRange { total: 0 });
        assert_eq!(slice(read_media(b.path(), "references/a.mp3", None).unwrap()).0, Vec::<u8>::new());
        // The size said 10 bytes but the file now has 4: a range past the new end is out of range, one before it is cut short.
        fs::write(b.path().join("references/s.mp3"), b"0123").unwrap();
        let open = || File::open(b.path().join("references/s.mp3")).unwrap();
        assert_eq!(read_open(open(), 10, "s", Some("bytes=6-"), "audio/mpeg").unwrap(), MediaRead::OutOfRange { total: 10 });
        assert_eq!(slice(read_open(open(), 10, "s", Some("bytes=2-9"), "audio/mpeg").unwrap()).0, b"23".to_vec());
    }

    #[test]
    fn only_listed_style_flat_media_files_are_served() {
        let b = book();
        for name in ["pic.png", "doc.pdf", "note.txt", "v.svg", "run.sh", "page.html", "noext", "bad.a b"] {
            fs::write(b.path().join("references").join(name), "x").unwrap();
            assert!(matches!(read_media(b.path(), &format!("references/{name}"), None).unwrap_err(), ProjectError::UnsupportedReference { .. }), "{name}");
        }
        for rel in ["references/../cadabra.json", "assets/a.mp4", "references/sub/a.mp4", "cadabra.json", "/etc/passwd.mp4", "references/"] {
            assert!(read_media(b.path(), rel, None).is_err(), "{rel}");
        }
        assert!(matches!(read_media(b.path(), "references/gone.mp4", None).unwrap_err(), ProjectError::NotFound { .. }));
        fs::create_dir(b.path().join("references/folder.mp4")).unwrap();
        assert!(read_media(b.path(), "references/folder.mp4", None).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn a_link_out_of_the_project_is_not_followed() {
        let (b, out) = (book(), tempfile::tempdir().unwrap());
        fs::write(out.path().join("secret.mp4"), "secret").unwrap();
        std::os::unix::fs::symlink(out.path().join("secret.mp4"), b.path().join("references/link.mp4")).unwrap();
        assert!(matches!(read_media(b.path(), "references/link.mp4", None).unwrap_err(), ProjectError::PathEscape { .. }));
    }
}
