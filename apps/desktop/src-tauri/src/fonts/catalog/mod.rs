//! The catalog of downloadable font families: SIL Open Font Licence families from the `google/fonts` repository, each
//! file pinned to one commit (never a branch) with its size and sha256, plus the family's licence text.
//!
//! Pinned to google/fonts commit 9862abc066c9b83bf84c3e8ed1fc2d8d48f9bbf0 (committed 2026-10-28, fetched and hashed
//! 2026-10-28). To update: pick a new commit, re-fetch every file once, and replace the commit, sizes and hashes together.
//! Static TTF files are used where the repository has them; otherwise the variable TTF (Typst reads both, never woff2).
//! A variable font's file name here ends in `-VF` (the upstream names have brackets); the URL keeps the upstream name.
use serde::Serialize;
use std::fs;
use std::path::Path;

pub struct RemoteFile {
    /// Name inside the family's folder (`fonts/<id>/<name>`).
    pub name: &'static str,
    pub url: &'static str,
    pub size: u64,
    pub sha256: &'static str,
}

pub struct Family {
    pub id: &'static str,
    pub family: &'static str,
    /// One label per font file, in file order.
    pub styles: &'static [&'static str],
    pub files: &'static [RemoteFile],
    /// The OFL text. Downloaded with the fonts and kept next to them.
    pub licence: RemoteFile,
}

/// A file of the `google/fonts` repo at the pinned commit; `$path` is already percent-encoded.
macro_rules! file {
    ($name:literal, $path:literal, $size:literal, $sha:literal) => {
        RemoteFile { name: $name, url: concat!("https://raw.githubusercontent.com/google/fonts/9862abc066c9b83bf84c3e8ed1fc2d8d48f9bbf0/ofl/", $path), size: $size, sha256: $sha }
    };
}

pub const LICENCE: &str = "OFL-1.1";

mod data_display;
mod data_mono;
mod data_sans;
mod data_serif;
mod data_serif_modern;

/// Every family, grouped by kind of face.
const GROUPS: [&[Family]; 5] = [
    data_serif::SERIF,
    data_serif_modern::SERIF_MODERN,
    data_sans::SANS,
    data_mono::MONO,
    data_display::DISPLAY,
];

/// All families of the catalog, in display order.
pub fn families() -> impl Iterator<Item = &'static Family> {
    GROUPS.iter().flat_map(|g| g.iter())
}

impl Family {
    /// Download size: the fonts and the licence text.
    pub fn bytes(&self) -> u64 {
        self.files.iter().map(|f| f.size).sum::<u64>() + self.licence.size
    }

    /// Every file (fonts and licence) is there with exactly the pinned size. A file only gets its final name after its
    /// hash matched.
    pub fn installed(&self, root: &Path) -> bool {
        let dir = root.join(self.id);
        self.files
            .iter()
            .chain(std::iter::once(&self.licence))
            .all(|f| fs::metadata(dir.join(f.name)).is_ok_and(|m| m.is_file() && m.len() == f.size))
    }
}

pub fn find_family(id: &str) -> Option<&'static Family> {
    families().find(|f| f.id == id)
}

/// Where a family's licence text lives, for the "Licence" link of the UI.
pub fn licence_url(f: &Family) -> &'static str {
    f.licence.url
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FontPackInfo {
    pub id: &'static str,
    pub family: &'static str,
    pub styles: &'static [&'static str],
    pub bytes: u64,
    pub installed: bool,
    pub licence: &'static str,
    pub licence_url: &'static str,
}

pub fn list_catalog(root: Option<&Path>) -> Vec<FontPackInfo> {
    families()
        .map(|f| FontPackInfo {
            id: f.id,
            family: f.family,
            styles: f.styles,
            bytes: f.bytes(),
            installed: root.is_some_and(|r| f.installed(r)),
            licence: LICENCE,
            licence_url: licence_url(f),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn all_files(f: &Family) -> impl Iterator<Item = &RemoteFile> {
        f.files.iter().chain(std::iter::once(&f.licence))
    }

    #[test]
    fn the_catalog_has_about_forty_families_with_unique_ids_and_family_names() {
        assert!(
            (35..=45).contains(&families().count()),
            "{} families",
            families().count()
        );
        assert_eq!(
            families().map(|f| f.id).collect::<HashSet<_>>().len(),
            families().count()
        );
        assert_eq!(
            families()
                .map(|f| f.family)
                .collect::<HashSet<_>>()
                .len(),
            families().count()
        );
        for f in families() {
            assert!(
                f.id.bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-'),
                "{}",
                f.id
            );
            assert!(
                !f.id.starts_with("imported"),
                "{} would collide with imported fonts",
                f.id
            );
            assert!(!f.family.trim().is_empty());
        }
    }

    #[test]
    fn every_file_is_pinned_to_a_40_hex_commit_over_https_with_a_size_and_a_hash() {
        let prefix = "https://raw.githubusercontent.com/google/fonts/";
        for f in families() {
            for file in all_files(f) {
                let rest = file
                    .url
                    .strip_prefix(prefix)
                    .unwrap_or_else(|| panic!("{}: {}", f.id, file.url));
                let (commit, path) = rest.split_once('/').unwrap();
                assert!(
                    commit.len() == 40
                        && commit
                            .bytes()
                            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')),
                    "{}: commit {commit}",
                    f.id
                );
                assert!(path.starts_with("ofl/"), "{}: {path}", f.id);
                assert!(
                    !file.url.contains(['[', ']', ' ', ',']),
                    "{}: unencoded url {}",
                    f.id,
                    file.url
                );
                assert!(file.size > 0, "{}", file.name);
                assert!(
                    file.sha256.len() == 64
                        && file
                            .sha256
                            .bytes()
                            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')),
                    "{}: {}",
                    f.id,
                    file.name
                );
            }
        }
        let commits: HashSet<_> = families()
            .flat_map(all_files)
            .map(|f| f.url[prefix.len()..prefix.len() + 40].to_string())
            .collect();
        assert_eq!(commits.len(), 1, "one commit for the whole catalog");
    }

    #[test]
    fn fonts_are_ttf_or_otf_files_with_safe_unique_names_and_a_style_each() {
        for f in families() {
            assert!(!f.files.is_empty());
            assert_eq!(
                f.styles.len(),
                f.files.len(),
                "{}: one style per file",
                f.id
            );
            let names: HashSet<_> = f.files.iter().map(|x| x.name).collect();
            assert_eq!(names.len(), f.files.len(), "{}: duplicate file names", f.id);
            for file in f.files {
                let lower = file.name.to_ascii_lowercase();
                assert!(
                    lower.ends_with(".ttf") || lower.ends_with(".otf"),
                    "{}: {}",
                    f.id,
                    file.name
                );
                assert!(
                    file.name
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_')),
                    "{}",
                    file.name
                );
                assert!(
                    file.url.to_ascii_lowercase().ends_with(".ttf")
                        || file.url.to_ascii_lowercase().ends_with(".otf")
                );
            }
        }
    }

    #[test]
    fn every_family_ships_its_licence_text() {
        for f in families() {
            assert_eq!(f.licence.name, "OFL.txt", "{}", f.id);
            assert!(f.licence.url.ends_with("/OFL.txt"), "{}", f.id);
            assert!(
                (1_000..20_000).contains(&f.licence.size),
                "{}: {}",
                f.id,
                f.licence.size
            );
        }
        let info = list_catalog(None);
        assert!(info.iter().all(|i| i.licence == "OFL-1.1"
            && i.licence_url.ends_with("/OFL.txt")
            && !i.installed
            && i.bytes > 0));
    }

    #[test]
    fn the_catalog_covers_the_faces_authors_ask_for() {
        for id in [
            "lora",
            "merriweather",
            "crimson-pro",
            "eb-garamond",
            "libre-baskerville",
            "source-serif-4",
            "literata",
            "cormorant-garamond",
            "pt-serif",
            "spectral",
            "playfair-display",
            "open-sans",
            "lato",
            "source-sans-3",
            "nunito-sans",
            "work-sans",
            "source-code-pro",
        ] {
            assert!(find_family(id).is_some(), "{id}");
        }
        assert!(find_family("nope").is_none());
    }

    #[test]
    fn a_family_is_installed_only_when_every_file_has_its_pinned_size() {
        let f = find_family("cardo").unwrap();
        let root = tempfile::tempdir().unwrap();
        assert!(!f.installed(root.path()));
        let dir = root.path().join(f.id);
        fs::create_dir_all(&dir).unwrap();
        for file in all_files(f) {
            fs::write(dir.join(file.name), vec![0u8; file.size as usize]).unwrap();
        }
        assert!(f.installed(root.path()));
        let info = list_catalog(Some(root.path()));
        assert!(info.iter().find(|i| i.id == "cardo").unwrap().installed);
        assert!(!info.iter().find(|i| i.id == "lora").unwrap().installed);
        fs::write(dir.join(f.files[0].name), b"short").unwrap();
        assert!(!f.installed(root.path()));
    }

    #[test]
    fn the_info_serializes_with_the_camel_case_names_of_the_bridge() {
        let v = serde_json::to_value(&list_catalog(None)[0]).unwrap();
        for key in [
            "id",
            "family",
            "styles",
            "bytes",
            "installed",
            "licence",
            "licenceUrl",
        ] {
            assert!(v.get(key).is_some(), "{key}");
        }
    }

    /// Downloads each file with the same checks as the real download (size and sha256 against the pin).
    fn download_pins(files: &[&RemoteFile], dir: &Path, https_only: bool) -> Result<(), crate::audio::error::AudioError> {
        let client = crate::audio::download::client(https_only).unwrap();
        let cancel = std::sync::atomic::AtomicBool::new(false);
        for f in files {
            let dest = dir.join(f.name);
            tauri::async_runtime::block_on(crate::audio::download::download_file(
                &client,
                f.url,
                f.size,
                f.sha256,
                &dest,
                &cancel,
                &mut |_| {},
            ))?;
        }
        Ok(())
    }

    /// Opt-in (CADABRA_NET_TESTS=1): the licence texts are small, so fetch them from the real server and check the pins.
    #[test]
    fn real_licence_files_match_their_pins() {
        let count = if std::env::var("CADABRA_NET_TESTS").as_deref() == Ok("1") {
            3
        } else {
            0
        };
        let files: Vec<&RemoteFile> = families().take(count).map(|f| &f.licence).collect();
        download_pins(&files, tempfile::tempdir().unwrap().path(), true).unwrap();
    }

    #[test]
    fn pins_are_checked_against_what_the_server_sends() {
        use crate::audio::download::stub::{self, serve, Mode};
        let body = b"licence text".to_vec();
        let url: &'static str = Box::leak(serve(body.clone(), Mode::Normal).url.into_boxed_str());
        let sha: &'static str = Box::leak(stub::sha(&body).into_boxed_str());
        let good = RemoteFile {
            name: "OFL.txt",
            url,
            size: body.len() as u64,
            sha256: sha,
        };
        let bad = RemoteFile {
            name: "BAD.txt",
            url,
            size: body.len() as u64,
            sha256: "0000000000000000000000000000000000000000000000000000000000000000",
        };
        let dir = tempfile::tempdir().unwrap();
        download_pins(&[&good], dir.path(), false).unwrap();
        assert_eq!(fs::read(dir.path().join("OFL.txt")).unwrap(), body);
        assert!(download_pins(&[&bad], dir.path(), false).is_err());
        assert!(!dir.path().join("BAD.txt").exists());
    }
}
