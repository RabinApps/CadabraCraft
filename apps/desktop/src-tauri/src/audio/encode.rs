//! Audio file encoders for the audiobook export: FLAC (`flacenc`, lossless) and Ogg Opus (`opus-rs` plus `ogg`).
//! Both are pure Rust, so they need no extra binaries and run on the same worker thread as the rest of a render.
//! Input is 16-bit mono PCM, which is what the voice engine writes. Errors are plain strings; `render.rs` wraps them
//! in `AudioError::Encode` with the format name.
use flacenc::bitsink::ByteSink;
use flacenc::component::BitRepr;
use flacenc::error::Verify;
use ogg::{PacketWriteEndInfo, PacketWriter};
use opus_rs::{Application, OpusEncoder};

/// 32 kbit/s mono is transparent for speech and about 14 MB per hour.
const OPUS_BITRATE: i32 = 32_000;
/// Opus always counts time at 48 kHz in Ogg: 20 ms frames, and the encoder delay the decoder must skip.
const FRAME_48K: u64 = 960;
const PRE_SKIP_48K: u64 = 312;
const OPUS_RATES: [u32; 5] = [8000, 12000, 16000, 24000, 48000];
const PAGE_PACKETS: usize = 25;

/// Error text of the encoder crates (their errors have no `Display`, so `Debug`).
fn debug_text(e: impl std::fmt::Debug) -> String {
    format!("{e:?}")
}

/// The same for an error that comes with the value it was made from, as `Verify::into_verified` returns it.
fn debug_text_of_second<T>((_, e): (T, impl std::fmt::Debug)) -> String {
    debug_text(e)
}

fn display_text(e: impl std::fmt::Display) -> String {
    e.to_string()
}

pub fn encode_flac(rate: u32, samples: &[i16]) -> Result<Vec<u8>, String> {
    if samples.is_empty() {
        return Err("there is no audio to encode".into());
    }
    let config = flacenc::config::Encoder::default().into_verified().map_err(debug_text_of_second)?;
    let pcm: Vec<i32> = samples.iter().map(|&s| s as i32).collect();
    let source = flacenc::source::MemSource::from_samples(&pcm, 1, 16, rate as usize);
    let stream = flacenc::encode_with_fixed_block_size(&config, source, config.block_size).map_err(debug_text)?;
    let mut sink = ByteSink::new();
    stream.write(&mut sink).map_err(debug_text)?;
    Ok(sink.as_slice().to_vec())
}

fn gcd(a: u32, b: u32) -> u32 {
    if b == 0 {
        a
    } else {
        gcd(b, a % b)
    }
}

/// Band-limited sample-rate conversion (Hann-windowed sinc, 32 taps, polyphase table). Good enough for speech; the
/// rates in use are 16, 22.05 and 24 kHz.
pub fn resample(x: &[i16], from: u32, to: u32) -> Result<Vec<i16>, String> {
    if from == to {
        return Ok(x.to_vec());
    }
    if from == 0 || to == 0 {
        return Err("invalid sample rate".into());
    }
    let g = gcd(from, to);
    let (up, down) = ((to / g) as usize, (from / g) as usize);
    if up > 2000 {
        return Err(format!("cannot convert {from} Hz to {to} Hz"));
    }
    const HALF: i64 = 16;
    let taps = (2 * HALF) as usize;
    let cutoff = (to as f64 / from as f64).min(1.0);
    let sinc = |v: f64| if v.abs() < 1e-9 { 1.0 } else { (std::f64::consts::PI * v).sin() / (std::f64::consts::PI * v) };
    let mut table = vec![0f32; up * taps];
    for p in 0..up {
        let frac = p as f64 / up as f64;
        let row: Vec<f64> = (0..taps)
            .map(|j| {
                let d = (j as i64 - HALF + 1) as f64 - frac;
                cutoff * sinc(cutoff * d) * 0.5 * (1.0 + (std::f64::consts::PI * d / HALF as f64).cos())
            })
            .collect();
        let sum: f64 = row.iter().sum();
        for (j, w) in row.iter().enumerate() {
            table[p * taps + j] = (*w / sum) as f32;
        }
    }
    let out_len = (x.len() as u64 * up as u64 / down as u64) as usize;
    let mut out = Vec::with_capacity(out_len);
    for n in 0..out_len {
        let pos = n as u64 * down as u64;
        let (i, p) = ((pos / up as u64) as i64, (pos % up as u64) as usize);
        let row = &table[p * taps..(p + 1) * taps];
        let mut acc = 0f32;
        for (j, w) in row.iter().enumerate() {
            let idx = i + j as i64 - HALF + 1;
            if idx >= 0 && (idx as usize) < x.len() {
                acc += w * x[idx as usize] as f32;
            }
        }
        out.push(acc.round().clamp(-32768.0, 32767.0) as i16);
    }
    Ok(out)
}

/// Mono Ogg Opus. Rates Opus does not take (22.05 kHz) are converted to 24 kHz first. `language` (a BCP 47 tag) goes into the
/// file's tags as `LANGUAGE`, which players and library tools read; a tag with odd characters is left out.
pub fn encode_opus(rate: u32, samples: &[i16], language: Option<&str>) -> Result<Vec<u8>, String> {
    if samples.is_empty() {
        return Err("there is no audio to encode".into());
    }
    let enc_rate = if OPUS_RATES.contains(&rate) {
        rate
    } else if rate < 24_000 {
        24_000
    } else {
        48_000
    };
    let pcm = resample(samples, rate, enc_rate)?;
    let frame = (enc_rate / 50) as usize;
    let mut enc = OpusEncoder::new(enc_rate as i32, 1, Application::Audio).map_err(str::to_string)?;
    enc.bitrate_bps = OPUS_BITRATE;
    enc.complexity = 10;
    enc.use_cbr = false;

    let serial = 0x4341_4442;
    let mut w = PacketWriter::new(Vec::new());
    let mut head = b"OpusHead".to_vec();
    head.extend_from_slice(&[1, 1]);
    head.extend_from_slice(&(PRE_SKIP_48K as u16).to_le_bytes());
    head.extend_from_slice(&rate.to_le_bytes());
    head.extend_from_slice(&[0, 0, 0]);
    w.write_packet(head, serial, PacketWriteEndInfo::EndPage, 0).map_err(display_text)?;
    let vendor = b"CadabraCraft";
    let mut tags = b"OpusTags".to_vec();
    tags.extend_from_slice(&(vendor.len() as u32).to_le_bytes());
    tags.extend_from_slice(vendor);
    let comments: Vec<String> = super::m4b::clean_language(language).map(|l| format!("LANGUAGE={l}")).into_iter().collect();
    tags.extend_from_slice(&(comments.len() as u32).to_le_bytes());
    for c in &comments {
        tags.extend_from_slice(&(c.len() as u32).to_le_bytes());
        tags.extend_from_slice(c.as_bytes());
    }
    w.write_packet(tags, serial, PacketWriteEndInfo::EndPage, 0).map_err(display_text)?;

    let total_48k = pcm.len() as u64 * 48_000 / enc_rate as u64;
    let frames = pcm.len().div_ceil(frame);
    let mut buf = vec![0u8; 1275];
    for (i, chunk) in pcm.chunks(frame).enumerate() {
        let mut padded;
        let input = if chunk.len() == frame {
            chunk
        } else {
            padded = chunk.to_vec();
            padded.resize(frame, 0);
            &padded
        };
        let n = enc.encode_i16(input, frame, &mut buf).map_err(str::to_string)?;
        let last = i + 1 == frames;
        let granule = if last { PRE_SKIP_48K + total_48k } else { PRE_SKIP_48K + (i as u64 + 1) * FRAME_48K };
        let end = if last {
            PacketWriteEndInfo::EndStream
        } else if (i + 1) % PAGE_PACKETS == 0 {
            PacketWriteEndInfo::EndPage
        } else {
            PacketWriteEndInfo::NormalPacket
        };
        w.write_packet(buf[..n].to_vec(), serial, end, granule).map_err(display_text)?;
    }
    Ok(w.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn sine(rate: u32, secs: f64, hz: f64) -> Vec<i16> {
        (0..(rate as f64 * secs) as usize).map(|n| ((n as f64 / rate as f64 * hz * std::f64::consts::TAU).sin() * 12000.0) as i16).collect()
    }

    /// Best normalised correlation of `b` against `a` over lags of `0..=max_lag` samples, and the lag that gave it.
    fn best_match(a: &[i16], b: &[i16], max_lag: usize) -> (f64, usize) {
        let n = a.len().min(b.len().saturating_sub(max_lag)).min(20_000);
        (0..=max_lag)
            .map(|lag| {
                let (mut ab, mut aa, mut bb) = (0f64, 0f64, 0f64);
                for i in 0..n {
                    let (x, y) = (a[i + 2000.min(a.len() / 4)] as f64, b[i + lag + 2000.min(a.len() / 4)] as f64);
                    ab += x * y;
                    aa += x * x;
                    bb += y * y;
                }
                (ab / (aa.sqrt() * bb.sqrt()).max(1.0), lag)
            })
            .fold((f64::MIN, 0), |best, c| if c.0 > best.0 { c } else { best })
    }

    #[test]
    fn resample_keeps_the_pitch_and_length() {
        let src = sine(22_050, 1.0, 440.0);
        let out = resample(&src, 22_050, 24_000).unwrap();
        assert_eq!(out.len(), 24_000);
        let reference = sine(24_000, 1.0, 440.0);
        let (corr, lag) = best_match(&reference, &out, 4);
        assert!(corr > 0.99 && lag <= 1, "corr {corr} lag {lag}");
        assert_eq!(resample(&src, 22_050, 22_050).unwrap(), src);
        assert!(resample(&src, 22_050, 0).is_err());
        assert!(resample(&[], 22_050, 24_000).unwrap().is_empty());
    }

    #[test]
    fn encoder_errors_become_plain_text() {
        assert_eq!(debug_text(Some(3)), "Some(3)");
        assert_eq!(debug_text_of_second((1, "bad")), "\"bad\"");
        assert_eq!(display_text(std::io::Error::other("boom")), "boom");
    }

    #[test]
    fn resample_refuses_rates_whose_ratio_is_too_fine() {
        assert_eq!(resample(&[1, 2, 3], 24_000, 44_101), Err("cannot convert 24000 Hz to 44101 Hz".to_string()));
    }

    #[test]
    fn opus_pads_a_last_frame_that_is_not_full() {
        // 24 kHz frames are 480 samples; 700 samples leave a partial second frame.
        let bytes = encode_opus(24_000, &sine(24_000, 700.0 / 24_000.0, 300.0), None).unwrap();
        let mut r = ogg::PacketReader::new(std::io::Cursor::new(bytes));
        r.read_packet_expected().unwrap();
        r.read_packet_expected().unwrap();
        let mut packets = 0;
        while r.read_packet().unwrap().is_some() {
            packets += 1;
        }
        assert_eq!(packets, 2);
    }

    #[test]
    fn flac_has_a_stream_header_and_refuses_empty_input() {
        let bytes = encode_flac(24_000, &sine(24_000, 0.5, 300.0)).unwrap();
        assert_eq!(&bytes[..4], b"fLaC");
        assert!(bytes.len() < 24_000);
        assert!(encode_flac(24_000, &[]).is_err());
    }

    #[test]
    fn opus_is_a_valid_ogg_stream_with_correct_headers_and_length() {
        let bytes = encode_opus(24_000, &sine(24_000, 1.0, 300.0), None).unwrap();
        let mut r = ogg::PacketReader::new(std::io::Cursor::new(bytes.clone()));
        let head = r.read_packet_expected().unwrap();
        assert_eq!(&head.data[..8], b"OpusHead");
        assert_eq!((head.data[8], head.data[9]), (1, 1));
        assert_eq!(u16::from_le_bytes([head.data[10], head.data[11]]) as u64, PRE_SKIP_48K);
        assert_eq!(&r.read_packet_expected().unwrap().data[..8], b"OpusTags");
        let (mut packets, mut last_granule) = (0, 0);
        while let Some(p) = r.read_packet().unwrap() {
            packets += 1;
            last_granule = p.absgp_page();
        }
        assert_eq!(packets, 50); // 1 s of 20 ms frames
        assert_eq!(last_granule, PRE_SKIP_48K + 48_000);
        assert!(bytes.len() < 24_000, "{}", bytes.len()); // about 32 kbit/s, nowhere near raw
        assert!(encode_opus(24_000, &[], None).is_err());
    }

    #[test]
    fn opus_carries_the_language_tag_and_leaves_out_odd_ones() {
        let find = |bytes: &[u8], needle: &[u8]| bytes.windows(needle.len()).any(|w| w == needle);
        let pcm = sine(24_000, 0.2, 300.0);
        let tagged = encode_opus(24_000, &pcm, Some("fr-CA")).unwrap();
        // OpusTags: vendor, then 1 comment of 14 bytes.
        assert!(find(&tagged, b"CadabraCraft\x01\x00\x00\x00\x0e\x00\x00\x00LANGUAGE=fr-CA"));
        for none in [None, Some(""), Some("fr\nCA"), Some("a=b")] {
            let bytes = encode_opus(24_000, &pcm, none).unwrap();
            assert!(!find(&bytes, b"LANGUAGE="), "{none:?}");
            assert!(find(&bytes, b"CadabraCraft\x00\x00\x00\x00"));
        }
    }

    #[test]
    fn opus_converts_22050_hz_input() {
        let bytes = encode_opus(22_050, &sine(22_050, 0.5, 300.0), None).unwrap();
        let mut r = ogg::PacketReader::new(std::io::Cursor::new(bytes));
        r.read_packet_expected().unwrap();
        r.read_packet_expected().unwrap();
        let mut last = 0;
        while let Some(p) = r.read_packet().unwrap() {
            last = p.absgp_page();
        }
        assert_eq!(last, PRE_SKIP_48K + 24_000);
    }

    fn ffmpeg() -> Option<&'static str> {
        let ok = Command::new("ffmpeg").arg("-version").output().is_ok_and(|o| o.status.success());
        ffmpeg_if(ok, std::env::var("REQUIRE_FFMPEG").as_deref() == Ok("1"))
    }

    fn ffmpeg_if(ok: bool, required: bool) -> Option<&'static str> {
        if !ok {
            assert!(!required, "REQUIRE_FFMPEG=1 but ffmpeg was not found");
            eprintln!("skipping: ffmpeg not installed");
        }
        ok.then_some("ffmpeg")
    }

    #[test]
    fn a_missing_ffmpeg_skips_the_decode_tests_unless_it_is_required() {
        assert_eq!(ffmpeg_if(false, false), None);
        assert_eq!(ffmpeg_if(true, true), Some("ffmpeg"));
        assert!(std::panic::catch_unwind(|| ffmpeg_if(false, true)).is_err());
    }

    /// Decodes with ffmpeg to 16-bit mono PCM at `rate`, and also returns what `ffprobe` says about the container.
    fn decode(path: &std::path::Path, rate: u32) -> (Vec<i16>, String) {
        let out = path.with_extension("raw");
        let r = Command::new("ffmpeg")
            .args(["-v", "error", "-y", "-i"])
            .arg(path)
            .args(["-f", "s16le", "-ac", "1", "-ar", &rate.to_string()])
            .arg(&out)
            .output()
            .unwrap();
        assert!(r.status.success() && r.stderr.is_empty(), "ffmpeg: {}", String::from_utf8_lossy(&r.stderr));
        let probe = Command::new("ffprobe")
            .args(["-v", "error", "-show_entries", "stream=codec_name,sample_rate,channels", "-of", "default=nw=1"])
            .arg(path)
            .output()
            .unwrap();
        (std::fs::read(out).unwrap().as_chunks::<2>().0.iter().map(|c| i16::from_le_bytes(*c)).collect(), String::from_utf8_lossy(&probe.stdout).into_owned())
    }

    #[test]
    fn ffmpeg_decodes_flac_bit_exactly() {
        let Some(_) = ffmpeg() else { return };
        let src: Vec<i16> = sine(24_000, 1.0, 200.0).iter().zip(sine(24_000, 1.0, 3100.0)).map(|(a, b)| a / 2 + b / 3).collect();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.flac");
        std::fs::write(&path, encode_flac(24_000, &src).unwrap()).unwrap();
        let (pcm, probe) = decode(&path, 24_000);
        assert_eq!(pcm, src);
        assert!(probe.contains("codec_name=flac") && probe.contains("sample_rate=24000") && probe.contains("channels=1"), "{probe}");
    }

    #[test]
    fn ffmpeg_decodes_opus_close_to_the_source_with_the_right_length() {
        let Some(_) = ffmpeg() else { return };
        for rate in [24_000u32, 22_050, 16_000] {
            let src: Vec<i16> = sine(rate, 2.0, 220.0).iter().zip(sine(rate, 2.0, 1700.0)).map(|(a, b)| a / 2 + b / 3).collect();
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("a.opus");
            std::fs::write(&path, encode_opus(rate, &src, None).unwrap()).unwrap();
            let (pcm, probe) = decode(&path, rate);
            assert!(probe.contains("codec_name=opus") && probe.contains("channels=1"), "{probe}");
            let diff = pcm.len() as i64 - src.len() as i64;
            assert!(diff.abs() <= rate as i64 / 100, "{rate}: decoded {} samples for {} in", pcm.len(), src.len());
            let (corr, lag) = best_match(&src, &pcm, 400);
            assert!(corr > 0.97, "{rate}: correlation {corr} at lag {lag}");
            assert!(lag <= 8, "{rate}: decoder delay of {lag} samples is not compensated");
        }
    }
}
