//! Reads and writes a CadabraCraft project folder. All paths are relative to the project root.
//! Manifest parsing and migration live in `@cadabracraft/format` (TypeScript); this layer only does safe file IO.
mod assets;
mod error;
mod fsio;
mod layout;
mod pages;
mod paths;
pub mod snapshots;
mod trash;

#[cfg(test)]
mod contract_tests;

#[allow(unused_imports)] // the full public surface is kept even where nothing outside uses an item yet
pub use assets::{import_image, read_asset, sanitize_asset_stem, store_image, IMAGE_EXTENSIONS, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS};
pub(crate) use assets::{check_image, image_ext, image_too_large};
pub use error::{io_error, ProjectError};
pub use fsio::{atomic_write, hash_bytes, write_bytes};
pub(crate) use fsio::{icloud_pending, open_error, read_regular};
pub use layout::{backup_manifest, create_project, MANIFEST};
pub(crate) use pages::write_file_with;
#[allow(unused_imports)]
pub use pages::{read_file, write_file, FileRead, WriteResult, MAX_READ_BYTES};
pub(crate) use paths::free_name;
pub use paths::{require_absolute, require_project, resolve};
#[allow(unused_imports)]
pub use snapshots::SnapshotMode;
pub use trash::{list_trash, restore_trash, trash_file, TrashEntry};

type Result<T> = std::result::Result<T, ProjectError>;
