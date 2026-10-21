//! FFT Filter: an arbitrary magnitude curve applied per STFT frame (zero
//! phase within each frame, Hann windows, 75 % overlap).
//!
//! Params: 0 FFT size (power of two, 256..32768), 1 curve scale (0 log
//! frequency interpolation, 1 linear), 2 master gain dB, 3 curve (data param,
//! WASM ignores the value).
//! Data slot 0: the curve as [f0, g0, f1, g1, ...] with f in Hz and g in dB.
//! Latency: the FFT size.

use super::{clean_curve, curve_bins, fft_size};
use crate::fx::util::{db_to_gain, Stft};
use crate::fx::Effect;

pub struct FftFilter {
    rate: f32,
    channels: usize,
    stft: Stft,
    curve: Vec<f32>,
    log: bool,
    master_db: f32,
    target: Vec<f32>,
    current: Vec<f32>,
    scratch: Vec<f32>,
    fresh: bool,
}

impl FftFilter {
    pub fn new(rate: f32, channels: usize) -> FftFilter {
        let n = 4096;
        let mut f = FftFilter {
            rate,
            channels,
            stft: Stft::new(n, 4, channels),
            curve: Vec::new(),
            log: true,
            master_db: 0.0,
            target: vec![1.0; n / 2 + 1],
            current: vec![1.0; n / 2 + 1],
            scratch: vec![0.0; n / 2 + 1],
            fresh: true,
        };
        f.update();
        f
    }

    fn resize(&mut self, n: usize) {
        if n == self.stft.n {
            return;
        }
        self.stft = Stft::new(n, 4, self.channels);
        self.target = vec![1.0; n / 2 + 1];
        self.current = vec![1.0; n / 2 + 1];
        self.scratch = vec![0.0; n / 2 + 1];
        self.fresh = true;
        self.update();
    }

    fn update(&mut self) {
        curve_bins(&self.curve, self.stft.n, self.rate, self.log, &mut self.scratch);
        let master = self.master_db;
        for (t, db) in self.target.iter_mut().zip(&self.scratch) {
            *t = db_to_gain((db + master).clamp(-150.0, 48.0));
        }
    }
}

impl Effect for FftFilter {
    fn set_param(&mut self, idx: u32, value: f32) {
        if !value.is_finite() {
            return;
        }
        match idx {
            0 => self.resize(fft_size(value, 256, 32768)),
            1 => {
                self.log = value < 0.5;
                self.update();
            }
            2 => {
                self.master_db = value;
                self.update();
            }
            _ => {}
        }
    }

    fn set_data(&mut self, slot: u32, data: &[f32]) {
        if slot == 0 {
            self.curve = clean_curve(data);
            self.update();
        }
    }

    fn process(&mut self, buf: &mut [f32], _channels: usize, frames: usize) {
        let (target, current, fresh) = (&self.target, &mut self.current, &mut self.fresh);
        self.stft.process(buf, frames, |re, im| {
            if *fresh {
                current.copy_from_slice(target);
                *fresh = false;
            } else {
                // Glide to curve edits over a few frames.
                for (c, t) in current.iter_mut().zip(target) {
                    *c = *t + (*c - *t) * 0.6;
                }
            }
            for ch in 0..re.len() {
                for (k, g) in current.iter().enumerate() {
                    re[ch][k] *= g;
                    im[ch][k] *= g;
                }
            }
        });
    }

    fn reset(&mut self) {
        self.stft.reset();
        self.fresh = true;
    }

    fn latency(&self) -> u32 {
        self.stft.latency() as u32
    }
}

#[cfg(test)]
mod tests {
    use crate::fx::testutil::*;
    use crate::fx::util::gain_to_db;

    fn measure(curve: &[f32], params: &[(u32, f32)], f: f32) -> f32 {
        let r = 48000.0;
        let mut fx = make(16, r, 1);
        for &(i, v) in params {
            fx.set_param(i, v);
        }
        fx.set_data(0, curve);
        let x = sine(f, r, 48000, 0.25);
        let y = run_mono(fx.as_mut(), &x);
        let lat = fx.latency() as usize;
        gain_to_db(rms(&y[lat + 8192..]) / rms(&x[8192..48000 - lat]))
    }

    #[test]
    fn applies_the_curve() {
        let curve = [20.0, 0.0, 500.0, 0.0, 1000.0, -24.0, 2000.0, 0.0, 20000.0, 0.0];
        assert!(measure(&curve, &[], 200.0).abs() < 0.2);
        assert!((measure(&curve, &[], 1000.0) + 24.0).abs() < 1.5);
        assert!(measure(&curve, &[], 5000.0).abs() < 0.2);
        // Log interpolation: halfway in log frequency is halfway in dB.
        let ramp = [100.0, 0.0, 10000.0, -20.0];
        assert!((measure(&ramp, &[], 1000.0) + 10.0).abs() < 0.5);
        // Linear interpolation reads the same point closer to 0 dB.
        assert!(measure(&ramp, &[(1, 1.0)], 1000.0) > -3.0);
    }

    #[test]
    fn flat_curve_is_transparent_with_latency() {
        let r = 48000.0;
        let mut fx = make(16, r, 2);
        fx.set_param(0, 1024.0);
        assert_eq!(fx.latency(), 1024);
        let l = noise(8192, 0.5, 9);
        let (y, _) = run_stereo(fx.as_mut(), &l, &l);
        for i in 2048..8192 {
            assert!((y[i] - l[i - 1024]).abs() < 1e-3);
        }
    }
}
