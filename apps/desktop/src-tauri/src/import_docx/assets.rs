//! Images found in the archive: `common/assets.ts`. Maps each source path to a unique project-relative `assets/` name.
use serde::Serialize;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, PartialEq)]
pub struct Asset {
    /// The zip entry name the image came from.
    pub source_path: String,
    /// `assets/<name>`, what the image nodes use.
    pub target_path: String,
    pub media_type: &'static str,
    pub bytes: Vec<u8>,
}

/// An asset's description without its bytes (the wire header and the contract fixtures).
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssetInfo<'a> {
    pub source_path: &'a str,
    pub target_path: &'a str,
    pub media_type: &'a str,
    pub len: usize,
}

impl Asset {
    pub fn info(&self) -> AssetInfo<'_> {
        AssetInfo { source_path: &self.source_path, target_path: &self.target_path, media_type: self.media_type, len: self.bytes.len() }
    }
}

#[derive(Default)]
pub struct AssetRegistry {
    pub assets: Vec<Asset>,
    by_source: HashMap<String, usize>,
    used: HashSet<String>,
}

/// The image media type for a file extension (lower case), if it is one the editor can show.
pub fn image_type(ext: &str) -> Option<&'static str> {
    match ext {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "svg" => Some("image/svg+xml"),
        _ => None,
    }
}

/// `/\.([A-Za-z0-9]+)$/` lower-cased, or `""`.
pub fn ext_of(path: &str) -> String {
    let tail = path.rsplit('.').next().filter(|_| path.contains('.')).unwrap_or("");
    if !tail.is_empty() && tail.chars().all(|c| c.is_ascii_alphanumeric()) {
        tail.to_ascii_lowercase()
    } else {
        String::new()
    }
}

impl AssetRegistry {
    pub fn new() -> AssetRegistry {
        AssetRegistry::default()
    }

    /// Registers an image once per source path and returns its index in `assets`.
    pub fn register(&mut self, source_path: &str, media_type: &'static str, bytes: Vec<u8>) -> usize {
        if let Some(i) = self.by_source.get(source_path) {
            return *i;
        }
        let base = source_path.rsplit(['\\', '/']).next().unwrap_or("");
        // `replace(/[^A-Za-z0-9._-]/g, "_")` works on UTF-16 units, so a character outside the BMP becomes two underscores.
        let mut name = String::new();
        for c in base.chars() {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                name.push(c);
            } else {
                name.extend(std::iter::repeat_n('_', c.len_utf16()));
            }
        }
        let name = name.trim_start_matches('.');
        let name = if name.is_empty() { "image" } else { name };
        let mut target = format!("assets/{name}");
        let mut i = 2;
        while self.used.contains(&target.to_ascii_lowercase()) {
            target = match name.rfind('.') {
                Some(dot) if dot > 0 => format!("assets/{}-{i}{}", &name[..dot], &name[dot..]),
                _ => format!("assets/{name}-{i}"),
            };
            i += 1;
        }
        self.used.insert(target.to_ascii_lowercase());
        self.assets.push(Asset { source_path: source_path.to_string(), target_path: target, media_type, bytes });
        self.by_source.insert(source_path.to_string(), self.assets.len() - 1);
        self.assets.len() - 1
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extensions_and_media_types() {
        assert_eq!(ext_of("word/media/a.PNG"), "png");
        assert_eq!(ext_of("a.tar.gz"), "gz");
        assert_eq!(ext_of("noext"), "");
        assert_eq!(ext_of("trailing."), "");
        assert_eq!(ext_of("a.b c"), "");
        assert_eq!(ext_of("é.png"), "png");
        for (e, t) in [("png", "image/png"), ("jpg", "image/jpeg"), ("jpeg", "image/jpeg"), ("gif", "image/gif"), ("webp", "image/webp"), ("svg", "image/svg+xml")] {
            assert_eq!(image_type(e), Some(t));
        }
        assert_eq!(image_type("emf"), None);
    }

    #[test]
    fn names_are_sanitised_and_unique_ignoring_case() {
        let mut r = AssetRegistry::new();
        let a = r.register("word/media/Pic.png", "image/png", vec![1]);
        assert_eq!(r.register("word/media/Pic.png", "image/png", vec![9]), a, "the same source is registered once");
        assert_eq!(r.assets[a].bytes, [1]);
        r.register("other/pic.PNG", "image/png", vec![2]);
        r.register("x/pic.png", "image/png", vec![3]);
        r.register("word/media/my pic (1).png", "image/png", vec![4]);
        r.register("word/media/..hidden.png", "image/png", vec![5]);
        r.register("word/media/\u{1F600}.png", "image/png", vec![6]);
        r.register("word/media/noext", "image/png", vec![7]);
        r.register("word/media/noext", "image/png", vec![7]);
        r.register("a/noext", "image/png", vec![8]);
        r.register("word/media/", "image/png", vec![9]);
        r.register("w\\m\\back.png", "image/png", vec![10]);
        r.register("a/.png", "image/png", vec![11]);
        let t: Vec<_> = r.assets.iter().map(|a| a.target_path.as_str()).collect();
        assert_eq!(
            t,
            ["assets/Pic.png", "assets/pic-2.PNG", "assets/pic-3.png", "assets/my_pic__1_.png", "assets/hidden.png", "assets/__.png", "assets/noext", "assets/noext-2", "assets/image", "assets/back.png", "assets/png"]
        );
        let info = r.assets[0].info();
        assert_eq!((info.source_path, info.target_path, info.media_type, info.len), ("word/media/Pic.png", "assets/Pic.png", "image/png", 1));
    }
}
