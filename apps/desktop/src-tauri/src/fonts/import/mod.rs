//! Importing a `.ttf`/`.otf` file: a small hand-written reader for the font's `name` table (family name), then a copy
//! into `fonts/imported/<slug>/` through a temp file and a rename. Typst cannot read woff2, so only these two are taken.
use super::error::{invalid, io_err, other, FontError};
use super::store::{installed_in, InstalledFont, IMPORTED_DIR, IMPORTED_PREFIX};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

pub const MAX_FONT_BYTES: u64 = 25 * 1024 * 1024;
/// Same limit as the book's font settings (`manifest.fonts`).
const MAX_FAMILY_CHARS: usize = 100;

fn u16_at(b: &[u8], at: usize) -> Option<usize> {
    Some(u16::from_be_bytes(b.get(at..at.checked_add(2)?)?.try_into().ok()?) as usize)
}

fn u32_at(b: &[u8], at: usize) -> Option<usize> {
    Some(u32::from_be_bytes(b.get(at..at.checked_add(4)?)?.try_into().ok()?) as usize)
}

/// The Mac OS Roman characters for the bytes 0x80..=0xFF (0xCA is a no-break space, 0xF0 the Apple logo's private-use
/// code point).
const MAC_ROMAN_HIGH: &str =
    "ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»…\u{a0}ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔ\u{f8ff}ÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ";

fn mac_roman(bytes: &[u8]) -> String {
    let high: Vec<char> = MAC_ROMAN_HIGH.chars().collect();
    bytes.iter().map(|&b| if b < 0x80 { b as char } else { high[b as usize - 0x80] }).collect()
}

fn utf16_be(bytes: &[u8]) -> Option<String> {
    if !bytes.len().is_multiple_of(2) {
        return None;
    }
    let units: Vec<u16> = (0..bytes.len() / 2).map(|i| u16::from_be_bytes([bytes[2 * i], bytes[2 * i + 1]])).collect();
    String::from_utf16(&units).ok()
}

/// A usable family name: not blank, at most 100 characters, no control characters.
fn clean_name(s: &str) -> Option<String> {
    let s = s.trim();
    (!s.is_empty() && s.chars().count() <= MAX_FAMILY_CHARS && !s.chars().any(char::is_control)).then(|| s.to_string())
}

/// The font's family name: name id 16 (typographic family) when there is one, else id 1. Windows (platform 3,
/// UTF-16BE, English first) and Unicode (platform 0) records come before Macintosh Roman (platform 1, encoding 0).
pub fn family_name(font: &[u8]) -> Result<String, FontError> {
    match font.get(0..4) {
        Some([0, 1, 0, 0]) | Some(b"OTTO") | Some(b"true") => {}
        Some(b"ttcf") => return Err(invalid("font collections (.ttc) are not supported; import a single .ttf or .otf file")),
        _ => return Err(invalid("this file is not a TrueType or OpenType font")),
    }
    let bad = || invalid("the font file is damaged (its table directory is cut off)");
    let tables = u16_at(font, 4).ok_or_else(bad)?;
    let find = |tag: &[u8; 4]| -> Result<Option<(usize, usize)>, FontError> {
        for i in 0..tables {
            let at = 12 + 16 * i;
            let rec = font.get(at..at + 16).ok_or_else(bad)?;
            if &rec[0..4] == tag {
                return Ok(Some((u32_at(rec, 8).ok_or_else(bad)?, u32_at(rec, 12).ok_or_else(bad)?)));
            }
        }
        Ok(None)
    };
    if find(b"head")?.is_none() {
        return Err(invalid("this file has no font header table, so it is not a usable font"));
    }
    let (offset, length) = find(b"name")?.ok_or_else(|| invalid("this font has no name table, so it has no family name"))?;
    let table = offset.checked_add(length).and_then(|end| font.get(offset..end)).ok_or_else(|| invalid("the font's name table is cut off"))?;
    let count = u16_at(table, 2).ok_or_else(|| invalid("the font's name table is empty"))?;
    let strings = u16_at(table, 4).ok_or_else(|| invalid("the font's name table is empty"))?;
    for name_id in [16usize, 1] {
        let mut best: Option<(u8, String)> = None;
        for i in 0..count {
            let Some(rec) = table.get(6 + 12 * i..6 + 12 * i + 12) else {
                break;
            };
            let (platform, encoding, language, id, len, off) = (
                u16_at(rec, 0).unwrap_or(0),
                u16_at(rec, 2).unwrap_or(0),
                u16_at(rec, 4).unwrap_or(0),
                u16_at(rec, 6).unwrap_or(0),
                u16_at(rec, 8).unwrap_or(0),
                u16_at(rec, 10).unwrap_or(0),
            );
            if id != name_id {
                continue;
            }
            let rank = match (platform, encoding) {
                (3, 1) | (3, 10) if language == 0x409 => 0,
                (3, 1) | (3, 10) => 1,
                (0, _) => 2,
                (1, 0) if language == 0 => 3,
                (1, 0) => 4,
                _ => continue,
            };
            if best.as_ref().is_some_and(|(r, _)| *r <= rank) {
                continue;
            }
            let Some(raw) = strings.checked_add(off).and_then(|s| table.get(s..s.checked_add(len)?)) else {
                continue;
            };
            let text = if platform == 1 { Some(mac_roman(raw)) } else { utf16_be(raw) };
            if let Some(name) = text.as_deref().and_then(clean_name) {
                best = Some((rank, name));
            }
        }
        if let Some((_, name)) = best {
            return Ok(name);
        }
    }
    Err(invalid("this font has no readable family name"))
}

/// Reads a font file into memory, refusing one over 25 MB before reading it all.
pub fn read_font(path: &Path) -> Result<Vec<u8>, FontError> {
    let md = fs::metadata(path).map_err(io_err)?;
    if !md.is_file() {
        return Err(invalid("choose a font file, not a folder"));
    }
    if md.len() > MAX_FONT_BYTES {
        return Err(invalid(format!("this font file is {} MB; the limit is 25 MB", md.len() / (1024 * 1024))));
    }
    let mut bytes = Vec::with_capacity(md.len() as usize);
    fs::File::open(path).map_err(io_err)?.take(MAX_FONT_BYTES + 1).read_to_end(&mut bytes).map_err(io_err)?;
    if bytes.len() as u64 > MAX_FONT_BYTES {
        return Err(invalid("this font file is over 25 MB"));
    }
    Ok(bytes)
}

/// Lower-case letters and digits of the family, joined by single dashes: the folder name of an imported family.
pub fn slug(family: &str) -> String {
    let mut out = String::new();
    for c in family.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.is_empty() && !out.ends_with('-') {
            out.push('-');
        }
    }
    out.trim_end_matches('-').chars().take(60).collect::<String>().trim_end_matches('-').to_string()
}

/// The file's own name made safe for a folder: letters, digits, `.`, `-` and `_`, and a lower-case `.ttf`/`.otf`.
fn safe_file_name(src: &Path) -> Result<String, FontError> {
    let ext = src.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).unwrap_or_default();
    if ext != "ttf" && ext != "otf" {
        return Err(invalid("only .ttf and .otf fonts can be imported (PDF export cannot read .woff2)"));
    }
    let stem: String = src
        .file_stem()
        .map(|s| s.to_string_lossy().chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' }).collect())
        .unwrap_or_default();
    let stem = stem.trim_matches(|c| c == '-' || c == '.');
    Ok(format!("{}.{ext}", if stem.is_empty() { "font" } else { stem }))
}

/// A name in `dir` that is free, or that already holds exactly `bytes` (importing the same file twice adds nothing).
fn free_name(dir: &Path, name: &str, bytes: &[u8]) -> Result<(PathBuf, bool), FontError> {
    let (stem, ext) = name.rsplit_once('.').unwrap_or((name, "ttf"));
    for n in 1..100 {
        let candidate = dir.join(if n == 1 { name.to_string() } else { format!("{stem}-{n}.{ext}") });
        match fs::read(&candidate) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok((candidate, false)),
            Err(e) => return Err(io_err(e)),
            Ok(existing) if existing == bytes => return Ok((candidate, true)),
            Ok(_) => {}
        }
    }
    Err(other("too many files with this name are already imported"))
}

/// Copies the font at `src` into `<fonts_root>/imported/<slug>/` and returns the installed family. The file is checked
/// first (type, size, a readable family name) and written through a temp file and a rename.
pub fn import_font(src: &Path, fonts_root: &Path) -> Result<InstalledFont, FontError> {
    let name = safe_file_name(src)?;
    let bytes = read_font(src)?;
    let family = family_name(&bytes)?;
    let slug = slug(&family);
    if slug.is_empty() {
        return Err(invalid("the font's family name has no letters or digits"));
    }
    let dir = fonts_root.join(IMPORTED_DIR).join(&slug);
    fs::create_dir_all(&dir).map_err(io_err)?;
    let (dest, exists) = free_name(&dir, &name, &bytes)?;
    if !exists {
        let mut tmp = tempfile::Builder::new().prefix(".import-").suffix(".part").tempfile_in(&dir).map_err(io_err)?;
        tmp.write_all(&bytes).and_then(|()| tmp.as_file().sync_all()).map_err(io_err)?;
        tmp.persist(&dest).map_err(|e| io_err(e.error))?;
    }
    installed_in(&dir, format!("{IMPORTED_PREFIX}{slug}"), family, super::store::Source::Imported)
        .ok_or_else(|| other("the imported font could not be found after copying"))
}

#[cfg(test)]
pub(crate) mod tests;
