//! The catalog of downloadable voice packs: pinned URLs, sizes and hashes.
use super::download::{io_err, part_path};
use super::error::{other, AudioError};
use serde::Serialize;
use std::fs;
use std::path::Path;

pub struct RemoteFile {
    /// Path under the voices folder (the layout `voices.rs` expects).
    pub rel: &'static str,
    pub url: &'static str,
    pub size: u64,
    pub sha256: &'static str,
}

pub struct Pack {
    pub id: &'static str,
    /// Voice ids (`voices::VOICES`) this pack installs.
    pub voices: &'static [&'static str],
    pub files: &'static [RemoteFile],
}

/// A file of a Hugging Face repo at a pinned commit (never `main`, which can change under us).
macro_rules! hf {
    ($repo:literal, $commit:literal, $name:literal) => {
        concat!("https://huggingface.co/csukuangfj/", $repo, "/resolve/", $commit, "/", $name)
    };
}

macro_rules! file {
    ($rel:literal, $url:expr, $size:literal, $sha:literal) => {
        RemoteFile { rel: $rel, url: $url, size: $size, sha256: $sha }
    };
}

/// Sizes and hashes match the Hugging Face LFS metadata and the files the engine was tested with (docs/architecture.md).
pub const PACKS: &[Pack] = &[
    Pack {
        id: "piper",
        voices: &["piper-amy", "piper-libritts-0"],
        files: &[
            file!(
                "vits-piper-en_US-amy-low/en_US-amy-low.onnx",
                hf!("vits-piper-en_US-amy-low", "76da6ca287517a49f58b943c4c4fdb0c1e94d61f", "en_US-amy-low.onnx"),
                63104657,
                "8275b02c37c4ce6483b26a91704807e6de0c3f0bf8068e5d3b3598ab0da4253e"
            ),
            file!(
                "vits-piper-en_US-amy-low/tokens.txt",
                hf!("vits-piper-en_US-amy-low", "76da6ca287517a49f58b943c4c4fdb0c1e94d61f", "tokens.txt"),
                763,
                "42d1a69ed2b91a51928a711aa228ed9f3dc021c6d359a3e9c4f37eb1d20f80bd"
            ),
            file!(
                "vits-piper-en_US-libritts_r-medium/en_US-libritts_r-medium.onnx",
                hf!("vits-piper-en_US-libritts_r-medium", "fe872db7e697e9f2a45d09328953f1fd2a9df630", "en_US-libritts_r-medium.onnx"),
                78581047,
                "acd9425049d887a4d04681010c3b2ed143898b824e5bc1f2ef6ddaee4b11ad0e"
            ),
            file!(
                "vits-piper-en_US-libritts_r-medium/tokens.txt",
                hf!("vits-piper-en_US-libritts_r-medium", "fe872db7e697e9f2a45d09328953f1fd2a9df630", "tokens.txt"),
                954,
                "620e1aecf1a68fea3ba5850d137b0138fa2037c9b372dad13b95a2a215d0849a"
            ),
            file!(
                "lexicon-en-us.txt",
                "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/lexicon-en-us.txt",
                6305773,
                "8b67ae549a465eee78f92ecb74644ad90c3c58ce65f19c68baf85878a10ef73a"
            ),
        ],
    },
    Pack {
        id: "kokoro",
        voices: &["kokoro-heart"],
        files: &[
            file!(
                "kokoro-multi-lang-v1_0/model.onnx",
                hf!("kokoro-multi-lang-v1_0", "f7b96bb6bef5c5da4d3aa4f4e0498fbbf62dc78b", "model.onnx"),
                325560556,
                "b40f62b166ac8164b0627ef48a0b358eda0985e272fb03ef5252e7206305da11"
            ),
            file!(
                "kokoro-multi-lang-v1_0/voices.bin",
                hf!("kokoro-multi-lang-v1_0", "f7b96bb6bef5c5da4d3aa4f4e0498fbbf62dc78b", "voices.bin"),
                28200960,
                "1c5a5b983d3d50d8586d437a51f3faa2da7919ce76a013c081e65671a3447c29"
            ),
            file!(
                "kokoro-multi-lang-v1_0/tokens.txt",
                hf!("kokoro-multi-lang-v1_0", "f7b96bb6bef5c5da4d3aa4f4e0498fbbf62dc78b", "tokens.txt"),
                687,
                "6ebb6bb288f20f3ae8d004d3c2ca27697da27c037d75e81a60e2a6a663f95425"
            ),
            file!(
                "kokoro-multi-lang-v1_0/lexicon-us-en.txt",
                hf!("kokoro-multi-lang-v1_0", "f7b96bb6bef5c5da4d3aa4f4e0498fbbf62dc78b", "lexicon-us-en.txt"),
                5956885,
                "7daaab53a181be9885b853a8582bf1838186317e5dadacbcef9c426d6fa0da14"
            ),
        ],
    },
];

impl Pack {
    pub fn bytes(&self) -> u64 {
        self.files.iter().map(|f| f.size).sum()
    }

    /// Every file is there with exactly the pinned size. A file only gets its final name after its hash matched.
    pub fn installed(&self, root: &Path) -> bool {
        self.files.iter().all(|f| fs::metadata(root.join(f.rel)).is_ok_and(|m| m.is_file() && m.len() == f.size))
    }
}

pub fn find_pack(id: &str) -> Result<&'static Pack, AudioError> {
    PACKS.iter().find(|p| p.id == id).ok_or_else(|| other(format!("unknown voice pack {id:?}")))
}

/// Removes the pack's files (and the folders they leave empty). Partial `.part` files are removed too.
pub fn delete_pack(pack: &Pack, root: &Path) -> Result<(), AudioError> {
    for f in pack.files {
        let path = root.join(f.rel);
        for p in [part_path(&path), path.clone()] {
            match fs::remove_file(&p) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(io_err(e)),
                _ => {}
            }
        }
        if let Some(dir) = path.parent().filter(|d| *d != root) {
            let _ = fs::remove_dir(dir); // only succeeds when empty
        }
    }
    Ok(())
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PackInfo {
    pub id: &'static str,
    pub voices: &'static [&'static str],
    /// Download size.
    pub bytes: u64,
    pub installed: bool,
}

pub fn list_packs(root: Option<&Path>) -> Vec<PackInfo> {
    PACKS.iter().map(|p| PackInfo { id: p.id, voices: p.voices, bytes: p.bytes(), installed: root.is_some_and(|r| p.installed(r)) }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;

    #[test]
    fn packs_know_their_size_when_they_are_installed_and_delete_cleanly() {
        let pack = find_pack("piper").unwrap();
        let dir = tempfile::tempdir().unwrap();
        assert!(!list_packs(Some(dir.path())).iter().any(|p| p.installed));
        for f in pack.files {
            let p = dir.path().join(f.rel);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(&p, vec![0u8; f.size as usize % 1000]).unwrap(); // wrong size: not installed
        }
        assert!(!pack.installed(dir.path()));
        for f in pack.files {
            let p = dir.path().join(f.rel);
            let file = File::create(&p).unwrap();
            file.set_len(f.size).unwrap();
        }
        assert!(pack.installed(dir.path()));
        assert_eq!(list_packs(Some(dir.path())).iter().filter(|p| p.installed).map(|p| p.id).collect::<Vec<_>>(), vec!["piper"]);
        assert_eq!(list_packs(None).iter().filter(|p| p.installed).count(), 0);
        fs::write(part_path(&dir.path().join(pack.files[0].rel)), b"x").unwrap();
        delete_pack(pack, dir.path()).unwrap();
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
        delete_pack(pack, dir.path()).unwrap(); // deleting twice is fine
        assert!(find_pack("nope").is_err());
    }

    #[test]
    fn the_catalog_is_well_formed_and_pinned() {
        let mut rels = std::collections::HashSet::new();
        for p in PACKS {
            assert!(!p.files.is_empty() && !p.voices.is_empty());
            for v in p.voices {
                assert!(crate::audio::voices::VOICES.iter().any(|d| d.id == *v), "{v}");
            }
            for f in p.files {
                assert!(rels.insert(f.rel), "duplicate {}", f.rel);
                assert!(f.url.starts_with("https://") && !f.url.contains("/main/"), "{}", f.url);
                assert!(f.size > 0 && f.sha256.len() == 64 && f.sha256.chars().all(|c| c.is_ascii_hexdigit() && !c.is_uppercase()), "{}", f.rel);
                assert!(Path::new(f.rel).components().all(|c| matches!(c, std::path::Component::Normal(_))) && !f.rel.contains('\\'), "{}", f.rel);
                if f.url.contains("huggingface.co") {
                    let commit = f.url.split("/resolve/").nth(1).and_then(|r| r.split('/').next()).unwrap();
                    assert!(commit.len() == 40 && commit.chars().all(|c| c.is_ascii_hexdigit()), "{}", f.url);
                }
            }
        }
        // every file a voice needs is in the pack that lists it
        for v in crate::audio::voices::VOICES {
            let pack = PACKS.iter().find(|p| p.voices.contains(&v.id)).unwrap();
            assert!(v.files(Path::new("")).iter().all(|f| pack.files.iter().any(|r| Path::new(r.rel) == f.as_path())), "{}", v.id);
        }
        assert_eq!(find_pack("piper").unwrap().bytes(), 147_993_194);
        assert_eq!(find_pack("kokoro").unwrap().bytes(), 359_719_088);
    }
}
