//! Graphic Phase Shifter: rotates the phase of each frequency by an amount
//! drawn as a curve (degrees against frequency), on one or both channels.
//! Useful for aligning channels with frequency-dependent phase problems or
//! for creative spatial effects.
//!
//! Params: 0 channel (0 left, 1 right, 2 both), 1 FFT size, 2 curve scale
//! (0 log frequency interpolation, 1 linear), 3 curve (data param).
//! Data slot 0: [f0, deg0, f1, deg1, ...], degrees in -360..360.
//! Latency: the FFT size.

use crate::fx::filter::{clean_curve, curve_bins, fft_size};
use crate::fx::util::{Stft, PI};
use crate::fx::Effect;

pub struct PhaseShifter {
    rate: f32,
    channels: usize,
    stft: Stft,
    curve: Vec<f32>,
    log: bool,
    which: u32,
    target: Vec<f32>,
    current: Vec<f32>,
    cos: Vec<f32>,
    sin: Vec<f32>,
    fresh: bool,
}

impl PhaseShifter {
    pub fn new(rate: f32, channels: usize) -> PhaseShifter {
        let n = 2048;
        let mut p = PhaseShifter {
            rate,
            channels,
            stft: Stft::new(n, 4, channels),
            curve: Vec::new(),
            log: true,
            which: 0,
            target: Vec::new(),
            current: Vec::new(),
            cos: Vec::new(),
            sin: Vec::new(),
            fresh: true,
        };
        p.alloc();
        p
    }

    fn alloc(&mut self) {
        let bins = self.stft.n / 2 + 1;
        self.target = vec![0.0; bins];
        self.current = vec![0.0; bins];
        self.cos = vec![1.0; bins];
        self.sin = vec![0.0; bins];
        self.fresh = true;
        self.update();
    }

    fn update(&mut self) {
        curve_bins(&self.curve, self.stft.n, self.rate, self.log, &mut self.target);
        for t in &mut self.target {
            *t = t.clamp(-360.0, 360.0) * PI / 180.0;
        }
        // DC and Nyquist must stay real.
        let last = self.target.len() - 1;
        self.target[0] = 0.0;
        self.target[last] = 0.0;
    }
}

impl Effect for PhaseShifter {
    fn set_param(&mut self, idx: u32, value: f32) {
        if !value.is_finite() {
            return;
        }
        match idx {
            0 => self.which = (value.round().clamp(0.0, 2.0)) as u32,
            1 => {
                let n = fft_size(value, 256, 16384);
                if n != self.stft.n {
                    self.stft = Stft::new(n, 4, self.channels);
                    self.alloc();
                }
            }
            2 => {
                self.log = value < 0.5;
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
        let which = self.which;
        let (target, current, cos, sin, fresh) = (&self.target, &mut self.current, &mut self.cos, &mut self.sin, &mut self.fresh);
        self.stft.process(buf, frames, |re, im| {
            let mut moved = *fresh;
            if *fresh {
                current.copy_from_slice(target);
                *fresh = false;
            } else {
                for (c, t) in current.iter_mut().zip(target) {
                    if (*c - *t).abs() > 1e-5 {
                        *c = *t + (*c - *t) * 0.6;
                        moved = true;
                    }
                }
            }
            if moved {
                for k in 0..current.len() {
                    cos[k] = current[k].cos();
                    sin[k] = current[k].sin();
                }
            }
            for ch in 0..re.len() {
                // With one channel, "right" has nothing to act on.
                let apply = match which {
                    0 => ch == 0,
                    1 => ch == 1,
                    _ => true,
                };
                if !apply {
                    continue;
                }
                for k in 0..cos.len() {
                    let (a, b) = (re[ch][k], im[ch][k]);
                    re[ch][k] = a * cos[k] - b * sin[k];
                    im[ch][k] = a * sin[k] + b * cos[k];
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

    #[test]
    fn rotates_phase_of_one_channel() {
        let r = 48000.0;
        let n = 24000;
        let x = sine(1000.0, r, n, 0.5);
        let mut fx = make(112, r, 2);
        // 90 degrees everywhere on the left channel.
        fx.set_data(0, &[20.0, 90.0, 20000.0, 90.0]);
        let (l, rr) = run_stereo(fx.as_mut(), &x, &x);
        let lat = fx.latency() as usize;
        // Right is the input delayed; left is a quarter cycle (12 samples at 1 kHz) behind... or ahead.
        for i in lat + 4096..n {
            assert!((rr[i] - x[i - lat]).abs() < 1e-3);
        }
        let shifted: Vec<f32> = (lat + 4096..n).map(|i| l[i]).collect();
        let lead: Vec<f32> = (lat + 4096..n).map(|i| x[i - lat + 12]).collect();
        let lag: Vec<f32> = (lat + 4096..n).map(|i| x[i - lat - 12]).collect();
        let err = |a: &[f32], b: &[f32]| rms(&a.iter().zip(b).map(|(p, q)| p - q).collect::<Vec<_>>());
        assert!(err(&shifted, &lead).min(err(&shifted, &lag)) < 0.01);
        // Magnitude is preserved.
        assert!((rms(&shifted) - rms(&lead)).abs() < 0.005);
    }
}
