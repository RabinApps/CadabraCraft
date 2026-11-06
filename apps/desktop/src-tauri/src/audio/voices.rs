//! The voice catalog and which voices are installed.
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Engine {
    Kokoro,
    Piper,
}

pub struct VoiceDef {
    pub id: &'static str,
    pub engine: Engine,
    /// Folder of the model archive under the voices folder.
    pub dir: &'static str,
    pub model: &'static str,
    /// Speaker id for multi-speaker models.
    pub speaker: Option<u32>,
    /// Pronunciation lexicon, relative to the voices folder (Piper voices share one).
    pub lexicon: &'static str,
    /// Primary language subtags the voice reads (`en`). The audiobook dialog offers a voice only for an edition in one of them.
    pub languages: &'static [&'static str],
}

pub const VOICES: &[VoiceDef] = &[
    VoiceDef {
        id: "kokoro-heart",
        engine: Engine::Kokoro,
        dir: "kokoro-multi-lang-v1_0",
        model: "model.onnx",
        speaker: Some(3),
        lexicon: "kokoro-multi-lang-v1_0/lexicon-us-en.txt",
        languages: &["en"],
    },
    VoiceDef {
        id: "piper-amy",
        engine: Engine::Piper,
        dir: "vits-piper-en_US-amy-low",
        model: "en_US-amy-low.onnx",
        speaker: None,
        lexicon: "lexicon-en-us.txt",
        languages: &["en"],
    },
    VoiceDef {
        id: "piper-libritts-0",
        engine: Engine::Piper,
        dir: "vits-piper-en_US-libritts_r-medium",
        model: "en_US-libritts_r-medium.onnx",
        speaker: Some(0),
        lexicon: "lexicon-en-us.txt",
        languages: &["en"],
    },
];

impl VoiceDef {
    pub(crate) fn files(&self, root: &Path) -> Vec<PathBuf> {
        let dir = root.join(self.dir);
        let mut v = vec![dir.join(self.model), dir.join("tokens.txt"), root.join(self.lexicon)];
        if self.engine == Engine::Kokoro {
            v.push(dir.join("voices.bin"));
        }
        v
    }

    pub(crate) fn installed(&self, root: &Path) -> bool {
        self.files(root).iter().all(|f| f.is_file())
    }
}

#[derive(Serialize, Debug, PartialEq)]
pub struct VoiceInfo {
    pub id: &'static str,
    pub engine: Engine,
    pub installed: bool,
    pub languages: &'static [&'static str],
}

pub fn list_voices(root: Option<&Path>) -> Vec<VoiceInfo> {
    VOICES.iter().map(|v| VoiceInfo { id: v.id, engine: v.engine, installed: root.is_some_and(|r| v.installed(r)), languages: v.languages }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn every_voice_names_the_languages_it_reads() {
        for v in list_voices(None) {
            assert!(!v.languages.is_empty(), "{}", v.id);
            assert!(v.languages.iter().all(|l| !l.is_empty() && !l.contains('-') && *l == l.to_lowercase()), "{}", v.id);
        }
        let json = serde_json::to_value(&list_voices(None)[0]).unwrap();
        assert_eq!(json["languages"], serde_json::json!(["en"]));
    }

    #[test]
    fn voices_are_installed_only_when_all_files_exist() {
        let dir = tempfile::tempdir().unwrap();
        assert!(list_voices(Some(dir.path())).iter().all(|v| !v.installed));
        assert!(list_voices(None).iter().all(|v| !v.installed));
        let amy = VOICES.iter().find(|v| v.id == "piper-amy").unwrap();
        for f in amy.files(dir.path()) {
            fs::create_dir_all(f.parent().unwrap()).unwrap();
            fs::write(f, b"x").unwrap();
        }
        let installed: Vec<_> = list_voices(Some(dir.path())).into_iter().filter(|v| v.installed).map(|v| v.id).collect();
        assert_eq!(installed, vec!["piper-amy"]);
    }
}
