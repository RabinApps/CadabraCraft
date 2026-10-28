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
            if tag != 1 || channels != 1 || bits != 16 || hz == 0 {
                return Err(bad("expected 16-bit mono PCM"));
            }
            rate = Some(hz);
        } else if id == b"data" {
            let rate = rate.ok_or_else(|| bad("data before fmt"))?;
            let end = body.saturating_add(size).min(b.len()); // streamed files may claim more than they hold
            return Ok(Pcm { rate, samples: b[body..end].chunks_exact(2).map(|c| i16::from_le_bytes([c[0], c[1]])).collect() });
        }
        at = body.saturating_add(size).saturating_add(size & 1);
    }
    Err(bad("no data chunk"))
}

pub fn write_wav(rate: u32, samples: &[i16]) -> Vec<u8> {
    let data = (samples.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + samples.len() * 2);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&[1, 0, 1, 0]);
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&(rate * 2).to_le_bytes());
    out.extend_from_slice(&[2, 0, 16, 0]);
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data.to_le_bytes());
    for s in samples {
        out.extend_from_slice(&s.to_le_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wav_round_trips_and_refuses_other_formats() {
        let samples: Vec<i16> = (0..100).map(|i| (i * 300 - 15000) as i16).collect();
        let pcm = parse_wav(&write_wav(24000, &samples)).unwrap();
        assert_eq!((pcm.rate, pcm.samples), (24000, samples));
        assert!(matches!(parse_wav(b"not a wav file at all"), Err(AudioError::Synth { .. })));
        let mut stereo = write_wav(24000, &[1, 2]);
        stereo[22] = 2;
        assert!(parse_wav(&stereo).is_err());
        let mut streamed = write_wav(24000, &[5, 6, 7]);
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
}
