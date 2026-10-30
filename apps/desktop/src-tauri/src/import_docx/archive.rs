//! Unzips the parts of a `.docx` the importer reads, with the limits of `docx/archive.ts`: an entry-count cap and a cap
//! on the declared uncompressed size, both checked per entry before anything is inflated. Everything stays in memory: nothing
//! is ever written to disk, so a hostile entry name (`../x`, an absolute path, a drive letter) has nowhere to go; names that
//! could climb out of the archive are skipped, which cannot change the result because the importer only looks parts up by
//! the normalised paths it builds itself.
//!
//! Unlike the TypeScript reader (fflate), this one also checks every entry's CRC-32 and that it inflates to exactly its
//! declared size, so a damaged or forged archive is refused (`invalid-zip`) instead of read short or long (fflate cuts an
//! entry that is longer than it says and carries on, and never checks the CRC).
use super::error::{ImportError, ImportErrorCode};
use std::collections::HashMap;
use std::io::{Cursor, Read};
use zip::ZipArchive;

/// The wanted parts, in archive order (a repeated name replaces the earlier bytes but keeps its place).
#[derive(Default, Debug)]
pub struct Files {
    entries: Vec<(String, Vec<u8>)>,
    index: HashMap<String, usize>,
}

impl Files {
    pub fn get(&self, name: &str) -> Option<&[u8]> {
        self.index.get(name).map(|i| self.entries[*i].1.as_slice())
    }
    pub fn contains(&self, name: &str) -> bool {
        self.index.contains_key(name)
    }
    /// Moves a part's bytes out, so the caller can drop them as soon as they are parsed. The name stays listed (`names`, `contains`), with no bytes.
    pub fn take(&mut self, name: &str) -> Option<Vec<u8>> {
        self.index.get(name).map(|i| std::mem::take(&mut self.entries[*i].1))
    }
    pub fn names(&self) -> impl Iterator<Item = &str> {
        self.entries.iter().map(|(n, _)| n.as_str())
    }
    pub fn insert(&mut self, name: &str, bytes: Vec<u8>) {
        match self.index.get(name) {
            Some(i) => self.entries[*i].1 = bytes,
            None => {
                self.index.insert(name.to_string(), self.entries.len());
                self.entries.push((name.to_string(), bytes));
            }
        }
    }
}

/// `^word/<base>\d*\.xml$` for the given part name stem.
fn numbered_part(name: &str, base: &str) -> bool {
    name.strip_prefix("word/")
        .and_then(|r| r.strip_prefix(base))
        .and_then(|r| r.strip_suffix(".xml"))
        .is_some_and(|digits| digits.bytes().all(|b| b.is_ascii_digit()))
}

/// The parts worth reading (the same set as `WANTED` in `docx/archive.ts`).
pub fn is_wanted(name: &str) -> bool {
    if matches!(
        name,
        "[Content_Types].xml"
            | "_rels/.rels"
            | "word/_rels/document.xml.rels"
            | "word/document.xml"
            | "word/styles.xml"
            | "word/numbering.xml"
            | "word/footnotes.xml"
            | "word/endnotes.xml"
            | "word/comments.xml"
    ) {
        return true;
    }
    if numbered_part(name, "header") || numbered_part(name, "footer") {
        return true;
    }
    name.strip_prefix("word/media/").is_some_and(|r| !r.is_empty() && !r.contains(['\n', '\r', '\u{2028}', '\u{2029}']))
}

/// A name that could leave the archive's root if it were ever used as a path.
fn is_unsafe_name(name: &str) -> bool {
    name.starts_with('/') || name.contains(['\\', '\0']) || name.split('/').any(|seg| seg == "..")
}

pub struct Limits {
    /// Sum of the declared sizes of all entries (media included).
    pub max_decompressed_bytes: u64,
    pub max_entries: usize,
    /// One `word/document.xml`.
    pub max_document_bytes: u64,
    /// Any other XML part (styles, numbering, notes, comments, headers, footers, relationships).
    pub max_xml_part_bytes: u64,
}

/// Whole megabytes, rounded half up (`Math.round(n / 1048576)`), in integers.
fn mb(n: u64) -> u64 {
    n.saturating_add(524_288) / 1_048_576
}

/// The cap on one entry's size: XML parts have their own, media only the total.
fn part_cap(name: &str, limits: &Limits) -> Option<u64> {
    if name == "word/document.xml" {
        Some(limits.max_document_bytes)
    } else if name.starts_with("word/media/") {
        None
    } else {
        Some(limits.max_xml_part_bytes)
    }
}

/// Reads the wanted parts of the archive in `bytes`. Memory: the caller's `bytes` plus the inflated parts (at most
/// `max_decompressed_bytes`); the caller drops `bytes` when this returns. No buffer is sized from a declared length
/// before that length has passed the caps above.
pub fn read_archive(bytes: &[u8], limits: &Limits) -> Result<Files, ImportError> {
    if bytes.len() < 22 || bytes[0] != 0x50 || bytes[1] != 0x4b {
        let why = if bytes.is_empty() { "The file is empty." } else { "The file is not a .docx (zip) archive." };
        return Err(ImportError::new(ImportErrorCode::InvalidZip, why));
    }
    let unreadable = |e: &dyn std::fmt::Display| ImportError::new(ImportErrorCode::InvalidZip, format!("The file is not a readable .docx archive ({e})."));
    let mut zip = ZipArchive::new(Cursor::new(bytes)).map_err(|e| unreadable(&e))?;
    let mut files = Files::default();
    let mut total: u64 = 0;
    for i in 0..zip.len() {
        if i + 1 > limits.max_entries {
            return Err(ImportError::new(ImportErrorCode::TooManyEntries, format!("The archive has more than {} entries.", limits.max_entries)));
        }
        let (name, size) = {
            let raw = zip.by_index_raw(i).map_err(|e| unreadable(&e))?;
            (raw.name().map_err(|e| unreadable(&e))?.into_owned(), raw.size())
        };
        total = total.saturating_add(size);
        if total > limits.max_decompressed_bytes {
            return Err(ImportError::new(ImportErrorCode::ArchiveTooLarge, format!("The archive would expand to more than {} MB.", mb(limits.max_decompressed_bytes))));
        }
        if name.ends_with('/') || !is_wanted(&name) || is_unsafe_name(&name) {
            continue;
        }
        if let Some(cap) = part_cap(&name, limits).filter(|cap| size > *cap) {
            return Err(ImportError::new(ImportErrorCode::ArchiveTooLarge, format!("{name} would expand to more than {} MB.", mb(cap))));
        }
        let entry = zip.by_index(i).map_err(|e| unreadable(&e))?;
        // `size` has passed the caps, so it is safe to reserve (and one reservation avoids the doubling copies of a growing Vec).
        let mut data = Vec::with_capacity(usize::try_from(size).map_err(|_| unreadable(&"an entry does not fit in memory"))?);
        // One byte more than declared: reading it proves the entry is longer than it says (and lets the CRC check run at the end of the stream).
        entry.take(size.saturating_add(1)).read_to_end(&mut data).map_err(|e| unreadable(&e))?;
        if u64::try_from(data.len()).ok() != Some(size) {
            return Err(unreadable(&"an entry does not have its declared size"));
        }
        files.insert(&name, data);
    }
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};

    pub fn build(entries: &[(&str, &[u8])], method: CompressionMethod) -> Vec<u8> {
        let mut w = ZipWriter::new(Cursor::new(Vec::new()));
        let opts = SimpleFileOptions::default().compression_method(method);
        for (n, b) in entries {
            w.start_file(*n, opts).unwrap();
            w.write_all(b).unwrap();
        }
        w.finish().unwrap().into_inner()
    }

    const LIMITS: Limits = Limits { max_decompressed_bytes: 200 * 1024 * 1024, max_entries: 10_000, max_document_bytes: 64 << 20, max_xml_part_bytes: 16 << 20 };
    fn lim(total: u64, entries: usize) -> Limits {
        Limits { max_decompressed_bytes: total, max_entries: entries, ..LIMITS }
    }
    fn code(r: Result<Files, ImportError>) -> ImportErrorCode {
        r.unwrap_err().code
    }

    #[test]
    fn wanted_parts() {
        for yes in [
            "[Content_Types].xml",
            "_rels/.rels",
            "word/_rels/document.xml.rels",
            "word/document.xml",
            "word/styles.xml",
            "word/numbering.xml",
            "word/footnotes.xml",
            "word/endnotes.xml",
            "word/comments.xml",
            "word/header.xml",
            "word/header12.xml",
            "word/footer3.xml",
            "word/media/image1.png",
            "word/media/sub/x",
        ] {
            assert!(is_wanted(yes), "{yes}");
        }
        for no in ["word/theme/theme1.xml", "word/header1a.xml", "word/headers.xml", "word/media/", "word/media/a\nb.png", "word/media/a\u{2028}.png", "docProps/core.xml", "Word/document.xml", "word/document.xml.rels", "word/settings.xml", "x/word/document.xml"] {
            assert!(!is_wanted(no), "{no}");
        }
    }

    #[test]
    fn reads_wanted_parts_only_in_archive_order() {
        let z = build(
            &[("word/document.xml", b"<a/>"), ("docProps/core.xml", b"skip"), ("word/media/a.png", b"png"), ("dir/", b""), ("[Content_Types].xml", b"ct")],
            CompressionMethod::Deflated,
        );
        let f = read_archive(&z, &LIMITS).unwrap();
        assert_eq!(f.names().collect::<Vec<_>>(), ["word/document.xml", "word/media/a.png", "[Content_Types].xml"]);
        assert_eq!(f.get("word/document.xml"), Some(&b"<a/>"[..]));
        assert_eq!(f.get("docProps/core.xml"), None);
    }

    #[test]
    fn a_repeated_name_replaces_the_bytes_but_keeps_its_place() {
        // (The zip writer refuses duplicate names, so this is the map itself.)
        let mut f = Files::default();
        f.insert("a", vec![1]);
        f.insert("b", vec![2]);
        f.insert("a", vec![3]);
        assert_eq!(f.names().collect::<Vec<_>>(), ["a", "b"]);
        assert_eq!(f.get("a"), Some(&[3u8][..]));
    }

    #[test]
    fn stored_entries_are_read_too() {
        let z = build(&[("word/document.xml", b"<a/>")], CompressionMethod::Stored);
        assert_eq!(read_archive(&z, &LIMITS).unwrap().get("word/document.xml"), Some(&b"<a/>"[..]));
    }

    #[test]
    fn names_that_could_climb_out_are_skipped() {
        let z = build(
            &[("word/media/../../evil.png", b"x"), ("/word/media/abs.png", b"x"), ("word/media/a\\b.png", b"x"), ("word/media/ok.png", b"ok")],
            CompressionMethod::Stored,
        );
        let f = read_archive(&z, &LIMITS).unwrap();
        assert_eq!(f.names().collect::<Vec<_>>(), ["word/media/ok.png"]);
    }

    #[test]
    fn refuses_empty_short_and_non_zip_input() {
        assert_eq!(code(read_archive(&[], &LIMITS)), ImportErrorCode::InvalidZip);
        assert_eq!(read_archive(&[], &LIMITS).unwrap_err().message, "The file is empty.");
        assert_eq!(read_archive(b"hello world, not a zip file at all", &LIMITS).unwrap_err().message, "The file is not a .docx (zip) archive.");
        assert_eq!(code(read_archive(b"PK\x03\x04", &LIMITS)), ImportErrorCode::InvalidZip);
        let mut fake = vec![0x50, 0x4b, 3, 4];
        fake.extend([7u8; 40]);
        assert_eq!(code(read_archive(&fake, &LIMITS)), ImportErrorCode::InvalidZip);
        let good = build(&[("word/document.xml", b"<a/>")], CompressionMethod::Deflated);
        assert_eq!(code(read_archive(&good[..good.len() - 30], &LIMITS)), ImportErrorCode::InvalidZip);
    }

    #[test]
    fn enforces_the_entry_count_and_declared_size_caps_in_archive_order() {
        let many: Vec<(String, Vec<u8>)> = (0..50).map(|i| (format!("junk/{i}.txt"), b"x".to_vec())).collect();
        let refs: Vec<(&str, &[u8])> = many.iter().map(|(n, b)| (n.as_str(), b.as_slice())).collect();
        let z = build(&refs, CompressionMethod::Stored);
        assert_eq!(code(read_archive(&z, &lim(1 << 20, 10))), ImportErrorCode::TooManyEntries);
        assert!(read_archive(&z, &lim(1 << 20, 50)).is_ok());
        let z = build(&[("word/document.xml", b"0123456789")], CompressionMethod::Stored);
        let e = read_archive(&z, &lim(5, 10)).unwrap_err();
        assert_eq!(e.code, ImportErrorCode::ArchiveTooLarge);
        assert!(e.message.contains("more than 0 MB"), "{}", e.message);
        assert!(read_archive(&z, &lim(10, 10)).is_ok());
    }

    #[test]
    fn a_zip_bomb_is_refused_before_anything_is_inflated() {
        let big = vec![0u8; 12 * 1024 * 1024];
        let z = build(&[("word/document.xml", b"<d/>"), ("word/media/bomb.png", &big)], CompressionMethod::Deflated);
        assert!(z.len() < 200_000, "the archive itself is small: {}", z.len());
        let e = read_archive(&z, &lim(10 * 1024 * 1024, 10)).unwrap_err();
        assert_eq!(e.code, ImportErrorCode::ArchiveTooLarge);
        assert!(e.message.contains("10 MB"));
    }

    /// Rewrites the declared uncompressed size of the first entry in both the local header and the central directory.
    fn forge_size(z: &mut [u8], real: u32, fake: u32) {
        for i in 0..z.len().saturating_sub(30) {
            let sig = u32::from_le_bytes(z[i..i + 4].try_into().unwrap());
            if sig == 0x0403_4b50 && u32::from_le_bytes(z[i + 22..i + 26].try_into().unwrap()) == real {
                z[i + 22..i + 26].copy_from_slice(&fake.to_le_bytes());
            }
            if sig == 0x0201_4b50 && u32::from_le_bytes(z[i + 24..i + 28].try_into().unwrap()) == real {
                z[i + 24..i + 28].copy_from_slice(&fake.to_le_bytes());
            }
        }
    }

    #[test]
    fn a_forged_declared_size_is_refused_not_trusted() {
        let payload = vec![7u8; 100_000];
        let mut z = build(&[("word/media/a.png", &payload)], CompressionMethod::Deflated);
        forge_size(&mut z, 100_000, 10);
        let e = read_archive(&z, &LIMITS).unwrap_err();
        assert_eq!(e.code, ImportErrorCode::InvalidZip, "an entry longer than it says: {}", e.message);
        let mut z = build(&[("word/media/a.png", &payload)], CompressionMethod::Deflated);
        forge_size(&mut z, 100_000, 200_000);
        assert_eq!(code(read_archive(&z, &LIMITS)), ImportErrorCode::InvalidZip, "an entry shorter than it says");
    }

    #[test]
    fn a_damaged_entry_fails_its_checksum() {
        let mut z = build(&[("word/media/a.png", b"stored bytes here")], CompressionMethod::Stored);
        let at = z.windows(6).position(|w| w == b"stored").unwrap();
        z[at] ^= 0xff;
        assert_eq!(code(read_archive(&z, &LIMITS)), ImportErrorCode::InvalidZip);
    }

    #[test]
    fn unsupported_compression_of_a_wanted_entry_is_refused_but_an_unwanted_one_is_ignored() {
        let mut z = build(&[("docProps/x.bin", b"abc")], CompressionMethod::Stored);
        set_method(&mut z, 99);
        assert!(read_archive(&z, &LIMITS).unwrap().names().next().is_none(), "an unwanted entry is never opened");
        let mut z = build(&[("word/media/a.png", b"abc")], CompressionMethod::Stored);
        set_method(&mut z, 99);
        assert_eq!(code(read_archive(&z, &LIMITS)), ImportErrorCode::InvalidZip);
    }

    /// Sets the compression method of every entry in the local headers and the central directory.
    fn set_method(z: &mut [u8], method: u16) {
        for i in 0..z.len().saturating_sub(12) {
            let sig = u32::from_le_bytes(z[i..i + 4].try_into().unwrap());
            if sig == 0x0403_4b50 {
                z[i + 8..i + 10].copy_from_slice(&method.to_le_bytes());
            }
            if sig == 0x0201_4b50 {
                z[i + 10..i + 12].copy_from_slice(&method.to_le_bytes());
            }
        }
    }
}
