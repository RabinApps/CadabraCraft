//! Audit edge cases for WAV reading: hostile chunk sizes and cut-off files must be typed errors, never a panic or an
//! out-of-range slice.
use super::*;

fn fmt_body(tag: u16, channels: u16, hz: u32, bits: u16) -> Vec<u8> {
    let mut b = vec![];
    b.extend(tag.to_le_bytes());
    b.extend(channels.to_le_bytes());
    b.extend(hz.to_le_bytes());
    b.extend((hz * 2).to_le_bytes());
    b.extend(2u16.to_le_bytes());
    b.extend(bits.to_le_bytes());
    b
}

fn wav(chunks: &[(&[u8; 4], u32, Vec<u8>)]) -> Vec<u8> {
    let mut out = b"RIFF\0\0\0\0WAVE".to_vec();
    for (id, size, body) in chunks {
        out.extend(*id);
        out.extend(size.to_le_bytes());
        out.extend(body);
    }
    out
}

#[test]
fn files_that_are_empty_cut_off_or_only_a_header_are_refused() {
    for bytes in [
        vec![],
        b"RIFF".to_vec(),
        b"RIFF\0\0\0\0WAVE".to_vec(),
        b"RIFF\0\0\0\0WAVE\x01\x02\x03".to_vec(),
        b"RIFX\0\0\0\0WAVE".to_vec(),
        b"RIFF\0\0\0\0WAVF".to_vec(),
    ] {
        assert!(matches!(parse_wav(&bytes), Err(AudioError::Synth { .. })), "{} bytes", bytes.len());
    }
    // Every prefix of a good file is either readable (with fewer samples) or a typed error.
    let good = write_wav(24000, &[1, 2, 3, 4, 5]).unwrap();
    for n in 0..=good.len() {
        let _ = parse_wav(&good[..n]);
    }
}

#[test]
fn chunk_sizes_that_wrap_or_point_past_the_end_do_not_panic() {
    let fmt = fmt_body(1, 1, 16000, 16);
    // An unknown chunk claiming 4 GiB, then nothing: no data chunk.
    let r = parse_wav(&wav(&[(b"fmt ", 16, fmt.clone()), (b"JUNK", u32::MAX, vec![1, 2, 3])]));
    assert!(matches!(r, Err(AudioError::Synth { message }) if message.contains("no data chunk")));
    // A fmt chunk that claims more than the file holds.
    assert!(parse_wav(&wav(&[(b"fmt ", u32::MAX, fmt[..10].to_vec())])).is_err());
    // A data chunk of size 0 and one with an odd byte count: the odd byte is dropped, not read out of range.
    let empty = parse_wav(&wav(&[(b"fmt ", 16, fmt.clone()), (b"data", 0, vec![])])).unwrap();
    assert!(empty.samples.is_empty());
    let odd = parse_wav(&wav(&[(b"fmt ", 16, fmt.clone()), (b"data", 5, vec![1, 0, 2, 0, 3])])).unwrap();
    assert_eq!(odd.samples, vec![1, 2]);
    // Two fmt chunks: the last one wins, and a bad second one is refused.
    let twice = wav(&[(b"fmt ", 16, fmt.clone()), (b"fmt ", 16, fmt_body(3, 1, 16000, 16)), (b"data", 2, vec![1, 0])]);
    assert!(parse_wav(&twice).is_err());
}

#[test]
fn unsupported_formats_are_refused_by_what_they_are() {
    let data = (b"data", 2, vec![1, 0]);
    for (what, f) in [
        ("float", fmt_body(3, 1, 16000, 32)),
        ("stereo", fmt_body(1, 2, 16000, 16)),
        ("8 bit", fmt_body(1, 1, 16000, 8)),
        ("zero rate", fmt_body(1, 1, 0, 16)),
        ("rate over the limit", fmt_body(1, 1, MAX_RATE + 1, 16)),
        ("zero channels", fmt_body(1, 0, 16000, 16)),
    ] {
        let r = parse_wav(&wav(&[(b"fmt ", 16, f), (data.0, data.1, data.2.clone())]));
        assert!(matches!(r, Err(AudioError::Synth { .. })), "{what}");
    }
}

#[test]
fn writing_at_the_rate_limits_and_with_extreme_samples_round_trips() {
    for rate in [1, 8000, 24000, MAX_RATE] {
        let samples = [i16::MIN, -1, 0, 1, i16::MAX];
        let pcm = parse_wav(&write_wav(rate, &samples).unwrap()).unwrap();
        assert_eq!((pcm.rate, pcm.samples.as_slice()), (rate, &samples[..]), "{rate}");
    }
    for rate in [0, MAX_RATE + 1, u32::MAX] {
        assert!(write_wav(rate, &[0]).is_err(), "{rate}");
    }
}
