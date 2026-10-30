#![no_main]
//! `audio::wav::parse_wav`: the engine's WAV output is untrusted bytes; any input gives an error or samples.
use cadabracraft_fuzz::audio::wav::parse_wav;
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    if let Ok(pcm) = parse_wav(data) {
        assert!(pcm.rate > 0);
        assert!(pcm.samples.len() * 2 <= data.len());
    }
});
