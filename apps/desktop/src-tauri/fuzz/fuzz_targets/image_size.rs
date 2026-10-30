#![no_main]
//! `project::check_image` (signature check plus `image_size`, which reads PNG, GIF, JPEG and WebP headers without decoding).
//! The first byte picks the extension, the rest is the image.
use libfuzzer_sys::fuzz_target;

const EXTS: [&str; 8] = ["png", "gif", "jpg", "jpeg", "webp", "svg", "bmp", "PNG"];

fuzz_target!(|data: &[u8]| {
    if let Some((first, rest)) = data.split_first() {
        let _ = cadabracraft_fuzz::check_image("fuzz", EXTS[*first as usize % EXTS.len()], rest);
    }
});
