//! Loudness of a rendered chapter for the audiobook export: integrated loudness (ITU-R BS.1770-4 K-weighting with the
//! EBU R128 absolute and relative gates) and a true-peak estimate (four-times oversampling). The retail target is
//! -19 LUFS with a true peak at or below -3 dBTP. This module only measures and judges; it never changes the audio.
//! Input is 16-bit mono PCM (the channel weight of BS.1770 for one channel is 1.0). Pure functions, no I/O.
use serde::Serialize;
use std::f64::consts::PI;

/// The integrated loudness the audiobook is aimed at (LUFS).
pub const TARGET_LUFS: f64 = -19.0;
/// How far the integrated loudness may sit from the target and still pass (LU). A choice of this app, tighter than ACX's -18 to -23.
pub const TOLERANCE_LU: f64 = 1.0;
/// The highest true peak that passes (dBTP).
pub const TRUE_PEAK_LIMIT_DBTP: f64 = -3.0;
/// The value reported for silence, and for audio too short for one 400 ms block: the lowest level the report uses.
const FLOOR_DB: f64 = -150.0;
/// BS.1770 absolute gate (LUFS): blocks quieter than this never count.
const ABSOLUTE_GATE_LUFS: f64 = -70.0;
/// BS.1770 relative gate (LU): blocks more than this below the mean of the blocks that passed the absolute gate do not count.
const RELATIVE_GATE_LU: f64 = 10.0;
/// Measurement blocks are 400 ms, made of four 100 ms chunks, and start every 100 ms (75 % overlap).
const CHUNKS_PER_SECOND: usize = 10;
const BLOCK_CHUNKS: usize = 4;
/// Full scale of 16-bit PCM.
const FULL_SCALE: f64 = 32768.0;

/// The measured loudness of one chapter and whether it meets the target. Numbers are dB; silence reports -150.
#[derive(Serialize, Debug, Clone, Copy, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LoudnessReport {
    pub integrated_lufs: f64,
    pub true_peak_dbtp: f64,
    pub target_lufs: f64,
    pub passed: bool,
}

/// Measures PCM at `rate` Hz. Silence, a zero rate and audio shorter than 400 ms report the floor (and do not pass).
pub fn measure(rate: u32, samples: &[i16]) -> LoudnessReport {
    if rate == 0 {
        return report(FLOOR_DB, FLOOR_DB);
    }
    let x: Vec<f64> = samples.iter().map(|&s| f64::from(s) / FULL_SCALE).collect();
    let [shelf, high_pass] = k_weighting(f64::from(rate));
    let filtered = high_pass.run(&shelf.run(&x));
    report(gated_lufs(&block_powers(&filtered, rate)), dbtp(&x))
}

/// Whether a measured chapter passes: integrated loudness within `TOLERANCE_LU` of the target and a true peak at or below the limit.
fn report(integrated_lufs: f64, true_peak_dbtp: f64) -> LoudnessReport {
    let passed = (integrated_lufs - TARGET_LUFS).abs() <= TOLERANCE_LU && true_peak_dbtp <= TRUE_PEAK_LIMIT_DBTP;
    LoudnessReport { integrated_lufs, true_peak_dbtp, target_lufs: TARGET_LUFS, passed }
}

/// One second-order IIR section: `y = b0 x + b1 x1 + b2 x2 - a1 y1 - a2 y2`.
#[derive(Clone, Copy, Debug)]
struct Biquad {
    b: [f64; 3],
    a: [f64; 2],
}

impl Biquad {
    fn run(&self, x: &[f64]) -> Vec<f64> {
        let (mut x1, mut x2, mut y1, mut y2) = (0.0, 0.0, 0.0, 0.0);
        x.iter()
            .map(|&s| {
                let y = self.b[0] * s + self.b[1] * x1 + self.b[2] * x2 - self.a[0] * y1 - self.a[1] * y2;
                (x2, x1, y2, y1) = (x1, s, y1, y);
                y
            })
            .collect()
    }
}

/// The two stages of the K-weighting filter at `rate` Hz: a high shelf (the head's effect) and the RLB high-pass.
/// Made by the bilinear transform of the analogue prototypes of BS.1770-4; at 48 kHz these are the published coefficients.
fn k_weighting(rate: f64) -> [Biquad; 2] {
    let k = (PI * 1_681.974_450_955_533 / rate).tan();
    let (vh, q) = (10f64.powf(3.999_843_853_973_347 / 20.0), 0.707_175_236_955_419_6);
    let vb = vh.powf(0.499_666_774_154_541_6);
    let a0 = 1.0 + k / q + k * k;
    let shelf = Biquad {
        b: [(vh + vb * k / q + k * k) / a0, 2.0 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0],
        a: [2.0 * (k * k - 1.0) / a0, (1.0 - k / q + k * k) / a0],
    };
    let k = (PI * 38.135_470_876_024_44 / rate).tan();
    let q = 0.500_327_037_323_877_3;
    let a0 = 1.0 + k / q + k * k;
    // The numerator is the published (1, -2, 1), not divided by a0: that is the normative table, a gain of 1/a0 apart.
    let high_pass = Biquad { b: [1.0, -2.0, 1.0], a: [2.0 * (k * k - 1.0) / a0, (1.0 - k / q + k * k) / a0] };
    [shelf, high_pass]
}

/// Loudness in LUFS of a mean square (the power of the K-weighted signal). No power gives negative infinity.
fn lufs_of(mean_square: f64) -> f64 {
    if mean_square > 0.0 {
        -0.691 + 10.0 * mean_square.log10()
    } else {
        f64::NEG_INFINITY
    }
}

fn mean(v: &[f64]) -> f64 {
    v.iter().sum::<f64>() / v.len() as f64
}

/// The mean square of every 400 ms block, one per 100 ms hop. Each 100 ms chunk is summed once and blocks are means of
/// four neighbouring chunks, so a long chapter is measured in one pass. Audio shorter than one block gives none.
fn block_powers(filtered: &[f64], rate: u32) -> Vec<f64> {
    let step = (rate as usize / CHUNKS_PER_SECOND).max(1);
    let chunks: Vec<f64> = filtered.chunks_exact(step).map(|c| c.iter().map(|s| s * s).sum::<f64>() / step as f64).collect();
    chunks.windows(BLOCK_CHUNKS).map(mean).collect()
}

/// Integrated loudness of the blocks: drop blocks under the absolute gate, then the ones more than 10 LU under the mean of
/// what is left, and take the mean of the rest. Nothing left gives the floor.
fn gated_lufs(blocks: &[f64]) -> f64 {
    let loud: Vec<f64> = blocks.iter().copied().filter(|&ms| lufs_of(ms) > ABSOLUTE_GATE_LUFS).collect();
    if loud.is_empty() {
        return FLOOR_DB;
    }
    let relative_gate = lufs_of(mean(&loud)) - RELATIVE_GATE_LU;
    let kept: Vec<f64> = loud.into_iter().filter(|&ms| lufs_of(ms) > relative_gate).collect();
    lufs_of(mean(&kept)).max(FLOOR_DB)
}

/// Taps per in-between phase of the oversampling filter: a Hann-windowed sinc over six samples either side.
const TAPS: usize = 12;
/// Sample offset of the first tap (the last is `FIRST_OFFSET + TAPS - 1`, six samples after the interpolated point).
const FIRST_OFFSET: i64 = -(TAPS as i64 / 2 - 1);

/// Filter rows for the three phases between two samples (1/4, 1/2 and 3/4 of the way), each with unit DC gain.
fn interpolation_taps() -> [[f64; TAPS]; 3] {
    let half = (TAPS / 2) as f64;
    [1.0, 2.0, 3.0].map(|p| {
        let frac = p / 4.0;
        let mut row = [0.0; TAPS];
        for (j, t) in row.iter_mut().enumerate() {
            let d = (FIRST_OFFSET + j as i64) as f64 - frac;
            // The offsets minus the fractions are never zero (the fractions are 1/4, 1/2 and 3/4), so no division by zero.
            *t = (PI * d).sin() / (PI * d) * 0.5 * (1.0 + (PI * d / half).cos());
        }
        let sum: f64 = row.iter().sum();
        row.map(|t| t / sum)
    })
}

fn sample_at(x: &[f64], i: i64) -> f64 {
    usize::try_from(i).ok().and_then(|i| x.get(i)).copied().unwrap_or(0.0)
}

/// The largest absolute value of the signal, including the values between its samples (four times oversampled), in dBTP.
fn dbtp(x: &[f64]) -> f64 {
    let taps = interpolation_taps();
    let mut peak = 0.0f64;
    for (n, &s) in x.iter().enumerate() {
        peak = peak.max(s.abs());
        for row in &taps {
            let y: f64 = row.iter().enumerate().map(|(j, h)| h * sample_at(x, n as i64 + FIRST_OFFSET + j as i64)).sum();
            peak = peak.max(y.abs());
        }
    }
    if peak > 0.0 {
        (20.0 * peak.log10()).max(FLOOR_DB)
    } else {
        FLOOR_DB
    }
}

#[cfg(test)]
mod tests;
