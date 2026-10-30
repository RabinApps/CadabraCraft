#![no_main]
//! `fonts::import::family_name`: an imported .ttf/.otf is untrusted; any bytes give a clean family name or an error.
use cadabracraft_fuzz::fonts::import::family_name;
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    if let Ok(name) = family_name(data) {
        assert!(!name.is_empty() && name.chars().count() <= 100 && !name.chars().any(char::is_control));
    }
});
