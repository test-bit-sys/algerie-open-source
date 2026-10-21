//! Center Channel Extractor: finds the spectral components of a stereo mix
//! that sit at a target position (centre, hard left, hard right or out of
//! phase "surround") by comparing the left and right spectra bin by bin, then
//! sets the level of those components and of everything else independently.
//! Turning the centre down removes lead vocals; turning the sides down
//! isolates them.
//!
//! Params:
//!   0 target (0 centre, 1 left, 2 right, 3 surround, 4 custom)
//!   1 frequency range (0 full spectrum, 1 male voice, 2 female voice, 3 bass, 4 custom)
//!   2 custom low Hz       3 custom high Hz
//!   4 centre level dB     5 side level dB   (-48 or lower is silence)
//!   6 crossover bleed %   (softness of the decision edges)
//!   7 phase discrimination degrees   8 amplitude discrimination dB
//!   9 spectral decay %    (smoothing of the decisions over time)
//!   10 FFT size
//!   11 custom phase angle degrees (left minus right)
//!   12 custom pan % (-100 left .. 100 right, constant power)
//!   13 custom delay ms (positive: the right channel arrives later)
//! Latency: the FFT size.

use crate::fx::filter::fft_size;
use crate::fx::util::{db_to_gain, Stft, PI};
use crate::fx::Effect;

/// (low, high) Hz of the preset frequency ranges.
pub const RANGES: [(f32, f32); 4] = [(0.0, 1e9), (80.0, 8000.0), (150.0, 10000.0), (20.0, 250.0)];
const SILENT_DB: f32 = -48.0;
/// Clamp for the level ratio between channels.
const MAX_RATIO_DB: f32 = 30.0;

pub struct CenterExtractor {
    rate: f32,
    channels: usize,
    stft: Stft,
    raw: [f32; 14],
    mask: Vec<f32>,
    gc: f32,
    gs: f32,
}

impl CenterExtractor {
    pub fn new(rate: f32, channels: usize) -> CenterExtractor {
        let n = 4096;
        CenterExtractor {
            rate,
            channels,
            stft: Stft::new(n, 4, channels),
            raw: [0.0, 0.0, 100.0, 8000.0, 0.0, 0.0, 20.0, 10.0, 3.0, 70.0, n as f32, 0.0, 0.0, 0.0],
            mask: vec![0.0; n / 2 + 1],
            gc: 1.0,
            gs: 1.0,
        }
    }

    fn level(db: f32) -> f32 {
        if db <= SILENT_DB {
            0.0
        } else {
            db_to_gain(db)
        }
    }
}

/// Wraps an angle to [-pi, pi].
#[inline]
fn wrap(a: f32) -> f32 {
    let t = (a + PI).rem_euclid(2.0 * PI);
    t - PI
}

/// Level ratio L/R in dB of a constant-power pan position (-1 left .. 1 right).
pub fn pan_ratio_db(pan: f32) -> f32 {
    let a = (pan.clamp(-1.0, 1.0) + 1.0) * PI / 4.0;
    (20.0 * (a.cos().max(1e-6) / a.sin().max(1e-6)).log10()).clamp(-MAX_RATIO_DB, MAX_RATIO_DB)
}

/// 1 inside `width`, falling linearly to 0 over `soft` beyond it.
#[inline]
fn member(dist: f32, width: f32, soft: f32) -> f32 {
    if dist <= width {
        1.0
    } else {
        (1.0 - (dist - width) / soft).max(0.0)
    }
}

impl Effect for CenterExtractor {
    fn set_param(&mut self, idx: u32, value: f32) {
        let i = idx as usize;
        if i >= self.raw.len() || !value.is_finite() {
            return;
        }
        self.raw[i] = value;
        if i == 10 {
            let n = fft_size(value, 512, 16384);
            if n != self.stft.n {
                self.stft = Stft::new(n, 4, self.channels);
                self.mask = vec![0.0; n / 2 + 1];
            }
        }
    }

    fn process(&mut self, buf: &mut [f32], _channels: usize, frames: usize) {
        let target = self.raw[0].round() as i32;
        let (lo, hi) = match self.raw[1].round() as i32 {
            r @ 0..=3 => RANGES[r as usize],
            _ => (self.raw[2].min(self.raw[3]), self.raw[3].max(self.raw[2])),
        };
        let n = self.stft.n;
        let bin_hz = self.rate / n as f32;
        let k_lo = (lo / bin_hz).ceil().max(0.0) as usize;
        let k_hi = ((hi / bin_hz).floor() as usize).min(n / 2);
        let bleed = self.raw[6].clamp(0.0, 100.0) / 100.0;
        let phase_w = self.raw[7].clamp(0.0, 180.0) * PI / 180.0;
        let phase_soft = (1.0 + 89.0 * bleed) * PI / 180.0;
        let amp_w = self.raw[8].clamp(0.0, MAX_RATIO_DB);
        let amp_soft = 0.5 + 19.5 * bleed;
        let decay = (self.raw[9].clamp(0.0, 99.0) / 100.0).max(0.0);
        let gc_t = Self::level(self.raw[4]);
        let gs_t = Self::level(self.raw[5]);
        // Custom target: the position a source panned by `pan`, shifted by
        // `angle` and delayed by `delay` would have.
        let c_angle = self.raw[11].clamp(-360.0, 360.0) * PI / 180.0;
        let c_ratio = pan_ratio_db(self.raw[12] / 100.0);
        let c_delay = self.raw[13].clamp(-50.0, 50.0) * 0.001;
        let rate = self.rate;
        let (mask, gc, gs) = (&mut self.mask, &mut self.gc, &mut self.gs);
        self.stft.process(buf, frames, |re, im| {
            // Level changes glide over a few frames.
            *gc = gc_t + (*gc - gc_t) * 0.5;
            *gs = gs_t + (*gs - gs_t) * 0.5;
            let stereo = re.len() > 1;
            for k in 0..mask.len() {
                let m = if k < k_lo || k > k_hi {
                    0.0
                } else if !stereo {
                    // A mono signal is all centre.
                    if target == 0 {
                        1.0
                    } else {
                        0.0
                    }
                } else {
                    let (lr, li, rr, ri) = (re[0][k], im[0][k], re[1][k], im[1][k]);
                    let el = lr * lr + li * li;
                    let er = rr * rr + ri * ri;
                    if el + er < 1e-14 {
                        mask[k]
                    } else {
                        let ratio = (10.0 * ((el + 1e-20) / (er + 1e-20)).log10()).clamp(-MAX_RATIO_DB, MAX_RATIO_DB);
                        // Phase of L times conj(R).
                        let dphi = (li * rr - lr * ri).atan2(lr * rr + li * ri);
                        match target {
                            4 => {
                                let expected = c_angle + 2.0 * PI * (k as f32 * rate / n as f32) * c_delay;
                                member(wrap(dphi - expected).abs(), phase_w, phase_soft) * member((ratio - c_ratio).abs(), amp_w, amp_soft)
                            }
                            1 => member(MAX_RATIO_DB - ratio, amp_w, amp_soft),
                            2 => member(ratio + MAX_RATIO_DB, amp_w, amp_soft),
                            3 => member(PI - dphi.abs(), phase_w, phase_soft) * member(ratio.abs(), amp_w, amp_soft),
                            _ => member(dphi.abs(), phase_w, phase_soft) * member(ratio.abs(), amp_w, amp_soft),
                        }
                    }
                };
                mask[k] = m + (mask[k] - m) * decay;
                let g = *gc * mask[k] + *gs * (1.0 - mask[k]);
                for c in 0..re.len() {
                    re[c][k] *= g;
                    im[c][k] *= g;
                }
            }
        });
    }

    fn reset(&mut self) {
        self.stft.reset();
        self.mask.iter_mut().for_each(|v| *v = 0.0);
        self.gc = Self::level(self.raw[4]);
        self.gs = Self::level(self.raw[5]);
    }

    fn latency(&self) -> u32 {
        self.stft.latency() as u32
    }
}

#[cfg(test)]
mod tests {
    use crate::fx::testutil::*;

    /// A centred 1 kHz tone plus a left-only 300 Hz tone and a right-only 3 kHz tone.
    fn mix(n: usize) -> (Vec<f32>, Vec<f32>, Vec<f32>, Vec<f32>, Vec<f32>) {
        let r = 48000.0;
        let c = sine(1000.0, r, n, 0.3);
        let a = sine(300.0, r, n, 0.3);
        let b = sine(3000.0, r, n, 0.3);
        let l: Vec<f32> = c.iter().zip(&a).map(|(x, y)| x + y).collect();
        let rr: Vec<f32> = c.iter().zip(&b).map(|(x, y)| x + y).collect();
        (l, rr, c, a, b)
    }

    fn band_level(x: &[f32], f: f32) -> f32 {
        // Correlation with a sine/cosine pair (single-bin DFT).
        let r = 48000.0;
        let (mut s, mut c) = (0.0f64, 0.0f64);
        for (i, v) in x.iter().enumerate() {
            let p = 2.0 * std::f64::consts::PI * f as f64 * i as f64 / r as f64;
            s += *v as f64 * p.sin();
            c += *v as f64 * p.cos();
        }
        (2.0 * (s * s + c * c).sqrt() / x.len() as f64) as f32
    }

    #[test]
    fn custom_target_finds_a_panned_delayed_source() {
        let n = 48000;
        let r = 48000.0;
        // A 1 kHz tone panned half right with the right channel 0.25 ms late,
        // plus a centred 3 kHz tone.
        let pan = 0.5f32;
        let a = (pan + 1.0) * std::f32::consts::PI / 4.0;
        let src = sine(1000.0, r, n + 64, 0.3);
        let c = sine(3000.0, r, n, 0.3);
        let l: Vec<f32> = (0..n).map(|i| src[i + 12] * a.cos() + c[i]).collect();
        let rr: Vec<f32> = (0..n).map(|i| src[i] * a.sin() + c[i]).collect();
        let mut fx = make(111, r, 2);
        fx.set_param(0, 4.0);
        fx.set_param(12, 50.0);
        fx.set_param(13, 0.25);
        fx.set_param(4, -48.0); // remove the custom target
        fx.reset();
        let (ol, _) = run_stereo(fx.as_mut(), &l, &rr);
        let lat = fx.latency() as usize;
        let tail = &ol[lat + 8192..];
        assert!(band_level(tail, 1000.0) < 0.3 * a.cos() * 0.2, "target kept: {}", band_level(tail, 1000.0));
        assert!(band_level(tail, 3000.0) > 0.25, "centre lost: {}", band_level(tail, 3000.0));
    }

    #[test]
    fn removes_or_isolates_the_centre() {
        let n = 48000;
        let (l, r, ..) = mix(n);
        // Remove the centre.
        let mut fx = make(111, 48000.0, 2);
        fx.set_param(4, -48.0);
        fx.reset();
        let (ol, or) = run_stereo(fx.as_mut(), &l, &r);
        let lat = fx.latency() as usize;
        let tl = &ol[lat + 8192..];
        let tr = &or[lat + 8192..];
        assert!(band_level(tl, 1000.0) < 0.01, "centre left {}", band_level(tl, 1000.0));
        assert!(band_level(tr, 1000.0) < 0.01);
        assert!((band_level(tl, 300.0) - 0.3).abs() < 0.03, "side kept {}", band_level(tl, 300.0));
        assert!((band_level(tr, 3000.0) - 0.3).abs() < 0.03);
        // Extract the centre.
        let mut fx = make(111, 48000.0, 2);
        fx.set_param(5, -48.0);
        fx.reset();
        let (ol, _) = run_stereo(fx.as_mut(), &l, &r);
        let tl = &ol[lat + 8192..];
        assert!((band_level(tl, 1000.0) - 0.3).abs() < 0.03);
        assert!(band_level(tl, 300.0) < 0.01);
    }

    #[test]
    fn targets_left_and_respects_frequency_range() {
        let n = 48000;
        let (l, r, ..) = mix(n);
        let mut fx = make(111, 48000.0, 2);
        fx.set_param(0, 1.0); // left
        fx.set_param(4, -48.0);
        fx.reset();
        let (ol, _) = run_stereo(fx.as_mut(), &l, &r);
        let lat = fx.latency() as usize;
        let tl = &ol[lat + 8192..];
        assert!(band_level(tl, 300.0) < 0.01);
        assert!((band_level(tl, 1000.0) - 0.3).abs() < 0.03);
        // Bass range only: the 1 kHz centre tone is outside, so it is a side.
        let mut fx = make(111, 48000.0, 2);
        fx.set_param(1, 3.0);
        fx.set_param(4, -48.0);
        fx.reset();
        let (ol, _) = run_stereo(fx.as_mut(), &l, &r);
        assert!((band_level(&ol[lat + 8192..], 1000.0) - 0.3).abs() < 0.03);
    }
}
