use super::*;

fn sine(rate: u32, secs: f64, hz: f64, amp: f64) -> Vec<i16> {
    (0..(f64::from(rate) * secs) as usize)
        .map(|n| (amp * FULL_SCALE * (n as f64 / f64::from(rate) * hz * 2.0 * PI).sin()).round().clamp(-32768.0, 32767.0) as i16)
        .collect()
}

/// |H(e^jw)|^2 of one section at `hz`, from its coefficients (the same convention as `Biquad::run`).
fn power_gain(s: &Biquad, rate: f64, hz: f64) -> f64 {
    let w = 2.0 * PI * hz / rate;
    let at = |c: [f64; 3]| (c[0] + c[1] * w.cos() + c[2] * (2.0 * w).cos(), -(c[1] * w.sin() + c[2] * (2.0 * w).sin()));
    let (n, d) = (at(s.b), at([1.0, s.a[0], s.a[1]]));
    (n.0 * n.0 + n.1 * n.1) / (d.0 * d.0 + d.1 * d.1)
}

/// The loudness a sine of amplitude `amp` (full scale 1.0) should measure at 1 kHz, from the filter's own gain there.
fn expected_sine_lufs(rate: u32, amp: f64) -> f64 {
    let [shelf, hp] = k_weighting(f64::from(rate));
    let gain = power_gain(&shelf, f64::from(rate), 1000.0) * power_gain(&hp, f64::from(rate), 1000.0);
    lufs_of(amp * amp / 2.0 * gain)
}

#[test]
fn the_48k_filter_matches_the_published_bs1770_coefficients() {
    let [shelf, hp] = k_weighting(48_000.0);
    let close = |a: f64, b: f64| assert!((a - b).abs() < 1e-6, "{a} vs {b}");
    close(shelf.b[0], 1.535_124_859_586_97);
    close(shelf.b[1], -2.691_696_189_406_38);
    close(shelf.b[2], 1.198_392_810_852_85);
    close(shelf.a[0], -1.690_659_293_182_41);
    close(shelf.a[1], 0.732_480_774_215_85);
    close(hp.b[0], 1.0);
    close(hp.b[1], -2.0);
    close(hp.b[2], 1.0);
    close(hp.a[0], -1.990_047_454_833_98);
    close(hp.a[1], 0.990_072_250_366_21);
}

#[test]
fn the_k_weighting_is_nearly_flat_at_1_khz_at_any_rate() {
    let gain_db = |rate: f64| {
        let [shelf, hp] = k_weighting(rate);
        10.0 * (power_gain(&shelf, rate, 1000.0) * power_gain(&hp, rate, 1000.0)).log10()
    };
    assert!((gain_db(24_000.0) - gain_db(48_000.0)).abs() < 0.05, "{} {}", gain_db(24_000.0), gain_db(48_000.0));
    assert!((gain_db(22_050.0) - gain_db(48_000.0)).abs() < 0.05);
}

#[test]
fn a_1_khz_sine_measures_what_the_filter_gain_predicts() {
    for rate in [48_000u32, 24_000, 22_050] {
        let r = measure(rate, &sine(rate, 10.0, 1000.0, 0.1));
        let want = expected_sine_lufs(rate, 0.1);
        assert!((r.integrated_lufs - want).abs() < 0.05, "{rate} Hz: {} vs {want}", r.integrated_lufs);
        assert!((r.true_peak_dbtp - (-20.0)).abs() < 0.05, "{rate} Hz: peak {}", r.true_peak_dbtp);
    }
}

#[test]
fn halving_the_amplitude_lowers_the_loudness_by_six_decibels() {
    let loud = measure(48_000, &sine(48_000, 5.0, 1000.0, 0.1)).integrated_lufs;
    let quiet = measure(48_000, &sine(48_000, 5.0, 1000.0, 0.05)).integrated_lufs;
    assert!((loud - quiet - 6.0206).abs() < 0.02, "{}", loud - quiet);
}

#[test]
fn silence_and_too_short_audio_report_the_floor_and_do_not_pass() {
    for r in [measure(48_000, &[0; 48_000]), measure(48_000, &sine(48_000, 0.3, 1000.0, 0.1)), measure(0, &[1; 48_000]), measure(48_000, &[])] {
        assert_eq!(r.integrated_lufs, FLOOR_DB);
        assert!(!r.passed);
    }
    assert_eq!(measure(48_000, &[0; 48_000]).true_peak_dbtp, FLOOR_DB);
    assert_eq!(measure(0, &[]).true_peak_dbtp, FLOOR_DB);
}

#[test]
fn the_absolute_gate_drops_blocks_under_minus_70_lufs() {
    // A quiet tail at about -74 LUFS (under the gate) must not pull the loudness down.
    let loud = sine(48_000, 5.0, 1000.0, 0.1);
    let mut both = loud.clone();
    both.extend(sine(48_000, 5.0, 1000.0, 0.0003));
    let (alone, mixed) = (measure(48_000, &loud).integrated_lufs, measure(48_000, &both).integrated_lufs);
    assert!((alone - mixed).abs() < 0.2, "{alone} vs {mixed}");
    assert!(measure(48_000, &sine(48_000, 5.0, 1000.0, 0.0003)).integrated_lufs < -70.0);
}

#[test]
fn the_relative_gate_drops_blocks_more_than_10_lu_under_the_rest() {
    // The second half is 20 dB quieter, which is more than 10 LU under the mean of the blocks that passed the absolute gate.
    let loud = sine(48_000, 10.0, 1000.0, 0.1);
    let mut both = loud.clone();
    both.extend(sine(48_000, 10.0, 1000.0, 0.01));
    let (alone, mixed) = (measure(48_000, &loud).integrated_lufs, measure(48_000, &both).integrated_lufs);
    assert!((alone - mixed).abs() < 0.2, "{alone} vs {mixed}");
}

#[test]
fn the_true_peak_finds_a_peak_between_two_samples() {
    // A sine at a quarter of the rate, sampled 1/8 of a period before its crest: the samples miss the top.
    let amp = 0.99;
    let x: Vec<i16> = (0..2400).map(|n| (amp * FULL_SCALE * (PI / 2.0 * n as f64 + 7.0 * PI / 16.0).sin()).round() as i16).collect();
    let sample_peak = f64::from(x.iter().map(|s| s.abs()).max().unwrap()) / FULL_SCALE;
    let r = measure(48_000, &x);
    assert!(r.true_peak_dbtp > 20.0 * sample_peak.log10() + 0.1, "{} vs sample peak", r.true_peak_dbtp);
    assert!(r.true_peak_dbtp <= 20.0 * amp.log10() + 0.1, "{}", r.true_peak_dbtp);
}

#[test]
fn a_very_low_rate_still_measures_without_panicking() {
    let r = measure(5, &[1000; 40]);
    assert!(r.integrated_lufs >= FLOOR_DB && r.true_peak_dbtp.is_finite());
}

#[test]
fn the_verdict_needs_loudness_within_a_lu_of_the_target_and_a_peak_at_or_below_minus_3() {
    assert!(report(-19.0, -3.0).passed);
    assert!(report(-19.9, -6.0).passed);
    assert!(!report(-20.5, -6.0).passed);
    assert!(!report(-17.5, -6.0).passed);
    assert!(!report(-19.0, -2.9).passed);
}

#[test]
fn the_report_serialises_with_the_bridge_field_names() {
    let v = serde_json::to_value(report(-19.25, -3.5)).unwrap();
    assert_eq!(v, serde_json::json!({ "integratedLufs": -19.25, "truePeakDbtp": -3.5, "targetLufs": -19.0, "passed": true }));
}

#[test]
fn the_shelf_and_high_pass_are_stable_filters() {
    // Poles strictly inside the unit circle: a1 and a2 satisfy |a2| < 1 and |a1| < 1 + a2.
    for rate in [16_000.0, 22_050.0, 48_000.0, 96_000.0] {
        for s in k_weighting(rate) {
            assert!(s.a[1].abs() < 1.0 && s.a[0].abs() < 1.0 + s.a[1], "{rate}: {:?}", s.a);
        }
    }
}
