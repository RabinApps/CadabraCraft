//! Image import into `assets/`: validation, sanitized names and de-duplication.
use super::fsio::{atomic_write, hash_bytes, read_regular};
use super::paths::resolve;
use super::{ProjectError, Result};
use std::fs;
use std::path::Path;

/// Image types that may be imported into `assets/`.
pub const IMAGE_EXTENSIONS: [&str; 6] = ["png", "jpg", "jpeg", "gif", "webp", "svg"];
/// Largest image accepted, in bytes.
pub const MAX_IMAGE_BYTES: u64 = 25 * 1024 * 1024;
/// Largest image accepted, in pixels (150 megapixels): a small PNG can declare 60000 x 60000 and need 14 GB to decode.
pub const MAX_IMAGE_PIXELS: u64 = 150_000_000;

pub(crate) fn image_too_large(name: &str) -> ProjectError {
    ProjectError::TooLarge { path: name.to_string(), max_mb: MAX_IMAGE_BYTES / 1024 / 1024 }
}

pub(crate) fn image_ext(name: &str) -> Option<String> {
    let ext = Path::new(name).extension()?.to_str()?.to_ascii_lowercase();
    IMAGE_EXTENSIONS.contains(&ext.as_str()).then_some(ext)
}

/// Cheap signature check so a renamed non-image is refused. SVG must at least look like SVG text.
pub(crate) fn looks_like(ext: &str, b: &[u8]) -> bool {
    match ext {
        "png" => b.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]),
        "jpg" | "jpeg" => b.starts_with(&[0xff, 0xd8, 0xff]),
        "gif" => b.starts_with(b"GIF87a") || b.starts_with(b"GIF89a"),
        "webp" => b.len() > 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP",
        "svg" => std::str::from_utf8(b).map(|t| t.contains("<svg")).unwrap_or(false),
        _ => false,
    }
}

/// Reduces a user file name to `[A-Za-z0-9_-]` (runs of other characters become one `-`), so it is safe on every
/// platform and in XML ids.
pub fn sanitize_asset_stem(stem: &str) -> String {
    let mut out = String::new();
    for c in stem.chars() {
        let c = if c.is_ascii_alphanumeric() || c == '_' { c } else { '-' };
        if c == '-' && (out.is_empty() || out.ends_with('-')) {
            continue;
        }
        out.push(c);
    }
    let out: String = out.trim_end_matches('-').chars().take(80).collect();
    if out.is_empty() { "image".into() } else { out }
}

/// Copies an image the user picked (absolute path) into `assets/` and returns its project-relative path.
/// Never overwrites a different file: an identical existing file is reused, otherwise `-2`, `-3`... is appended.
pub fn import_image(root: &Path, source: &Path) -> Result<String> {
    let file_name = source.file_name().and_then(|n| n.to_str()).ok_or(ProjectError::InvalidFileName)?;
    image_ext(file_name).ok_or_else(|| ProjectError::UnsupportedImage { name: file_name.to_string() })?;
    let bytes = read_regular(source, MAX_IMAGE_BYTES, file_name, || image_too_large(file_name))?;
    store_image(root, file_name, &bytes)
}

/// Width and height from the image header (PNG, GIF, JPEG, WebP), without decoding. None when the header is cut short,
/// unknown or the type has no pixel size (SVG).
pub(crate) fn image_size(ext: &str, b: &[u8]) -> Option<(u64, u64)> {
    let be16 = |i: usize| b.get(i..i + 2).map(|v| u64::from(u16::from_be_bytes([v[0], v[1]])));
    let le16 = |i: usize| b.get(i..i + 2).map(|v| u64::from(u16::from_le_bytes([v[0], v[1]])));
    let le24 = |i: usize| b.get(i..i + 3).map(|v| u64::from(v[0]) | u64::from(v[1]) << 8 | u64::from(v[2]) << 16);
    match ext {
        "png" if b.get(12..16) == Some(b"IHDR") => {
            let w = b.get(16..20)?;
            let h = b.get(20..24)?;
            Some((u64::from(u32::from_be_bytes([w[0], w[1], w[2], w[3]])), u64::from(u32::from_be_bytes([h[0], h[1], h[2], h[3]]))))
        }
        "gif" => Some((le16(6)?, le16(8)?)),
        "jpg" | "jpeg" => {
            let mut i = 2;
            while i + 4 <= b.len() {
                if b[i] != 0xff {
                    return None;
                }
                let m = b[i + 1];
                match m {
                    0xff => i += 1, // fill byte
                    0x01 | 0xd0..=0xd8 => i += 2,
                    0xd9 | 0xda => return None, // end of image / start of scan: no frame header seen
                    _ => {
                        if (0xc0..=0xcf).contains(&m) && !matches!(m, 0xc4 | 0xc8 | 0xcc) {
                            return Some((be16(i + 7)?, be16(i + 5)?));
                        }
                        i += 2 + be16(i + 2)? as usize;
                    }
                }
            }
            None
        }
        "webp" => match b.get(12..16)? {
            b"VP8X" => Some((le24(24)? + 1, le24(27)? + 1)),
            b"VP8 " => Some((le16(26)? & 0x3fff, le16(28)? & 0x3fff)),
            b"VP8L" => {
                let v = b.get(21..25)?;
                let bits = u32::from_le_bytes([v[0], v[1], v[2], v[3]]);
                Some((u64::from(bits & 0x3fff) + 1, u64::from((bits >> 14) & 0x3fff) + 1))
            }
            _ => None,
        },
        _ => None,
    }
}

/// Signature and pixel-count check shared by every way an image enters the project (picker, document import, preview).
pub(crate) fn check_image(name: &str, ext: &str, bytes: &[u8]) -> Result<()> {
    if !looks_like(ext, bytes) {
        return Err(ProjectError::InvalidImage { name: name.to_string(), ext: ext.to_string() });
    }
    if let Some((w, h)) = image_size(ext, bytes) {
        if w.saturating_mul(h) > MAX_IMAGE_PIXELS {
            return Err(ProjectError::ImageDimensions { name: name.to_string(), max_megapixels: MAX_IMAGE_PIXELS / 1_000_000 });
        }
    }
    Ok(())
}

/// Validates image bytes (allowlisted extension, size, signature) and stores them in `assets/` under a sanitized,
/// de-duplicated name. Shared by the file picker import and the document importer, so both follow the same rules.
pub fn store_image(root: &Path, file_name: &str, bytes: &[u8]) -> Result<String> {
    let ext = image_ext(file_name).ok_or_else(|| ProjectError::UnsupportedImage { name: file_name.to_string() })?;
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err(image_too_large(file_name));
    }
    check_image(file_name, &ext, bytes)?;
    let stem = sanitize_asset_stem(file_name.rsplit_once('.').map_or(file_name, |(s, _)| s));
    let hash = hash_bytes(bytes);
    let mut n = 1u32;
    loop {
        let name = if n == 1 { format!("{stem}.{ext}") } else { format!("{stem}-{n}.{ext}") };
        let rel = format!("assets/{name}");
        let path = resolve(root, &rel)?;
        match fs::read(&path) {
            Ok(existing) if hash_bytes(&existing) == hash => return Ok(rel),
            Ok(_) => n += 1,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                atomic_write(&path, bytes)?;
                return Ok(rel);
            }
            Err(e) => return Err(e.into()),
        }
    }
}

/// Reads an asset's bytes for display. Only `assets/<image>` paths are served.
pub fn read_asset(root: &Path, rel: &str) -> Result<Vec<u8>> {
    if !rel.starts_with("assets/") || image_ext(rel).is_none() {
        return Err(ProjectError::NotImageAsset { path: rel.to_string() });
    }
    let path = resolve(root, rel)?;
    read_regular(&path, MAX_IMAGE_BYTES, rel, || image_too_large(rel))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::*;
    use std::path::PathBuf;

    fn tmp() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    const PNG: [u8; 12] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 1];

    fn src(d: &tempfile::TempDir, name: &str, bytes: &[u8]) -> PathBuf {
        let p = d.path().join(name);
        fs::write(&p, bytes).unwrap();
        p
    }

    #[test]
    fn import_copies_into_assets_and_sanitizes_name() {
        let (proj, out) = (tmp(), tmp());
        let s = src(&out, "My Cover (final)!.PNG", &PNG);
        let rel = import_image(proj.path(), &s).unwrap();
        assert_eq!(rel, "assets/My-Cover-final.png");
        assert_eq!(fs::read(proj.path().join(&rel)).unwrap(), PNG);
        assert!(s.exists(), "source is left alone");
        assert_eq!(sanitize_asset_stem("../../etc"), "etc");
        assert_eq!(sanitize_asset_stem("???"), "image");
    }

    #[test]
    fn import_reuses_identical_and_suffixes_different() {
        let (proj, out) = (tmp(), tmp());
        let a = src(&out, "a.png", &PNG);
        assert_eq!(import_image(proj.path(), &a).unwrap(), "assets/a.png");
        assert_eq!(import_image(proj.path(), &a).unwrap(), "assets/a.png");
        let mut other = PNG.to_vec();
        other.push(9);
        let sub = out.path().join("sub");
        fs::create_dir(&sub).unwrap();
        fs::write(sub.join("a.png"), &other).unwrap();
        assert_eq!(import_image(proj.path(), &sub.join("a.png")).unwrap(), "assets/a-2.png");
        other.push(10);
        fs::write(sub.join("a.png"), &other).unwrap();
        assert_eq!(import_image(proj.path(), &sub.join("a.png")).unwrap(), "assets/a-3.png");
        assert_eq!(fs::read(proj.path().join("assets/a.png")).unwrap(), PNG, "original untouched");
    }

    #[test]
    fn import_rejects_bad_extension_content_size_and_non_files() {
        let (proj, out) = (tmp(), tmp());
        assert!(import_image(proj.path(), &src(&out, "x.exe", &PNG)).unwrap_err().to_string().contains("unsupported"));
        assert!(import_image(proj.path(), &src(&out, "noext", &PNG)).is_err());
        assert!(import_image(proj.path(), &src(&out, "fake.png", b"not an image")).unwrap_err().to_string().contains("not a valid"));
        assert!(import_image(proj.path(), &out.path().join("missing.png")).is_err());
        let dir = out.path().join("d.png");
        fs::create_dir(&dir).unwrap();
        assert!(import_image(proj.path(), &dir).unwrap_err().to_string().contains("not a file"));
        let big = out.path().join("big.png");
        let f = fs::File::create(&big).unwrap();
        f.set_len(MAX_IMAGE_BYTES + 1).unwrap();
        assert!(import_image(proj.path(), &big).unwrap_err().to_string().contains("larger"));
        assert!(!proj.path().join("assets").exists());
    }

    #[test]
    fn store_image_sanitizes_dedupes_and_validates_bytes() {
        let proj = tmp();
        assert_eq!(store_image(proj.path(), "../Fig 1.PNG", &PNG).unwrap(), "assets/Fig-1.png");
        assert_eq!(store_image(proj.path(), "Fig 1.png", &PNG).unwrap(), "assets/Fig-1.png");
        let mut other = PNG.to_vec();
        other.push(1);
        assert_eq!(store_image(proj.path(), "Fig 1.png", &other).unwrap(), "assets/Fig-1-2.png");
        assert!(store_image(proj.path(), "x.exe", &PNG).unwrap_err().to_string().contains("unsupported"));
        assert!(store_image(proj.path(), "x.png", b"nope").unwrap_err().to_string().contains("not a valid"));
        let big = vec![0u8; MAX_IMAGE_BYTES as usize + 1];
        assert!(store_image(proj.path(), "big.png", &big).unwrap_err().to_string().contains("larger"));
    }

    #[test]
    fn import_accepts_every_allowed_type() {
        let (proj, out) = (tmp(), tmp());
        let cases: [(&str, &[u8]); 6] = [
            ("a.png", &PNG),
            ("b.jpg", &[0xff, 0xd8, 0xff, 0xe0]),
            ("c.jpeg", &[0xff, 0xd8, 0xff, 0xe0, 1]),
            ("d.gif", b"GIF89a.."),
            ("e.webp", b"RIFF\0\0\0\0WEBPVP8 "),
            ("f.svg", b"<?xml version=\"1.0\"?><svg xmlns=\"http://www.w3.org/2000/svg\"/>"),
        ];
        for (n, b) in cases {
            assert_eq!(import_image(proj.path(), &src(&out, n, b)).unwrap(), format!("assets/{n}"));
        }
    }

    #[test]
    fn read_asset_only_serves_images_under_assets() {
        let (proj, out) = (tmp(), tmp());
        let rel = import_image(proj.path(), &src(&out, "a.png", &PNG)).unwrap();
        assert_eq!(read_asset(proj.path(), &rel).unwrap(), PNG);
        write_file(proj.path(), "manuscript/x.json", "{}", None).unwrap();
        for bad in ["manuscript/x.json", "assets/../cadabra.json", "assets/notes.txt", "../a.png", "/etc/a.png", "assets/missing.png"] {
            assert!(read_asset(proj.path(), bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn image_errors_are_typed() {
        let proj = tmp();
        assert_eq!(store_image(proj.path(), "x.exe", &PNG).unwrap_err(), ProjectError::UnsupportedImage { name: "x.exe".into() });
        assert_eq!(store_image(proj.path(), "x.png", b"no").unwrap_err(), ProjectError::InvalidImage { name: "x.png".into(), ext: "png".into() });
        assert_eq!(read_asset(proj.path(), "manuscript/x.json").unwrap_err(), ProjectError::NotImageAsset { path: "manuscript/x.json".into() });
        assert_eq!(store_image(proj.path(), "big.png", &vec![0u8; MAX_IMAGE_BYTES as usize + 1]).unwrap_err(), ProjectError::TooLarge { path: "big.png".into(), max_mb: 25 });
    }

    #[test]
    fn image_import_checks_pixels_and_size_on_the_picked_file() {
        let d = tmp();
        let (proj, src) = (d.path().join("p"), d.path().join("src"));
        fs::create_dir_all(&src).unwrap();
        let mut bomb = PNG[..8].to_vec();
        bomb.extend_from_slice(&[0, 0, 0, 13, b'I', b'H', b'D', b'R', 0, 0, 0xea, 0x60, 0, 0, 0xea, 0x60, 8, 6, 0, 0, 0]);
        fs::write(src.join("bomb.png"), &bomb).unwrap();
        assert_eq!(import_image(&proj, &src.join("bomb.png")).unwrap_err(), ProjectError::ImageDimensions { name: "bomb.png".into(), max_megapixels: 150 });
        assert!(!proj.join("assets").exists(), "nothing is stored for a refused image");
        assert_eq!(import_image(&proj, &src.join("gone.png")).unwrap_err(), ProjectError::NotFound { path: "gone.png".into() });
        let mut at_limit = PNG[..8].to_vec(); // exactly 150 megapixels: 15000 x 10000
        at_limit.extend_from_slice(&[0, 0, 0, 13, b'I', b'H', b'D', b'R', 0, 0, 0x3a, 0x98, 0, 0, 0x27, 0x10, 8, 6, 0, 0, 0]);
        fs::write(src.join("edge.png"), &at_limit).unwrap();
        assert_eq!(import_image(&proj, &src.join("edge.png")).unwrap(), "assets/edge.png");
    }

    #[test]
    fn image_size_reads_jpeg_fill_bytes_and_every_webp_flavour() {
        // A JPEG marker that is not preceded by 0xff is not a frame header search we can continue.
        assert_eq!(image_size("jpg", &[0xff, 0xd8, 0, 0, 0, 0, 0, 0]), None);
        // A fill byte (0xff 0xff) before the SOF0 marker is skipped.
        let fill = [0xff, 0xd8, 0xff, 0xff, 0xc0, 0, 0x11, 8, 0, 0x10, 0, 0x20, 0, 0, 0, 0];
        assert_eq!(image_size("jpg", &fill), Some((32, 16)));
        let riff = |kind: &[u8; 4], tail: &[u8]| {
            let mut v = b"RIFF\0\0\0\0WEBP".to_vec();
            v.extend_from_slice(kind);
            v.extend_from_slice(tail);
            v
        };
        // Lossless: 14-bit width-1 and height-1 packed after the 0x2f signature byte.
        let bits: u32 = 99 | 49 << 14;
        let mut lossless = vec![0, 0, 0, 0, 0x2f];
        lossless.extend_from_slice(&bits.to_le_bytes());
        assert_eq!(image_size("webp", &riff(b"VP8L", &lossless)), Some((100, 50)));
        assert_eq!(image_size("webp", &riff(b"VP8L", &[0, 0])), None, "too short for the size field");
        assert_eq!(image_size("webp", &riff(b"ABCD", &[0; 16])), None, "unknown chunk");
    }

    #[test]
    fn storing_an_image_where_the_name_is_taken_by_a_folder_is_an_io_error() {
        let d = tmp();
        fs::create_dir_all(d.path().join("assets/a.png")).unwrap();
        assert!(matches!(store_image(d.path(), "a.png", &PNG), Err(ProjectError::Io { .. })));
    }
}
