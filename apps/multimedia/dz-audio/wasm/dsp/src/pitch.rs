//! Fundamental frequency estimation (YIN, de Cheveigne and Kawahara 2002)
//! for the spectral pitch display. The difference function is computed
//! through an FFT autocorrelation so each frame costs O(n log n).

use crate::fft::RealFft;
use crate::{slice, slice_mut};

pub struct Yin {
    n: usize,
    fft: RealFft,
    buf: Vec<f32>,
    re: Vec<f32>,
    im: Vec<f32>,
    acf: Vec<f32>,
    d: Vec<f32>,
}

impl Yin {
    pub fn new(n: usize) -> Yin {
        let m = (2 * n).next_power_of_two();
        Yin { n, fft: RealFft::new(m), buf: vec![0.0; m], re: vec![0.0; m / 2 + 1], im: vec![0.0; m / 2 + 1], acf: vec![0.0; m], d: vec![0.0; n / 2 + 1] }
    }

    /// F0 in Hz of frame (len n), or 0 when unvoiced.
    pub fn estimate(&mut self, x: &[f32], rate: f32, fmin: f32, fmax: f32, threshold: f32) -> f32 {
        let n = self.n;
        let w = n / 2; // integration window; lags up to n / 2
        let tau_min = ((rate / fmax).floor() as usize).max(2);
        let tau_max = ((rate / fmin).ceil() as usize).min(w);
        if tau_min + 2 >= tau_max {
            return 0.0;
        }
        let energy: f32 = x[..n].iter().map(|v| v * v).sum::<f32>() / n as f32;
        if energy < 1e-7 {
            return 0.0;
        }
        // acf[t] = sum_{j<w} x[j] x[j + t] via cross-correlation of x[0..w] and x.
        let m = self.buf.len();
        self.buf.iter_mut().for_each(|v| *v = 0.0);
        self.buf[..n].copy_from_slice(&x[..n]);
        self.fft.forward(&self.buf, &mut self.re, &mut self.im);
        let (xr, xi) = (self.re.clone(), self.im.clone());
        self.buf.iter_mut().for_each(|v| *v = 0.0);
        self.buf[..w].copy_from_slice(&x[..w]);
        self.fft.forward(&self.buf, &mut self.re, &mut self.im);
        for k in 0..self.re.len() {
            // conj(A) * B
            let (ar, ai) = (self.re[k], -self.im[k]);
            let (br, bi) = (xr[k], xi[k]);
            self.re[k] = ar * br - ai * bi;
            self.im[k] = ar * bi + ai * br;
        }
        self.fft.inverse(&self.re, &self.im, &mut self.acf);
        let _ = m;
        // d(t) = e0 + e_t - 2 acf(t), e_t = sum_{j<w} x[j + t]^2.
        let e0: f32 = x[..w].iter().map(|v| v * v).sum();
        let mut et = e0;
        self.d[0] = 0.0;
        let mut running = 0.0f32;
        let mut best = 0usize;
        for t in 1..=tau_max {
            et += x[w + t - 1] * x[w + t - 1] - x[t - 1] * x[t - 1];
            let dt = (e0 + et - 2.0 * self.acf[t]).max(0.0);
            running += dt;
            self.d[t] = if running > 0.0 { dt * t as f32 / running } else { 1.0 };
        }
        let mut t = tau_min;
        while t < tau_max {
            if self.d[t] < threshold {
                while t + 1 < tau_max && self.d[t + 1] < self.d[t] {
                    t += 1;
                }
                best = t;
                break;
            }
            t += 1;
        }
        if best == 0 {
            return 0.0;
        }
        // Parabolic interpolation around the minimum.
        let (a, b, c) = (self.d[best - 1], self.d[best], self.d[best + 1]);
        let den = a + c - 2.0 * b;
        let shift = if den.abs() > 1e-12 { 0.5 * (a - c) / den } else { 0.0 };
        rate / (best as f32 + shift.clamp(-1.0, 1.0))
    }
}

/// F0 track: `frames` frames of size n starting at src + i * hop.
#[no_mangle]
pub extern "C" fn pitch_track(src: u32, len: u32, rate: f32, n: u32, hop: f32, frames: u32, fmin: f32, fmax: f32, threshold: f32, out: u32) {
    let x = unsafe { slice(src, len) };
    let o = unsafe { slice_mut(out, frames) };
    let n = n as usize;
    let mut yin = Yin::new(n);
    let mut frame = vec![0.0f32; n];
    for f in 0..frames as usize {
        let s = (f as f64 * hop as f64).round() as usize;
        for i in 0..n {
            frame[i] = if s + i < x.len() { x[s + i] } else { 0.0 };
        }
        o[f] = yin.estimate(&frame, rate, fmin, fmax, threshold);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_fundamental_of_a_harmonic_tone() {
        let rate = 44100.0;
        let n = 2048;
        for f0 in [110.0f32, 220.0, 440.0, 880.0] {
            let x: Vec<f32> = (0..n)
                .map(|i| {
                    let t = i as f32 / rate;
                    (1..5).map(|h| (2.0 * std::f32::consts::PI * f0 * h as f32 * t).sin() / h as f32).sum::<f32>() * 0.3
                })
                .collect();
            let mut y = Yin::new(n);
            let est = y.estimate(&x, rate, 60.0, 1500.0, 0.15);
            assert!((est - f0).abs() / f0 < 0.01, "{} vs {}", est, f0);
        }
    }

    #[test]
    fn noise_and_silence_are_unvoiced() {
        let n = 2048;
        let mut y = Yin::new(n);
        assert_eq!(y.estimate(&vec![0.0; n], 44100.0, 60.0, 1500.0, 0.15), 0.0);
        let mut s: u32 = 1;
        let noise: Vec<f32> = (0..n)
            .map(|_| {
                s = s.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                (s >> 9) as f32 / (1u32 << 23) as f32 - 0.5
            })
            .collect();
        assert_eq!(y.estimate(&noise, 44100.0, 60.0, 1500.0, 0.1), 0.0);
    }
}
