//! The on-disk shape of a whole-book snapshot and the streaming reads of its head (used for listing).
use super::FORMAT;
use serde::de::{self, IgnoredAny, MapAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
use std::cell::RefCell;
use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::path::Path;

/// What listing needs, stored before the (large) texts so it can be read from the start of the file.
#[derive(Serialize, Deserialize)]
pub(super) struct Summary {
    pub(super) pages: Vec<String>,
    pub(super) assets: usize,
}

fn is_false(v: &bool) -> bool {
    !*v
}

/// What is stored. `pages` maps a project-relative path to the file's text. Files written before `summary` existed
/// lack it and are listed by reading them through once.
#[derive(Serialize, Deserialize)]
pub(super) struct BookFile {
    pub(super) version: u32,
    pub(super) name: String,
    pub(super) automatic: bool,
    /// Kept by the author: never pruned for the count or the byte limit. Written right after `automatic` (so the head
    /// holds it) and only when true, so a file that was never pinned is exactly what older versions wrote.
    #[serde(default, skip_serializing_if = "is_false")]
    pub(super) pinned: bool,
    #[serde(default)]
    pub(super) summary: Option<Summary>,
    pub(super) manifest: String,
    pub(super) pages: BTreeMap<String, String>,
    pub(super) assets: Vec<String>,
}

/// The same file read without its texts (streamed, never held whole), for listing files that have no `summary` or whose
/// summary is beyond the first `HEAD_BYTES`.
#[derive(Deserialize)]
struct BookHead {
    version: u32,
    name: String,
    automatic: bool,
    #[serde(default)]
    pinned: bool,
    pages: BTreeMap<String, IgnoredAny>,
    assets: Vec<String>,
}

/// The fields listing needs, from the start of a file.
pub(super) struct Head {
    pub(super) version: u32,
    pub(super) name: String,
    pub(super) automatic: bool,
    pub(super) pinned: bool,
    pub(super) summary: Summary,
}

/// Reads fields up to `summary` and then stops by failing on purpose (`deserialize_map` would otherwise insist on
/// reading the rest of the file); the result is left in the cell.
/// With `early` it stops after `automatic` and the `pinned` that may follow it (the fields before the summary), leaving
/// the summary empty: enough to tell whether a snapshot is automatic or pinned without looking for the summary.
struct Scan<'a>(&'a RefCell<Option<Head>>, bool);

type Lead = (Option<u32>, Option<String>, Option<bool>);

impl Scan<'_> {
    /// Leaves the head in the cell (when the leading fields were all seen) and returns the error that stops the read.
    fn stop<E: de::Error>(&self, lead: Lead, pinned: bool, summary: Summary) -> E {
        if let (Some(version), Some(name), Some(automatic)) = lead {
            *self.0.borrow_mut() = Some(Head { version, name, automatic, pinned, summary });
        }
        E::custom("head complete")
    }
}

impl<'de> Visitor<'de> for Scan<'_> {
    type Value = ();

    fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.write_str("a snapshot object")
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> std::result::Result<(), A::Error> {
        let (mut version, mut name, mut automatic, mut pinned) = (None, None, None, false);
        let empty = || Summary { pages: vec![], assets: 0 };
        while let Some(key) = map.next_key::<String>()? {
            // Early: the first field after `automatic` that is not `pinned` ends the scan (the file is not pinned).
            if self.1 && automatic.is_some() && key != "pinned" {
                return Err(self.stop((version, name, automatic), pinned, empty()));
            }
            match key.as_str() {
                "version" => version = Some(map.next_value::<u32>()?),
                "name" => name = Some(map.next_value::<String>()?),
                "automatic" => automatic = Some(map.next_value::<bool>()?),
                "pinned" => {
                    pinned = map.next_value::<bool>()?;
                    if self.1 && automatic.is_some() {
                        return Err(self.stop((version, name, automatic), pinned, empty()));
                    }
                }
                "summary" => {
                    let summary = map.next_value::<Summary>()?;
                    return Err(self.stop((version, name, automatic), pinned, summary));
                }
                _ => {
                    map.next_value::<IgnoredAny>()?;
                }
            }
        }
        Ok(())
    }
}

/// The head of the snapshot at `path` from its first `limit` bytes; None when the file has no summary in them.
pub(super) fn scan_head(path: &Path, limit: u64) -> Option<Head> {
    scan(path, limit, false)
}

/// Only whether the snapshot at `path` is automatic and whether it is pinned, from its first `limit` bytes (never
/// streams the whole file).
pub(super) fn scan_flags(path: &Path, limit: u64) -> Option<(bool, bool)> {
    scan(path, limit, true).filter(|h| h.version == FORMAT).map(|h| (h.automatic, h.pinned))
}

fn scan(path: &Path, limit: u64, early: bool) -> Option<Head> {
    let mut prefix = vec![];
    fs::File::open(path).ok()?.take(limit).read_to_end(&mut prefix).ok()?;
    let found = RefCell::new(None);
    let _ = serde_json::Deserializer::from_slice(&prefix).deserialize_map(Scan(&found, early));
    found.into_inner()
}

/// The head of the snapshot at `path`: the first `limit` bytes when they hold the summary, else the whole file streamed
/// through the head fields (constant memory, whatever its size). The flag says the slow path was needed.
pub(super) fn read_head_slow(path: &Path, limit: u64) -> Option<(Head, bool)> {
    if let Some(head) = scan_head(path, limit) {
        return Some((head, false));
    }
    let file = fs::File::open(path).ok()?;
    let head: BookHead = serde_json::from_reader(std::io::BufReader::new(file)).ok()?;
    Some((
        Head {
            version: head.version,
            name: head.name,
            automatic: head.automatic,
            pinned: head.pinned,
            summary: Summary { pages: head.pages.into_keys().collect(), assets: head.assets.len() },
        },
        true,
    ))
}
