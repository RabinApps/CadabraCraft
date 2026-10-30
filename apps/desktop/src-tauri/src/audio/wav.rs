//! 16-bit mono PCM WAV reading and writing.
use super::error::AudioError;

pub struct Pcm {
    pub rate: u32,
    pub samples: Vec<i16>,
}

/// Reads 16-bit mono PCM WAV, which is what the engine writes. Anything else is refused rather than guessed at.
pub fn parse_wav(b: &[u8]) -> Result<Pcm, AudioError> {
    let bad = |what: &str| AudioError::Synth { message: format!("the engine wrote an unreadable WAV file: {what}") };
    if b.len() < 12 || &b[..4] != b"RIFF" || &b[8..12] != b"WAVE" {
        return Err(bad("no RIFF header"));
    }
    let (mut at, mut rate) = (12usize, None);
    while at + 8 <= b.len() {
        let id = &b[at..at + 4];
        let size = u32::from_le_bytes([b[at + 4], b[at + 5], b[at + 6], b[at + 7]]) as usize;
        let body = at + 8;
        if id == b"fmt " {
            let f = b.get(body..body + 16).ok_or_else(|| bad("short fmt chunk"))?;
            let (tag, channels, hz, bits) = (u16::from_le_bytes([f[0], f[1]]), u16::from_le_bytes([f[2], f[3]]), u32::from_le_bytes([f[4], f[5], f[6], f[7]]), u16::from_le_bytes([f[14], f[15]]));
            if tag != 1 || channels != 1 || bits != 16 || hz == 0 || hz > MAX_RATE {
                return Err(bad("expected 16-bit mono PCM"));
            }
            rate = Some(hz);
        } else if id == b"data" {
            let rate = rate.ok_or_else(|| bad("data before fmt"))?;
            let end = body.saturating_add(size).min(b.len()); // streamed files may claim more than they hold
            return Ok(Pcm { rate, samples: b[body..end].as_chunks::<2>().0.iter().map(|c| i16::from_le_bytes(*c)).collect() });
        }
        at = body.saturating_add(size).saturating_add(size & 1);
    }
    Err(bad("no data chunk"))
}

/// Highest sample rate written or read (well above any speech voice; guards `rate * 2` and absurd headers).
pub const MAX_RATE: u32 = 768_000;

/// The 44-byte header of a 16-bit mono PCM WAV with `samples` samples. Errors instead of wrapping when the rate is zero
/// or above `MAX_RATE`, or when the data does not fit the 32-bit sizes WAV has (4 GiB).
fn wav_header(rate: u32, samples: usize) -> Result<[u8; 44], String> {
    if rate == 0 || rate > MAX_RATE {
        return Err(format!("a sample rate of {rate} Hz cannot be written as a WAV file"));
    }
    let too_long = || "the audio is too long for a WAV file (4 GiB limit)".to_string();
    let data = samples.checked_mul(2).and_then(|d| u32::try_from(d).ok()).ok_or_else(too_long)?;
    let riff = data.checked_add(36).ok_or_else(too_long)?;
    let mut h = [0u8; 44];
    h[0..4].copy_from_slice(b"RIFF");
    h[4..8].copy_from_slice(&riff.to_le_bytes());
    h[8..16].copy_from_slice(b"WAVEfmt ");
    h[16..20].copy_from_slice(&16u32.to_le_bytes());
    h[20..24].copy_from_slice(&[1, 0, 1, 0]);
    h[24..28].copy_from_slice(&rate.to_le_bytes());
    h[28..32].copy_from_slice(&(rate * 2).to_le_bytes()); // cannot overflow: rate <= MAX_RATE
    h[32..36].copy_from_slice(&[2, 0, 16, 0]);
    h[36..40].copy_from_slice(b"data");
    h[40..44].copy_from_slice(&data.to_le_bytes());
    Ok(h)
}

pub fn write_wav(rate: u32, samples: &[i16]) -> Result<Vec<u8>, String> {
    let header = wav_header(rate, samples.len())?;
    let mut out = Vec::with_capacity(44 + samples.len() * 2);
    out.extend_from_slice(&header);
    for s in samples {
        out.extend_from_slice(&s.to_le_bytes());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wav_round_trips_and_refuses_other_formats() {
        let samples: Vec<i16> = (0..100).map(|i| (i * 300 - 15000) as i16).collect();
        let pcm = parse_wav(&write_wav(24000, &samples).unwrap()).unwrap();
        assert_eq!((pcm.rate, pcm.samples), (24000, samples));
        assert!(matches!(parse_wav(b"not a wav file at all"), Err(AudioError::Synth { .. })));
        let mut stereo = write_wav(24000, &[1, 2]).unwrap();
        stereo[22] = 2;
        assert!(parse_wav(&stereo).is_err());
        let mut streamed = write_wav(24000, &[5, 6, 7]).unwrap();
        streamed[40..44].copy_from_slice(&u32::MAX.to_le_bytes());
        assert_eq!(parse_wav(&streamed).unwrap().samples, vec![5, 6, 7]);
    }

    fn chunk(id: &[u8; 4], body: &[u8]) -> Vec<u8> {
        let mut out = id.to_vec();
        out.extend((body.len() as u32).to_le_bytes());
        out.extend(body);
        out.extend(std::iter::repeat_n(0, body.len() & 1)); // chunks are padded to an even size
        out
    }

    fn riff(chunks: &[Vec<u8>]) -> Vec<u8> {
        let body: Vec<u8> = chunks.concat();
        [b"RIFF".to_vec(), (4 + body.len() as u32).to_le_bytes().to_vec(), b"WAVE".to_vec(), body].concat()
    }

    fn fmt() -> Vec<u8> {
        chunk(b"fmt ", &[1, 0, 1, 0, 0x80, 0x3e, 0, 0, 0, 0x7d, 0, 0, 2, 0, 16, 0]) // PCM, mono, 16000 Hz, 16 bit
    }

    #[test]
    fn unknown_chunks_are_skipped_and_odd_sized_ones_are_padded() {
        let wav = riff(&[chunk(b"LIST", b"odd"), fmt(), chunk(b"data", &[9, 0, 8, 0])]);
        let pcm = parse_wav(&wav).unwrap();
        assert_eq!((pcm.rate, pcm.samples), (16000, vec![9, 8]));
    }

    #[test]
    fn a_file_without_samples_or_with_a_broken_layout_is_refused() {
        assert!(matches!(parse_wav(&riff(&[fmt()])), Err(AudioError::Synth { message }) if message.contains("no data chunk")));
        assert!(matches!(parse_wav(&riff(&[chunk(b"data", &[1, 0]), fmt()])), Err(AudioError::Synth { message }) if message.contains("data before fmt")));
        assert!(matches!(parse_wav(&riff(&[chunk(b"fmt ", &[1, 0, 1, 0])])), Err(AudioError::Synth { message }) if message.contains("short fmt chunk")));
    }

    #[test]
    fn the_header_refuses_what_wav_cannot_hold() {
        let ok = |rate, n| wav_header(rate, n);
        assert!(ok(MAX_RATE, 10).is_ok() && ok(1, 0).is_ok());
        for rate in [0, MAX_RATE + 1, u32::MAX] {
            assert!(ok(rate, 10).unwrap_err().contains("sample rate"), "{rate}");
        }
        // Data of exactly u32::MAX - 36 bytes fits; one more sample does not. Sizes that wrap a u32 or a usize are errors too.
        let fits = (u32::MAX as usize - 36) / 2;
        assert!(ok(24000, fits).is_ok());
        for n in [fits + 1, u32::MAX as usize / 2 + 1, usize::MAX / 2 + 1, usize::MAX] {
            assert!(ok(24000, n).unwrap_err().contains("too long"), "{n}");
        }
        let h = ok(24000, 5).unwrap();
        assert_eq!(u32::from_le_bytes(h[4..8].try_into().unwrap()), 46);
        assert_eq!(u32::from_le_bytes(h[28..32].try_into().unwrap()), 48000);
        assert_eq!(write_wav(0, &[1]).unwrap_err(), "a sample rate of 0 Hz cannot be written as a WAV file");
        assert!(write_wav(24000, &[]).is_ok(), "zero samples make a valid empty WAV");
    }

    #[test]
    fn a_header_with_an_absurd_sample_rate_is_refused_when_reading() {
        let mut wav = write_wav(24000, &[1, 2]).unwrap();
        wav[24..28].copy_from_slice(&(MAX_RATE + 1).to_le_bytes());
        assert!(parse_wav(&wav).is_err());
        wav[24..28].copy_from_slice(&MAX_RATE.to_le_bytes());
        assert_eq!(parse_wav(&wav).unwrap().rate, MAX_RATE);
    }
}
