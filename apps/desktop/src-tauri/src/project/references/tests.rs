use super::*;

const PNG: [u8; 12] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 1];

fn tmp() -> tempfile::TempDir {
    tempfile::tempdir().unwrap()
}

fn src(d: &tempfile::TempDir, name: &str, bytes: &[u8]) -> PathBuf {
    let p = d.path().join(name);
    fs::write(&p, bytes).unwrap();
    p
}

fn mp4() -> Vec<u8> {
    let mut v = vec![0, 0, 0, 0x18];
    v.extend_from_slice(b"ftypmp42");
    v.extend_from_slice(&[0; 16]);
    v
}

#[test]
fn kinds_and_caps_follow_the_extension() {
    assert_eq!(kind_of("png"), ReferenceKind::Image);
    assert_eq!(kind_of("mov"), ReferenceKind::Video);
    assert_eq!(kind_of("flac"), ReferenceKind::Audio);
    assert_eq!(kind_of("pdf"), ReferenceKind::Pdf);
    assert_eq!(kind_of("md"), ReferenceKind::Text);
    assert_eq!(kind_of("xlsx"), ReferenceKind::Other);
    assert_eq!(kind_of(""), ReferenceKind::Other);
    let caps: Vec<u64> = [ReferenceKind::Video, ReferenceKind::Audio, ReferenceKind::Pdf, ReferenceKind::Image, ReferenceKind::Other, ReferenceKind::Text]
        .iter()
        .map(|k| max_bytes(*k) / MB)
        .collect();
    assert_eq!(caps, vec![500, 200, 200, 100, 100, 5]);
}

#[test]
fn every_supported_type_is_imported_with_a_sanitized_name() {
    let (proj, out) = (tmp(), tmp());
    let mut wav = b"RIFF\0\0\0\0WAVE".to_vec();
    wav.extend_from_slice(&[0; 8]);
    let cases: Vec<(&str, Vec<u8>, ReferenceKind, &str)> = vec![
        ("My Map (final)!.PNG", PNG.to_vec(), ReferenceKind::Image, "references/My-Map-final.png"),
        ("vector.svg", b"<svg xmlns='x'></svg>".to_vec(), ReferenceKind::Image, "references/vector.svg"),
        ("Harbour at dusk.mp4", mp4(), ReferenceKind::Video, "references/Harbour-at-dusk.mp4"),
        ("clip.webm", vec![0x1a, 0x45, 0xdf, 0xa3, 1, 2], ReferenceKind::Video, "references/clip.webm"),
        ("song.mp3", b"ID3\x04\0\0".to_vec(), ReferenceKind::Audio, "references/song.mp3"),
        ("frame.mp3", vec![0xff, 0xfb, 0x90, 0], ReferenceKind::Audio, "references/frame.mp3"),
        ("tone.wav", wav, ReferenceKind::Audio, "references/tone.wav"),
        ("a.ogg", b"OggS\0".to_vec(), ReferenceKind::Audio, "references/a.ogg"),
        ("b.flac", b"fLaC\0".to_vec(), ReferenceKind::Audio, "references/b.flac"),
        ("c.m4a", mp4(), ReferenceKind::Audio, "references/c.m4a"),
        ("book.pdf", b"%PDF-1.7\n".to_vec(), ReferenceKind::Pdf, "references/book.pdf"),
        ("notes.markdown", "# h\u{e9}llo".as_bytes().to_vec(), ReferenceKind::Text, "references/notes.markdown"),
        ("data.xlsx", vec![0, 1, 2, 255], ReferenceKind::Other, "references/data.xlsx"),
        ("README", b"plain text notes".to_vec(), ReferenceKind::Other, "references/README"),
        ("scan", PNG.to_vec(), ReferenceKind::Other, "references/scan"),
        // `!!!`: legal to create on every platform, and nothing survives sanitising; `?` is not a legal Windows file name.
        ("!!!.pdf", b"%PDF-1".to_vec(), ReferenceKind::Pdf, "references/file.pdf"),
    ];
    for (name, bytes, kind, rel) in cases {
        let got = import_reference(proj.path(), &src(&out, name, &bytes)).unwrap();
        assert_eq!((got.file.as_str(), got.kind, got.reused, got.size), (rel, kind, false, bytes.len() as u64), "{name}");
        assert_eq!(fs::read(proj.path().join(rel)).unwrap(), bytes, "{name}");
    }
    let got = import_reference(proj.path(), &src(&out, " Spaced Title .txt", b"x")).unwrap();
    assert_eq!(got.title, "Spaced Title");
    assert_eq!(import_reference(proj.path(), &src(&out, ".md", b"x")).unwrap().title, "file");
    let left: Vec<_> = fs::read_dir(proj.path().join("references"))
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".tmp"))
        .collect();
    assert!(left.is_empty(), "{left:?}");
}

#[test]
fn identical_bytes_are_reused_and_different_bytes_get_a_suffix() {
    let (proj, out) = (tmp(), tmp());
    let a = src(&out, "a.pdf", b"%PDF-1 one");
    let first = import_reference(proj.path(), &a).unwrap();
    let again = import_reference(proj.path(), &a).unwrap();
    assert_eq!((first.file.as_str(), first.reused, again.file.as_str(), again.reused), ("references/a.pdf", false, "references/a.pdf", true));
    let sub = out.path().join("sub");
    fs::create_dir(&sub).unwrap();
    fs::write(sub.join("a.pdf"), b"%PDF-1 two!").unwrap();
    assert_eq!(import_reference(proj.path(), &sub.join("a.pdf")).unwrap().file, "references/a-2.pdf");
    fs::write(sub.join("a.pdf"), b"%PDF-1 three").unwrap();
    assert_eq!(import_reference(proj.path(), &sub.join("a.pdf")).unwrap().file, "references/a-3.pdf");
    fs::write(sub.join("a.pdf"), b"%PDF-1 one").unwrap();
    assert!(import_reference(proj.path(), &sub.join("a.pdf")).unwrap().reused);
    assert_eq!(fs::read(proj.path().join("references/a.pdf")).unwrap(), b"%PDF-1 one", "original untouched");
    assert!(a.exists(), "source is left alone");
}

#[test]
fn refuses_blocked_types_bad_names_fake_content_and_non_files() {
    let (proj, out) = (tmp(), tmp());
    let err = |name: &str, bytes: &[u8]| import_reference(proj.path(), &src(&out, name, bytes)).unwrap_err();
    for name in ["setup.exe", "a.SH", "page.html", "x.js", "tool.app"] {
        assert!(matches!(err(name, b"x"), ProjectError::UnsupportedReference { .. }), "{name}");
    }
    for name in [
        "a.py",
        "a.rb",
        "a.pl",
        "a.scpt",
        "a.terminal",
        "a.url",
        "a.webloc",
        "a.desktop",
        "a.docm",
        "a.XLSM",
        "a.chm",
        "a.cpl",
        "a.command",
        "a.pkg",
        "a.dmg",
        "a.jar",
        "a.ps1",
        "a.vbs",
        "a.wsf",
        "a.hta",
        "a.lnk",
        "a.inf",
        "a.reg",
        "a.sh",
        "a.bash",
        "a.zsh",
        "a.ps1xml",
        "a.pptm",
        "a.workflow",
    ] {
        assert!(matches!(err(name, b"x"), ProjectError::UnsupportedReference { .. }), "{name}");
    }
    for ext in ["docx", "xlsx", "epub", "zip", "csv", "json"] {
        assert!(!BLOCKED.contains(&ext), "{ext} is ordinary research material");
    }
    // No extension: only a recognizable file is kept, never a program or unknown bytes.
    // `nul` is a reserved device name on Windows: such a file cannot exist there (the write lands in the device), so the
    // case is only meaningful where the name is an ordinary one.
    let programs: &[(&str, &[u8])] = &[
        ("tool", &[0x7f, b'E', b'L', b'F', 2, 1][..]),
        ("tool2", &[0xcf, 0xfa, 0xed, 0xfe, 7][..]),
        ("tool3", b"MZ\x90\0"),
        ("run", b"#!/bin/sh\necho hi"),
        ("blob", &[1, 2, 3][..]),
        ("nul", b"a\0b"),
        ("latin", &[0x80, 0x81][..]),
    ];
    for &(name, bytes) in programs.iter().filter(|(name, _)| !(cfg!(windows) && *name == "nul")) {
        assert!(matches!(err(name, bytes), ProjectError::UnsupportedReference { .. }), "{name}");
    }
    assert!(matches!(err("weird.ex e", b"x"), ProjectError::UnsupportedReference { .. }));
    assert!(matches!(err("trailing.", b"x"), ProjectError::UnsupportedReference { .. }));
    assert!(matches!(err("long.abcdefghijk", b"x"), ProjectError::UnsupportedReference { .. }));
    for (name, bytes) in [
        ("fake.png", &b"not an image"[..]),
        ("fake.svg", b"plain text"),
        ("fake.pdf", b"hello"),
        ("fake.mp4", b"hello hello hello"),
        ("fake.webm", b"hello"),
        ("fake.mp3", b"hello"),
        ("fake.wav", b"RIFFxxxxWAVx"),
        ("fake.ogg", b"hello"),
        ("fake.flac", b"hello"),
        ("fake.txt", &[0xff, 0xfe, 0x41][..]),
        ("nul.md", b"a\0b"),
    ] {
        assert!(matches!(err(name, bytes), ProjectError::InvalidReference { .. }), "{name}");
    }
    assert!(err("huge.png", &{
        let mut b = PNG[..8].to_vec();
        b.extend_from_slice(&[0, 0, 0, 13]);
        b.extend_from_slice(b"IHDR");
        b.extend_from_slice(&60000u32.to_be_bytes());
        b.extend_from_slice(&60000u32.to_be_bytes());
        b
    })
    .to_string()
    .contains("megapixels"));
    assert!(matches!(import_reference(proj.path(), &out.path().join("missing.pdf")).unwrap_err(), ProjectError::NotFound { .. }));
    let dir = out.path().join("d.pdf");
    fs::create_dir(&dir).unwrap();
    assert!(matches!(import_reference(proj.path(), &dir).unwrap_err(), ProjectError::NotAFile { .. } | ProjectError::Io { .. }));
    let big = out.path().join("big.txt");
    File::create(&big).unwrap().set_len(5 * MB + 1).unwrap();
    assert!(matches!(import_reference(proj.path(), &big).unwrap_err(), ProjectError::TooLarge { max_mb: 5, .. }));
    assert!(fs::read_dir(proj.path().join("references")).unwrap().next().is_none(), "a refused file leaves nothing behind");
}

#[test]
fn a_copy_stops_when_the_file_grows_past_the_cap_and_reports_read_errors() {
    let big = &ProjectError::TooLarge { path: "x".into(), max_mb: 1 };
    let mut sink = Vec::new();
    let (size, hash) = copy_capped(&mut &b"abc"[..], &mut sink, 3, "x", big).unwrap();
    assert_eq!((size, sink.as_slice(), hash.len()), (3, &b"abc"[..], 64));
    assert_eq!(copy_capped(&mut &b"abcd"[..], &mut Vec::new(), 3, "x", big).unwrap_err(), *big);
    struct Broken;
    impl Read for Broken {
        fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
            Err(std::io::Error::other("disk gone"))
        }
    }
    assert!(matches!(copy_capped(&mut Broken, &mut Vec::new(), 3, "x", big).unwrap_err(), ProjectError::Io { .. }));
    struct Full;
    impl Write for Full {
        fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
            Err(std::io::Error::from(std::io::ErrorKind::StorageFull))
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    assert!(matches!(copy_capped(&mut &b"abc"[..], &mut Full, 9, "x", big).unwrap_err(), ProjectError::DiskFull { .. }));
    Full.flush().unwrap();
}

#[test]
fn ranges_are_read_in_chunks_and_stop_at_the_end() {
    let (proj, out) = (tmp(), tmp());
    let bytes: Vec<u8> = (0..=255u8).collect();
    let got = import_reference(proj.path(), &src(&out, "data.bin2", &bytes)).unwrap();
    let rel = got.file.as_str();
    assert_eq!(read_reference_range(proj.path(), rel, 0, 4).unwrap(), vec![0, 1, 2, 3]);
    assert_eq!(read_reference_range(proj.path(), rel, 250, 100).unwrap(), vec![250, 251, 252, 253, 254, 255]);
    assert!(read_reference_range(proj.path(), rel, 256, 10).unwrap().is_empty());
    assert!(read_reference_range(proj.path(), rel, 9999, 10).unwrap().is_empty());
    assert!(read_reference_range(proj.path(), rel, 0, 0).unwrap().is_empty());
    assert_eq!(stat_reference(proj.path(), rel).unwrap(), ReferenceStat { size: 256, kind: ReferenceKind::Other });
    let big = proj.path().join("references/big.mp4");
    File::create(&big).unwrap().set_len(MAX_CHUNK + 10).unwrap();
    assert_eq!(read_reference_range(proj.path(), "references/big.mp4", 0, u64::MAX).unwrap().len() as u64, MAX_CHUNK);
    assert_eq!(stat_reference(proj.path(), "references/big.mp4").unwrap().kind, ReferenceKind::Video);
}

#[test]
fn only_flat_references_paths_are_served() {
    let proj = tmp();
    fs::create_dir_all(proj.path().join("references/sub")).unwrap();
    fs::write(proj.path().join("cadabra.json"), "{}").unwrap();
    fs::write(proj.path().join("references/sub/a.pdf"), "x").unwrap();
    for rel in
        ["cadabra.json", "assets/a.png", "references", "references/", "references/sub/a.pdf", "references/../cadabra.json", "/etc/passwd", "references\\a.pdf"]
    {
        assert!(read_reference_range(proj.path(), rel, 0, 1).is_err(), "{rel}");
        assert!(stat_reference(proj.path(), rel).is_err(), "{rel}");
        assert!(trash_reference(proj.path(), rel).is_err(), "{rel}");
        assert!(reference_open_path(proj.path(), rel).is_err(), "{rel}");
    }
    assert!(matches!(reference_path(proj.path(), "assets/a.png").unwrap_err(), ProjectError::NotReference { .. }));
    assert!(matches!(read_reference_range(proj.path(), "references/nope.pdf", 0, 1).unwrap_err(), ProjectError::NotFound { .. }));
    assert!(matches!(read_reference_range(proj.path(), "references/sub", 0, 1).unwrap_err(), ProjectError::NotAFile { .. } | ProjectError::Io { .. }));
    assert!(matches!(trash_reference(proj.path(), "references/sub").unwrap_err(), ProjectError::NotAFile { .. }));
    assert!(matches!(trash_reference(proj.path(), "references/nope.pdf").unwrap_err(), ProjectError::NotFound { .. }));
}

#[test]
fn trashing_moves_the_file_and_never_overwrites_an_earlier_one() {
    let (proj, out) = (tmp(), tmp());
    let first = import_reference(proj.path(), &src(&out, "a.pdf", b"%PDF-1 one")).unwrap();
    let t1 = trash_reference(proj.path(), &first.file).unwrap();
    assert!(!proj.path().join(&first.file).exists());
    assert_eq!(fs::read(proj.path().join(&t1)).unwrap(), b"%PDF-1 one");
    assert!(t1.ends_with("-references__a.pdf"), "{t1}");
    let second = import_reference(proj.path(), &src(&out, "a.pdf", b"%PDF-1 one")).unwrap();
    let t2 = trash_reference(proj.path(), &second.file).unwrap();
    assert_ne!(t1, t2);
    assert!(proj.path().join(&t1).exists() && proj.path().join(&t2).exists());
    assert!(crate::project::list_trash(proj.path()).unwrap().is_empty(), "references are not restorable pages");
}

#[test]
fn opening_is_limited_to_safe_existing_files() {
    let (proj, out) = (tmp(), tmp());
    let pdf = import_reference(proj.path(), &src(&out, "a.pdf", b"%PDF-1")).unwrap();
    assert_eq!(reference_open_path(proj.path(), &pdf.file).unwrap(), proj.path().join("references/a.pdf"));
    let svg = import_reference(proj.path(), &src(&out, "v.svg", b"<svg/>")).unwrap();
    assert!(matches!(reference_open_path(proj.path(), &svg.file).unwrap_err(), ProjectError::UnsupportedReference { .. }));
    fs::write(proj.path().join("references/tool.exe"), "MZ").unwrap();
    assert!(matches!(reference_open_path(proj.path(), "references/tool.exe").unwrap_err(), ProjectError::UnsupportedReference { .. }));
    for name in ["run.py", "x.webloc", "m.docm", "s.command"] {
        fs::write(proj.path().join("references").join(name), "x").unwrap();
        assert!(matches!(reference_open_path(proj.path(), &format!("references/{name}")).unwrap_err(), ProjectError::UnsupportedReference { .. }), "{name}");
    }
    assert!(matches!(reference_open_path(proj.path(), "references/bad.a.b c").unwrap_err(), ProjectError::UnsupportedReference { .. }));
    assert!(matches!(reference_open_path(proj.path(), "references/gone.pdf").unwrap_err(), ProjectError::NotFound { .. }));
    fs::write(proj.path().join("references/.late.pdf.icloud"), "").unwrap();
    assert!(matches!(reference_open_path(proj.path(), "references/late.pdf").unwrap_err(), ProjectError::IcloudPending { .. }));
}

#[test]
fn extensionless_files_open_only_when_their_content_is_a_document_or_media() {
    let proj = tmp();
    let refs = proj.path().join("references");
    fs::create_dir_all(&refs).unwrap();
    let open = |name: &str, bytes: &[u8]| {
        fs::write(refs.join(name), bytes).unwrap();
        reference_open_path(proj.path(), &format!("references/{name}"))
    };
    assert_eq!(open("README", b"plain text notes\n").unwrap(), refs.join("README"));
    assert_eq!(open("scan", &PNG).unwrap(), refs.join("scan"));
    assert!(open("empty", b"").is_ok(), "an empty file follows the import sniff, which accepts it");
    for (name, bytes) in
        [("elf", &b"\x7fELF\x02\x01\x01\0"[..]), ("mz", b"MZ\x90\0\x03\0\0\0"), ("script", b"#!/bin/sh\necho hi\n"), ("blob", &[0xde, 0xad, 0x01, 0x02][..])]
    {
        assert!(matches!(open(name, bytes).unwrap_err(), ProjectError::UnsupportedReference { .. }), "{name}");
    }
}

#[cfg(unix)]
#[test]
fn an_extensionless_fifo_is_refused_without_hanging() {
    let proj = tmp();
    fs::create_dir_all(proj.path().join("references")).unwrap();
    let fifo = proj.path().join("references/pipe");
    assert!(std::process::Command::new("mkfifo").arg(&fifo).status().unwrap().success());
    assert!(matches!(reference_open_path(proj.path(), "references/pipe").unwrap_err(), ProjectError::NotAFile { .. }));
}

#[cfg(unix)]
#[test]
fn a_symlink_out_of_the_project_is_not_followed() {
    let (proj, out) = (tmp(), tmp());
    fs::create_dir(proj.path().join("references")).unwrap();
    let secret = src(&out, "secret.pdf", b"%PDF-1 secret");
    std::os::unix::fs::symlink(&secret, proj.path().join("references/link.pdf")).unwrap();
    assert!(matches!(read_reference_range(proj.path(), "references/link.pdf", 0, 9).unwrap_err(), ProjectError::PathEscape { .. }));
    assert!(trash_reference(proj.path(), "references/link.pdf").is_err());
}

#[test]
fn hashing_a_missing_file_is_a_typed_error() {
    assert!(matches!(file_hash(Path::new("/definitely/not/here"), "x").unwrap_err(), ProjectError::NotFound { .. }));
}

#[test]
fn persisting_a_temp_file_never_replaces_a_file_that_appeared_first() {
    let d = tempfile::tempdir().unwrap();
    let target = d.path().join("a.txt");
    fs::write(&target, "theirs").unwrap();
    let mut tmp = tempfile::NamedTempFile::new_in(d.path()).unwrap();
    tmp.write_all(b"mine").unwrap();
    let (back, e) = persist_no_replace(tmp, &target).unwrap_err();
    assert_eq!(e.kind(), std::io::ErrorKind::AlreadyExists);
    assert_eq!(fs::read_to_string(&target).unwrap(), "theirs");
    let free = d.path().join("b.txt");
    persist_no_replace(back, &free).unwrap();
    assert_eq!(fs::read_to_string(&free).unwrap(), "mine");
}

#[test]
fn a_name_that_is_taken_while_importing_is_skipped_and_other_move_errors_are_reported() {
    let (proj, out) = (tmp(), tmp());
    let pdf = src(&out, "map.pdf", b"%PDF-1 data");
    // The first move finds the name taken (another process won the race) and the import goes on to `map-2.pdf`.
    let calls = std::cell::Cell::new(0);
    let racing = |tmp: tempfile::NamedTempFile, path: &Path| {
        calls.set(calls.get() + 1);
        if calls.get() == 1 {
            fs::write(path, "theirs").unwrap();
            return Err((tmp, std::io::ErrorKind::AlreadyExists.into()));
        }
        persist_no_replace(tmp, path)
    };
    let got = import_reference_with(proj.path(), &pdf, &racing).unwrap();
    assert_eq!((got.file.as_str(), got.reused), ("references/map-2.pdf", false));
    assert_eq!(fs::read_to_string(proj.path().join("references/map.pdf")).unwrap(), "theirs");
    let failing = |tmp: tempfile::NamedTempFile, _: &Path| Err((tmp, std::io::Error::from(std::io::ErrorKind::PermissionDenied)));
    let other = src(&out, "other.pdf", b"%PDF-1 other");
    assert!(matches!(import_reference_with(proj.path(), &other, &failing).unwrap_err(), ProjectError::PermissionDenied { .. }));
}

#[test]
fn persisting_into_a_folder_that_does_not_exist_fails_and_hands_the_temp_file_back() {
    let d = tempfile::tempdir().unwrap();
    let tmp = tempfile::NamedTempFile::new_in(d.path()).unwrap();
    let (back, e) = persist_no_replace(tmp, &d.path().join("no-folder/a.txt")).unwrap_err();
    assert_eq!(e.kind(), std::io::ErrorKind::NotFound);
    assert!(back.path().exists());
}
