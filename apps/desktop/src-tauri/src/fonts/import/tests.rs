use super::*;

/// A tiny font with a `head` and a `name` table. Each record is `(platform, encoding, language, name id, bytes)`.
pub(crate) fn font_with_names(records: &[(u16, u16, u16, u16, Vec<u8>)]) -> Vec<u8> {
    let mut strings = Vec::new();
    let mut recs = Vec::new();
    for (p, e, l, id, s) in records {
        for v in [*p, *e, *l, *id, s.len() as u16, strings.len() as u16] {
            recs.extend(v.to_be_bytes());
        }
        strings.extend(s);
    }
    let mut name = vec![0, 0];
    name.extend((records.len() as u16).to_be_bytes());
    name.extend((6 + recs.len() as u16).to_be_bytes());
    name.extend(&recs);
    name.extend(&strings);
    let head = vec![0u8; 54];
    let head_off = 12 + 16 * 2;
    let name_off = head_off + head.len();
    let mut out = vec![0, 1, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0];
    for (tag, off, len) in [(b"head", head_off, head.len()), (b"name", name_off, name.len())] {
        out.extend(tag);
        out.extend([0u8; 4]);
        out.extend((off as u32).to_be_bytes());
        out.extend((len as u32).to_be_bytes());
    }
    out.extend(head);
    out.extend(name);
    out
}

pub(crate) fn utf16(s: &str) -> Vec<u8> {
    s.encode_utf16().flat_map(u16::to_be_bytes).collect()
}

pub(crate) fn ttf(family: &str) -> Vec<u8> {
    font_with_names(&[(3, 1, 0x409, 1, utf16(family)), (3, 1, 0x409, 2, utf16("Regular"))])
}

#[test]
fn reads_the_windows_family_name() {
    assert_eq!(family_name(&ttf("Fancy Serif")).unwrap(), "Fancy Serif");
}

#[test]
fn the_typographic_family_wins_over_the_legacy_one() {
    let f = font_with_names(&[(3, 1, 0x409, 1, utf16("Fancy Light")), (3, 1, 0x409, 16, utf16("Fancy"))]);
    assert_eq!(family_name(&f).unwrap(), "Fancy");
}

#[test]
fn english_windows_beats_other_languages_and_windows_beats_mac() {
    let f = font_with_names(&[(1, 0, 0, 1, b"Mac Name".to_vec()), (3, 1, 0x407, 1, utf16("Deutsch")), (3, 1, 0x409, 1, utf16("English"))]);
    assert_eq!(family_name(&f).unwrap(), "English");
    let f = font_with_names(&[(1, 0, 0, 1, b"Mac Name".to_vec()), (3, 1, 0x407, 1, utf16("Deutsch"))]);
    assert_eq!(family_name(&f).unwrap(), "Deutsch");
}

#[test]
fn a_mac_roman_only_font_is_decoded_with_the_mac_table() {
    let f = font_with_names(&[(1, 0, 0, 1, vec![b'C', b'a', b'f', 0x8E, b' ', b'S', 0xDB])]);
    assert_eq!(family_name(&f).unwrap(), "Café S€");
    assert_eq!(MAC_ROMAN_HIGH.chars().count(), 128);
    assert_eq!(mac_roman(&[0x80, 0xA5, 0xD2, 0xD3, 0xFF]), "Ä•“”ˇ");
}

#[test]
fn a_unicode_platform_record_is_read_as_utf16() {
    let f = font_with_names(&[(0, 3, 0, 1, utf16("Uni Sans"))]);
    assert_eq!(family_name(&f).unwrap(), "Uni Sans");
}

#[test]
fn unusable_names_are_skipped_and_a_font_without_any_is_refused() {
    // an empty typographic name falls back to the legacy family; a name with a control character is not used
    let f = font_with_names(&[(3, 1, 0x409, 16, utf16("  ")), (3, 1, 0x409, 1, utf16("Legacy"))]);
    assert_eq!(family_name(&f).unwrap(), "Legacy");
    assert!(matches!(family_name(&font_with_names(&[(3, 1, 0x409, 1, utf16("Bad\u{7}Name"))])), Err(FontError::InvalidFont { .. })));
    assert!(matches!(family_name(&font_with_names(&[(3, 1, 0x409, 1, utf16(&"x".repeat(101)))])), Err(FontError::InvalidFont { .. })));
    assert!(matches!(family_name(&font_with_names(&[(3, 1, 0x409, 2, utf16("Regular"))])), Err(FontError::InvalidFont { .. })));
    assert!(matches!(family_name(&font_with_names(&[(3, 1, 0x409, 1, vec![0xD8, 0x00])])), Err(FontError::InvalidFont { .. })), "a lone surrogate");
    assert!(matches!(family_name(&font_with_names(&[(3, 1, 0x409, 1, vec![0x00])])), Err(FontError::InvalidFont { .. })), "odd length");
    assert!(matches!(family_name(&font_with_names(&[(2, 1, 0x409, 1, utf16("ISO"))])), Err(FontError::InvalidFont { .. })), "an unsupported platform");
}

#[test]
fn non_fonts_collections_and_cut_off_files_are_refused() {
    for bad in [&b""[..], b"hello world, not a font", b"wOF2\0\0\0\0", b"%PDF-1.7"] {
        assert!(matches!(family_name(bad), Err(FontError::InvalidFont { message }) if message.contains("not a TrueType")), "{bad:?}");
    }
    assert!(matches!(family_name(b"ttcf\0\x01\0\0\0\0\0\0"), Err(FontError::InvalidFont { message }) if message.contains(".ttc")));
    let good = ttf("A");
    for cut in [5, 11, 20, 40, 60, good.len() - 3] {
        assert!(matches!(family_name(&good[..cut]), Err(FontError::InvalidFont { .. })), "cut at {cut}");
    }
    // a table directory that points past the end of the file
    let mut lying = ttf("A");
    lying[12 + 16 + 8..12 + 16 + 12].copy_from_slice(&u32::MAX.to_be_bytes());
    assert!(matches!(family_name(&lying), Err(FontError::InvalidFont { .. })));
    // a string whose offset is past the table
    let mut far = font_with_names(&[(3, 1, 0x409, 1, utf16("A"))]);
    let at = 12 + 32 + 54 + 6 + 10;
    far[at..at + 2].copy_from_slice(&0xFFFFu16.to_be_bytes());
    assert!(matches!(family_name(&far), Err(FontError::InvalidFont { .. })));
    // OpenType-with-CFF and "true" signatures are fonts too
    let mut otto = ttf("Cff");
    otto[0..4].copy_from_slice(b"OTTO");
    assert_eq!(family_name(&otto).unwrap(), "Cff");
    // no `head` table
    let mut nohead = ttf("A");
    nohead[12..16].copy_from_slice(b"xxxx");
    assert!(matches!(family_name(&nohead), Err(FontError::InvalidFont { message }) if message.contains("header")));
}

#[test]
fn slugs_are_lower_case_dashes() {
    assert_eq!(slug("Fancy Serif 2"), "fancy-serif-2");
    assert_eq!(slug("  --Ünï  Cödé!! "), "n-c-d");
    assert_eq!(slug("///"), "");
    assert!(slug(&"a".repeat(100)).len() <= 60);
}

#[test]
fn file_names_are_made_safe_and_only_ttf_and_otf_pass() {
    assert_eq!(safe_file_name(Path::new("/x/My Font (1).TTF")).unwrap(), "My-Font--1.ttf");
    assert_eq!(safe_file_name(Path::new("a.otf")).unwrap(), "a.otf");
    assert_eq!(safe_file_name(Path::new("....ttf")).unwrap(), "font.ttf");
    for bad in ["a.woff2", "a.woff", "a.ttc", "a", "a.ttf.exe", "a.pdf"] {
        assert!(matches!(safe_file_name(Path::new(bad)), Err(FontError::InvalidFont { .. })), "{bad}");
    }
}

fn write(dir: &Path, name: &str, bytes: &[u8]) -> PathBuf {
    let p = dir.join(name);
    fs::write(&p, bytes).unwrap();
    p
}

#[test]
fn importing_copies_the_font_into_a_folder_named_after_its_family() {
    let (src, root) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let bytes = ttf("Fancy Serif");
    let f = import_font(&write(src.path(), "Fancy Regular.ttf", &bytes), root.path()).unwrap();
    assert_eq!((f.id.as_str(), f.family.as_str()), ("imported-fancy-serif", "Fancy Serif"));
    assert_eq!(f.files, vec!["Fancy-Regular.ttf"]);
    assert_eq!(fs::read(root.path().join("imported/fancy-serif/Fancy-Regular.ttf")).unwrap(), bytes);
    // no temp file is left behind
    assert_eq!(fs::read_dir(root.path().join("imported/fancy-serif")).unwrap().count(), 1);
    // the source is untouched
    assert_eq!(fs::read(src.path().join("Fancy Regular.ttf")).unwrap(), bytes);
}

#[test]
fn importing_the_same_file_twice_adds_nothing_and_a_different_one_of_the_same_name_gets_a_new_name() {
    let (src, root) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let p = write(src.path(), "f.ttf", &ttf("Fancy"));
    import_font(&p, root.path()).unwrap();
    assert_eq!(import_font(&p, root.path()).unwrap().files, vec!["f.ttf"]);
    fs::create_dir_all(src.path().join("g")).unwrap();
    let mut different = ttf("Fancy");
    different.extend([1, 2, 3]);
    let q = write(&src.path().join("g"), "f.ttf", &different);
    let f = import_font(&q, root.path()).unwrap();
    assert_eq!(f.files, vec!["f-2.ttf", "f.ttf"]);
    assert_eq!(fs::read(root.path().join("imported/fancy/f.ttf")).unwrap(), ttf("Fancy"), "the first copy is never overwritten");
}

#[test]
fn importing_refuses_oversize_non_fonts_wrong_extensions_and_missing_files() {
    let (src, root) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut big = ttf("Big");
    big.resize(MAX_FONT_BYTES as usize + 1, 0);
    let r = import_font(&write(src.path(), "big.ttf", &big), root.path());
    assert!(matches!(r, Err(FontError::InvalidFont { message }) if message.contains("25 MB")));
    big.truncate(MAX_FONT_BYTES as usize);
    assert!(import_font(&write(src.path(), "limit.ttf", &big), root.path()).is_ok(), "exactly 25 MB is allowed");
    assert!(matches!(import_font(&write(src.path(), "a.ttf", b"not a font at all"), root.path()), Err(FontError::InvalidFont { .. })));
    assert!(matches!(import_font(&write(src.path(), "a.woff2", &ttf("W")), root.path()), Err(FontError::InvalidFont { message }) if message.contains("woff2")));
    assert!(
        matches!(import_font(&write(src.path(), "a.ttf", &font_with_names(&[(3, 1, 0x409, 1, utf16("!!!"))])), root.path()), Err(FontError::InvalidFont { message }) if message.contains("no letters"))
    );
    assert!(import_font(&src.path().join("missing.ttf"), root.path()).is_err());
    fs::create_dir_all(src.path().join("dir.ttf")).unwrap();
    assert!(matches!(import_font(&src.path().join("dir.ttf"), root.path()), Err(FontError::InvalidFont { .. })));
    assert!(!root.path().join("imported/w").exists(), "nothing is created for a refused file");
}

fn invalid_message(r: Result<String, FontError>) -> String {
    match r {
        Err(FontError::InvalidFont { message }) => message,
        other => panic!("{other:?}"),
    }
}

#[test]
fn a_font_without_a_name_table_or_with_a_cut_down_one_is_refused_with_the_reason() {
    let mut noname = ttf("A");
    noname[28..32].copy_from_slice(b"xxxx");
    assert!(invalid_message(family_name(&noname)).contains("no name table"));
    // the name table is directory entry 2: its length field is at 12 + 16 + 12
    for len in [0u32, 3, 4] {
        let mut cut = ttf("A");
        cut[40..44].copy_from_slice(&len.to_be_bytes());
        assert!(invalid_message(family_name(&cut)).contains("empty"), "{len}");
    }
}

#[test]
fn a_record_count_larger_than_the_table_stops_reading_and_a_repeat_of_an_id_keeps_the_first() {
    let mut lying = ttf("A");
    let count_at = 12 + 32 + 54 + 2;
    lying[count_at..count_at + 2].copy_from_slice(&9u16.to_be_bytes());
    assert_eq!(family_name(&lying).unwrap(), "A"); // reading stops at the cut-off record
    let twice = font_with_names(&[(3, 1, 0x409, 1, utf16("First")), (3, 1, 0x409, 1, utf16("Second"))]);
    assert_eq!(family_name(&twice).unwrap(), "First");
    let mac_other_language = font_with_names(&[(1, 0, 7, 1, b"Mac Other".to_vec())]);
    assert_eq!(family_name(&mac_other_language).unwrap(), "Mac Other");
}

#[test]
fn a_name_taken_by_a_folder_or_by_ninety_nine_other_fonts_is_an_error() {
    let (src, root) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let p = write(src.path(), "f.ttf", &ttf("Fancy"));
    let dir = root.path().join("imported/fancy");
    fs::create_dir_all(dir.join("f.ttf")).unwrap();
    assert!(matches!(import_font(&p, root.path()), Err(FontError::Other { .. })));
    fs::remove_dir(dir.join("f.ttf")).unwrap();
    for n in 1..100 {
        let name = if n == 1 { "f.ttf".to_string() } else { format!("f-{n}.ttf") };
        fs::write(dir.join(name), b"other").unwrap();
    }
    assert!(matches!(import_font(&p, root.path()), Err(FontError::Other { .. })));
}
