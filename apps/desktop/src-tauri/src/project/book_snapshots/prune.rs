//! Retention of whole-book snapshots: how many are kept and how many bytes they may take, with limits passed in by the
//! caller (the author's Settings) and clamped here. Pruning only ever moves files to `.cadabra/trash/`.
use super::file::scan_flags;
use super::{file_names, files_lock, parse_name, stamp_of, HEAD_BYTES, SNAPSHOTS_DIR};
use crate::project::fsio::move_to_free_copy_name;
use crate::project::resolve;
use chrono::{DateTime, Utc};
use serde::Serialize;
use std::fs;
use std::path::Path;

/// Fewest snapshots a caller can ask to keep.
pub const MIN_SNAPSHOTS: usize = 5;
/// Default number of snapshots kept.
pub const DEFAULT_SNAPSHOTS: usize = 50;
/// Most snapshots a caller can ask to keep (the hard upper bound); older ones move to the project trash.
pub const MAX_SNAPSHOTS: usize = 200;
/// Fewest bytes a caller can allow all snapshots together.
pub const MIN_TOTAL_BYTES: u64 = 100 * 1024 * 1024;
/// Default byte budget of all snapshots together.
pub const DEFAULT_TOTAL_BYTES: u64 = 1024 * 1024 * 1024;
/// Most bytes all snapshots may take together (the hard ceiling, which even pinned snapshots must fit under).
pub const MAX_TOTAL_BYTES: u64 = 4 * 1024 * 1024 * 1024;

/// How many snapshots are kept and how many bytes they may take together.
#[derive(Debug, PartialEq, Clone, Copy)]
pub struct Limits {
    pub max_count: usize,
    pub max_bytes: u64,
}

impl Limits {
    pub const DEFAULT: Limits = Limits { max_count: DEFAULT_SNAPSHOTS, max_bytes: DEFAULT_TOTAL_BYTES };

    /// The limits a caller asked for, made safe: a missing, non-finite or negative value is the default for that limit, a
    /// fraction is rounded down, and the result is held between the minimum and the hard upper bound.
    pub fn from_args(count: Option<f64>, mb: Option<f64>) -> Limits {
        let whole = |v: Option<f64>| v.filter(|v| v.is_finite() && *v >= 0.0).map(f64::floor);
        let max_count = whole(count).map_or(Self::DEFAULT.max_count, |c| (c.min(MAX_SNAPSHOTS as f64) as usize).max(MIN_SNAPSHOTS));
        let max_bytes = whole(mb).map_or(Self::DEFAULT.max_bytes, |m| ((m * 1024.0 * 1024.0).min(MAX_TOTAL_BYTES as f64) as u64).max(MIN_TOTAL_BYTES));
        Limits { max_count, max_bytes }
    }
}

/// What a prune moved to the trash.
#[derive(Serialize, Debug, PartialEq, Default, Clone)]
pub struct Pruned {
    /// Project-relative paths of every snapshot moved (they are in `.cadabra/trash` now).
    pub moved: Vec<String>,
    /// The ones among them the author had pinned: only when everything unpinned is gone and the hard byte ceiling is
    /// still exceeded. Always reported, never silent.
    pub pinned_moved: Vec<String>,
}

/// The result of the prune command: how many moved, and which of them were pinned.
#[derive(Serialize, Debug, PartialEq)]
pub struct PruneReport {
    pub moved: u32,
    pub pinned_moved: Vec<String>,
}

impl From<Pruned> for PruneReport {
    fn from(p: Pruned) -> Self {
        PruneReport { moved: u32::try_from(p.moved.len()).unwrap_or(u32::MAX), pinned_moved: p.pinned_moved }
    }
}

/// Applies the limits to the project at `root` (the prune-on-open command), keeping every snapshot that is not over.
pub fn prune_to_limits(root: &Path, limits: Limits, now: DateTime<Utc>) -> PruneReport {
    prune_book_snapshots(root, "", limits, now).into()
}

/// Moves snapshots to `.cadabra/trash/` until at most `limits.max_count` remain within `limits.max_bytes` together:
/// automatic ones first (oldest first), then the author's named ones (oldest first). Pinned snapshots are not moved for
/// the count or the byte limit; only when nothing else is left and the total still exceeds the hard ceiling
/// (`MAX_TOTAL_BYTES`) are pinned ones moved, oldest first, and then they are listed in `pinned_moved`. The snapshot at
/// `keep` (the one just taken) is never moved, and nothing is deleted. Best effort: a snapshot that cannot be moved
/// stays where it is.
///
/// Uses only file names and sizes, plus the first bytes of the files that are candidates (to see whether each is
/// automatic or pinned): never the summary or the texts, so a legacy file is not streamed through here. A file that is
/// not a snapshot of this format is neither counted nor moved.
pub(crate) fn prune_book_snapshots(root: &Path, keep: &str, limits: Limits, now: DateTime<Utc>) -> Pruned {
    prune_under_ceiling(root, keep, limits, MAX_TOTAL_BYTES, now)
}

/// `prune_book_snapshots` with the hard byte ceiling a parameter, so tests need not write gigabytes.
pub(super) fn prune_under_ceiling(root: &Path, keep: &str, limits: Limits, ceiling: u64, now: DateTime<Utc>) -> Pruned {
    let Ok(names) = file_names(root, SNAPSHOTS_DIR, false) else { return Pruned::default() };
    let mut files: Vec<((String, u32), String, u64)> = vec![];
    for name in names {
        let Some(key) = parse_name(&name) else { continue };
        let path = format!("{SNAPSHOTS_DIR}/{name}");
        let Ok(meta) = resolve(root, &path).and_then(|f| fs::metadata(f).map_err(Into::into)) else { continue };
        files.push((key, path, meta.len()));
    }
    files.sort_by(|a, b| a.0.cmp(&b.0));
    let (mut count, mut total) = (files.len(), files.iter().map(|f| f.2).sum::<u64>());
    let mut out = Pruned::default();
    let mut pending: Vec<&((String, u32), String, u64)> = files.iter().filter(|f| f.1 != keep).collect();
    // Pass 0: automatic, pass 1: named, pass 2: pinned (only past the hard ceiling).
    for pass in 0..3 {
        let mut next = vec![];
        for f in pending {
            let within = if pass < 2 { count <= limits.max_count && total <= limits.max_bytes } else { total <= ceiling };
            if within {
                return out;
            }
            let Ok(file) = resolve(root, &f.1) else { continue };
            match scan_flags(&file, HEAD_BYTES) {
                None => (count, total) = (count - 1, total - f.2), // not a snapshot: not counted, never moved
                Some((automatic, pinned)) => {
                    let class = if pinned {
                        2
                    } else if automatic {
                        0
                    } else {
                        1
                    };
                    if class != pass {
                        next.push(f);
                        continue;
                    }
                    let _held = files_lock();
                    let want = format!(".cadabra/trash/{}-snapshot__{}", stamp_of(now), f.1.rsplit('/').next().unwrap_or_default());
                    if move_to_free_copy_name(root, &file, &want, &f.1).is_ok() {
                        (count, total) = (count - 1, total - f.2);
                        out.moved.push(f.1.clone());
                        if pinned {
                            out.pinned_moved.push(f.1.clone());
                        }
                    }
                }
            }
        }
        pending = next;
    }
    out
}
