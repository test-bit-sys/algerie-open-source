//! Spectral editing: short-time Fourier processing restricted to a
//! time-frequency mask, resynthesised by weighted overlap-add.
//!
//! Both kernels work on a padded buffer and a mask raster of `cols` columns by
//! `bins` (= n / 2 + 1) rows, column-major (bin 0 = DC). Column `c` is the
//! analysis frame centred at buffer index `first + c * hop`. Mask values are
//! weights in 0..1 (feathered edges are expected). Only the change is
//! synthesised, so samples outside every masked frame are returned untouched:
//! callers add the returned delta to their samples.

use crate::fft::{RealFft, Window};
use crate::slice;

struct Stft {
    n: usize,
    hop: usize,
    fft: RealFft,
    win: Vec<f32>,
    frame: Vec<f32>,
    re: Vec<f32>,
    im: Vec<f32>,
}

impl Stft {
    fn new(n: usize, hop: usize) -> Stft {
        Stft {
            n,
            hop: hop.max(1),
            fft: RealFft::new(n),
            win: Window::Hann.build(n),
            frame: vec![0.0; n],
            re: vec![0.0; n / 2 + 1],
            im: vec![0.0; n / 2 + 1],
        }
    }

    /// Start index (may be negative) of column c.
    fn start(&self, first: i64, c: usize) -> i64 {
        first + (c * self.hop) as i64 - (self.n / 2) as i64
    }

    /// Windowed forward transform of src around column c into re/im.
    fn analyse(&mut self, src: &[f32], first: i64, c: usize) {
        let s = self.start(first, c);
        for i in 0..self.n {
            let j = s + i as i64;
            let x = if j >= 0 && (j as usize) < src.len() { src[j as usize] } else { 0.0 };
            self.frame[i] = x * self.win[i];
        }
        self.fft.forward(&self.frame, &mut self.re, &mut self.im);
    }

    /// Inverse transform of re/im, synthesis window, added into out at column c.
    fn synthesise_add(&mut self, out: &mut [f32], first: i64, c: usize) {
        self.fft.inverse(&self.re, &self.im, &mut self.frame);
        let s = self.start(first, c);
        for i in 0..self.n {
            let j = s + i as i64;
            if j >= 0 && (j as usize) < out.len() {
                out[j as usize] += self.frame[i] * self.win[i];
            }
        }
    }

    /// Sum of analysis * synthesis windows over every column (OLA normaliser).
    fn window_sum(&self, len: usize, first: i64, cols: usize) -> Vec<f32> {
        let mut sum = vec![0.0f32; len];
        for c in 0..cols {
            let s = self.start(first, c);
            for i in 0..self.n {
                let j = s + i as i64;
                if j >= 0 && (j as usize) < len {
                    sum[j as usize] += self.win[i] * self.win[i];
                }
            }
        }
        sum
    }
}

fn normalise(out: &mut [f32], sum: &[f32]) {
    for (o, &s) in out.iter_mut().zip(sum) {
        *o = if s > 1e-3 { *o / s } else { 0.0 };
    }
}

fn column_active(mask: &[f32], c: usize, bins: usize) -> bool {
    mask[c * bins..(c + 1) * bins].iter().any(|&w| w > 1e-4)
}

/// Masked part of `diff`: the signal whose STFT is `mask * STFT(diff)`.
/// With diff = processed - original, original + result applies the
/// processing only inside the mask.
pub fn mask_blend(diff: &[f32], out: &mut [f32], mask: &[f32], cols: usize, n: usize, hop: usize, first: i64) {
    let bins = n / 2 + 1;
    let mut st = Stft::new(n, hop);
    out.iter_mut().for_each(|x| *x = 0.0);
    for c in 0..cols {
        if !column_active(mask, c, bins) {
            continue;
        }
        st.analyse(diff, first, c);
        let m = &mask[c * bins..(c + 1) * bins];
        for k in 0..bins {
            let w = m[k].clamp(0.0, 1.0);
            st.re[k] *= w;
            st.im[k] *= w;
        }
        st.synthesise_add(out, first, c);
    }
    let sum = st.window_sum(out.len(), first, cols);
    normalise(out, &sum);
}

/// Spot healing: inside the mask, magnitudes are replaced by a log-domain
/// interpolation between reference columns on either side in time (skipping
/// the columns whose windows overlap the masked run), keeping the original
/// phase. Writes the change to `out` (add it to src).
pub fn heal(src: &[f32], out: &mut [f32], mask: &[f32], cols: usize, n: usize, hop: usize, first: i64) {
    let bins = n / 2 + 1;
    let mut st = Stft::new(n, hop);
    out.iter_mut().for_each(|x| *x = 0.0);
    if cols == 0 {
        return;
    }
    // Full STFT: the references can sit anywhere along the row.
    let mut re = vec![0.0f32; cols * bins];
    let mut im = vec![0.0f32; cols * bins];
    for c in 0..cols {
        st.analyse(src, first, c);
        re[c * bins..(c + 1) * bins].copy_from_slice(&st.re);
        im[c * bins..(c + 1) * bins].copy_from_slice(&st.im);
    }
    let mag = |c: usize, k: usize, re: &[f32], im: &[f32]| -> f32 {
        let i = c * bins + k;
        (re[i] * re[i] + im[i] * im[i]).sqrt()
    };
    let overlap = (n / hop.max(1)).saturating_sub(1).max(1);
    let masked = |c: usize, k: usize| mask[c * bins + k] > 1e-4;
    let phase = |c: usize, k: usize, re: &[f32], im: &[f32]| -> f32 {
        let i = c * bins + k;
        im[i].atan2(re[i])
    };
    let wrap = |a: f32| -> f32 {
        let t = std::f32::consts::TAU;
        a - t * ((a + std::f32::consts::PI) / t).floor()
    };
    // New magnitudes for masked cells (NaN = untouched) and, for cells being
    // filled rather than attenuated, a phase continued from the left reference
    // at its measured rate (phase vocoder style) so stationary tones stay coherent.
    let mut target = vec![f32::NAN; cols * bins];
    let mut tphase = vec![f32::NAN; cols * bins];
    for k in 0..bins {
        let expected = std::f32::consts::TAU * k as f32 * hop as f32 / n as f32;
        let mut c = 0;
        while c < cols {
            if !masked(c, k) {
                c += 1;
                continue;
            }
            let a = c;
            while c < cols && masked(c, k) {
                c += 1;
            }
            let b = c; // run is [a, b)
            // Reference: mean magnitude of up to 3 unmasked columns, `overlap`
            // columns away from the run when possible.
            let reference = |centre: i64| -> Option<(f32, f64)> {
                let mut sum = 0.0f64;
                let mut cnt = 0;
                for d in -1i64..=1 {
                    let j = centre + d;
                    if j < 0 || j as usize >= cols || masked(j as usize, k) {
                        continue;
                    }
                    sum += mag(j as usize, k, &re, &im) as f64;
                    cnt += 1;
                }
                if cnt == 0 {
                    None
                } else {
                    Some(((sum / cnt as f64) as f32, centre as f64))
                }
            };
            let mut left = None;
            for back in (1..=overlap + 1).rev() {
                let centre = a as i64 - back as i64 - 1;
                if let Some(r) = reference(centre) {
                    left = Some(r);
                    break;
                }
            }
            let mut right = None;
            for fwd in (1..=overlap + 1).rev() {
                let centre = b as i64 + fwd as i64;
                if let Some(r) = reference(centre) {
                    right = Some(r);
                    break;
                }
            }
            // Phase source: the last unmasked column before the run and its rate.
            let anchor = if a >= 2 && !masked(a - 1, k) && !masked(a - 2, k) {
                let p1 = phase(a - 1, k, &re, &im);
                let p0 = phase(a - 2, k, &re, &im);
                Some((a - 1, p1, expected + wrap(p1 - p0 - expected)))
            } else if b + 1 < cols && !masked(b, k) && !masked(b + 1, k) {
                let p0 = phase(b, k, &re, &im);
                let p1 = phase(b + 1, k, &re, &im);
                Some((b, p0, expected + wrap(p1 - p0 - expected)))
            } else {
                None
            };
            for j in a..b {
                let v = match (left, right) {
                    (Some((l, lx)), Some((r, rx))) => {
                        let t = ((j as f64 - lx) / (rx - lx).max(1.0)).clamp(0.0, 1.0) as f32;
                        let ll = (l.max(1e-12)).ln();
                        let rl = (r.max(1e-12)).ln();
                        (ll + (rl - ll) * t).exp()
                    }
                    (Some((l, _)), None) => l,
                    (None, Some((r, _))) => r,
                    (None, None) => 0.0,
                };
                target[j * bins + k] = v;
                if mag(j, k, &re, &im) < 0.5 * v {
                    if let Some((col, p, adv)) = anchor {
                        tphase[j * bins + k] = p + adv * (j as f32 - col as f32);
                    }
                }
            }
        }
    }
    let mut seed: u32 = 0x9e37_79b9;
    for c in 0..cols {
        if !column_active(mask, c, bins) {
            continue;
        }
        for k in 0..bins {
            let i = c * bins + k;
            let w = mask[i].clamp(0.0, 1.0);
            let t = target[i];
            if w <= 1e-4 || t.is_nan() {
                st.re[k] = 0.0;
                st.im[k] = 0.0;
                continue;
            }
            let m = (re[i] * re[i] + im[i] * im[i]).sqrt();
            let (ur, ui) = if !tphase[i].is_nan() {
                (tphase[i].cos(), tphase[i].sin())
            } else if m > 1e-12 {
                (re[i] / m, im[i] / m)
            } else {
                seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                let ph = (seed >> 8) as f32 / (1u32 << 24) as f32 * std::f32::consts::TAU;
                (ph.cos(), ph.sin())
            };
            st.re[k] = w * (t * ur - re[i]);
            st.im[k] = w * (t * ui - im[i]);
        }
        st.synthesise_add(out, first, c);
    }
    let sum = st.window_sum(out.len(), first, cols);
    normalise(out, &sum);
}

#[no_mangle]
pub extern "C" fn spec_mask_blend(diff: u32, len: u32, out: u32, mask: u32, cols: u32, n: u32, hop: u32, first: i32) {
    let bins = n / 2 + 1;
    let d = unsafe { slice(diff, len) };
    let o = unsafe { crate::slice_mut(out, len) };
    let m = unsafe { slice(mask, cols * bins) };
    mask_blend(d, o, m, cols as usize, n as usize, hop as usize, first as i64);
}

#[no_mangle]
pub extern "C" fn spec_heal(src: u32, len: u32, out: u32, mask: u32, cols: u32, n: u32, hop: u32, first: i32) {
    let bins = n / 2 + 1;
    let s = unsafe { slice(src, len) };
    let o = unsafe { crate::slice_mut(out, len) };
    let m = unsafe { slice(mask, cols * bins) };
    heal(s, o, m, cols as usize, n as usize, hop as usize, first as i64);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::PI;

    const RATE: f32 = 48000.0;

    fn tone(freq: f32, amp: f32, len: usize) -> Vec<f32> {
        (0..len).map(|i| amp * (2.0 * PI * freq * i as f32 / RATE).sin()).collect()
    }

    /// Amplitude of `freq` in x[a..b] by correlation.
    fn level(x: &[f32], freq: f32, a: usize, b: usize) -> f32 {
        let (mut s, mut c) = (0.0f64, 0.0f64);
        for i in a..b {
            let ph = 2.0 * std::f64::consts::PI * freq as f64 * i as f64 / RATE as f64;
            s += x[i] as f64 * ph.sin();
            c += x[i] as f64 * ph.cos();
        }
        (2.0 * (s * s + c * c).sqrt() / (b - a) as f64) as f32
    }

    /// Mask covering [f_lo, f_hi] Hz for columns whose centres fall in [t0, t1).
    fn band_mask(cols: usize, n: usize, hop: usize, t0: usize, t1: usize, f_lo: f32, f_hi: f32) -> Vec<f32> {
        let bins = n / 2 + 1;
        let mut m = vec![0.0; cols * bins];
        for c in 0..cols {
            let centre = c * hop;
            if centre < t0 || centre >= t1 {
                continue;
            }
            for k in 0..bins {
                let f = k as f32 * RATE / n as f32;
                if f >= f_lo && f <= f_hi {
                    m[c * bins + k] = 1.0;
                }
            }
        }
        m
    }

    #[test]
    fn full_mask_reconstructs_the_difference() {
        let n = 1024;
        let hop = 256;
        let len = 9000;
        let x: Vec<f32> = (0..len).map(|i| ((i * 7919) % 1000) as f32 / 1000.0 - 0.5).collect();
        let cols = len / hop + 2;
        let mask = vec![1.0; cols * (n / 2 + 1)];
        let mut out = vec![0.0; len];
        mask_blend(&x, &mut out, &mask, cols, n, hop, 0);
        for i in 0..len {
            assert!((out[i] - x[i]).abs() < 1e-3, "{} {} {}", i, out[i], x[i]);
        }
    }

    #[test]
    fn masked_tone_is_removed_and_unmasked_tone_survives() {
        let n = 2048;
        let hop = n / 4;
        let len = 48000;
        let a = tone(1000.0, 0.5, len);
        let b = tone(5000.0, 0.5, len);
        let x: Vec<f32> = a.iter().zip(&b).map(|(p, q)| p + q).collect();
        // Delete = gain 0 inside the mask: diff = 0 * x - x = -x.
        let diff: Vec<f32> = x.iter().map(|v| -v).collect();
        let cols = len / hop + 1;
        let mask = band_mask(cols, n, hop, 0, len, 700.0, 1300.0);
        let mut delta = vec![0.0; len];
        mask_blend(&diff, &mut delta, &mask, cols, n, hop, 0);
        let y: Vec<f32> = x.iter().zip(&delta).map(|(p, d)| p + d).collect();
        let (s, e) = (n, len - n);
        let removed = level(&y, 1000.0, s, e);
        let kept = level(&y, 5000.0, s, e);
        assert!(removed < 0.5 * 0.01, "1 kHz left at {}", removed);
        assert!((kept - 0.5).abs() < 0.01, "5 kHz at {}", kept);
    }

    #[test]
    fn samples_outside_the_masked_time_are_unchanged() {
        let n = 1024;
        let hop = 256;
        let len = 20000;
        let x = tone(440.0, 0.8, len);
        let diff: Vec<f32> = x.iter().map(|v| -v).collect();
        let cols = len / hop + 1;
        let mask = band_mask(cols, n, hop, 8000, 10000, 0.0, 24000.0);
        let mut delta = vec![0.0; len];
        mask_blend(&diff, &mut delta, &mask, cols, n, hop, 0);
        for i in 0..(8000 - n) {
            assert_eq!(delta[i], 0.0);
        }
        for i in (10000 + n)..len {
            assert_eq!(delta[i], 0.0);
        }
        // Inside, the tone is mostly gone.
        assert!(level(&delta.iter().zip(&x).map(|(d, v)| d + v).collect::<Vec<_>>(), 440.0, 8600, 9400) < 0.1);
    }

    #[test]
    fn healing_fills_a_dropout_from_surrounding_time() {
        let n = 1024;
        let hop = 256;
        let len = 48000;
        let mut x = tone(2000.0, 0.5, len);
        // A 50 ms gap of silence in the middle.
        for v in &mut x[24000..26400] {
            *v = 0.0;
        }
        let cols = len / hop + 1;
        let mask = band_mask(cols, n, hop, 23500, 26900, 0.0, 24000.0);
        let mut delta = vec![0.0; len];
        heal(&x, &mut delta, &mask, cols, n, hop, 0);
        let y: Vec<f32> = x.iter().zip(&delta).map(|(p, d)| p + d).collect();
        let before = level(&x, 2000.0, 24400, 26000);
        let after = level(&y, 2000.0, 24400, 26000);
        assert!(before < 0.01);
        assert!(after > 0.2, "healed level {}", after);
    }

    #[test]
    fn healing_removes_a_click() {
        let n = 1024;
        let hop = 256;
        let len = 30000;
        let mut x = tone(300.0, 0.3, len);
        for i in 15000..15040 {
            x[i] += if i % 2 == 0 { 0.9 } else { -0.9 };
        }
        let cols = len / hop + 1;
        let mask = band_mask(cols, n, hop, 14500, 15600, 3000.0, 24000.0);
        let mut delta = vec![0.0; len];
        heal(&x, &mut delta, &mask, cols, n, hop, 0);
        let y: Vec<f32> = x.iter().zip(&delta).map(|(p, d)| p + d).collect();
        let hf = |v: &[f32]| -> f32 { (15000..15040).map(|i| (v[i] - v[i - 1]).abs()).fold(0.0, f32::max) };
        assert!(hf(&y) < hf(&x) * 0.3, "{} vs {}", hf(&y), hf(&x));
        // The tone is preserved.
        assert!((level(&y, 300.0, 5000, 10000) - 0.3).abs() < 0.01);
    }
}
