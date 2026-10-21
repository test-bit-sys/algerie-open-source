//! Loudness Meter (kind 94): passes audio through unchanged while measuring
//! it with the BS.1770-4 meter in `crate::loudness` (momentary, short-term
//! and gated integrated loudness, loudness range, true peak). Measurement
//! starts over on reset, which the host does when playback starts or seeks.
//!
//! Params: none that change the audio (the JS definition's target and
//!         ceiling only steer the display).
//! Readout: [momentary LUFS, short-term LUFS, integrated LUFS, loudness range
//!         LU, true peak L (linear), true peak R (linear), max momentary
//!         LUFS, max short-term LUFS, seconds measured, sample peak L and R
//!         (linear) since the previous readout]; loudness values are -inf
//!         until enough audio has passed.

use crate::fx::Effect;
use crate::loudness::Meter;

/// Integrated loudness and range are recomputed at most every this many
/// 100 ms sub-blocks (they scan the whole history).
const SLOW_EVERY: usize = 5;

pub struct LoudnessMeter {
    rate: f32,
    channels: usize,
    meter: Meter,
    integrated: f32,
    range: f32,
    slow_at: usize,
    frames: u64,
    /// Sample peak per channel since the last readout (the live input meter).
    recent_peak: [f32; 2],
}

impl LoudnessMeter {
    pub fn new(rate: f32, channels: usize) -> LoudnessMeter {
        LoudnessMeter {
            rate,
            channels,
            meter: Meter::new(rate as f64, channels),
            integrated: f32::NEG_INFINITY,
            range: 0.0,
            slow_at: 0,
            frames: 0,
            recent_peak: [0.0; 2],
        }
    }
}

fn f(v: f64) -> f32 {
    if v.is_finite() {
        v as f32
    } else {
        f32::NEG_INFINITY
    }
}

impl Effect for LoudnessMeter {
    fn set_param(&mut self, _idx: u32, _value: f32) {}

    fn process(&mut self, buf: &mut [f32], channels: usize, frames: usize) {
        if channels == self.channels {
            self.meter.push(buf, frames);
        } else {
            // The host always matches channel counts; stay safe if it does not.
            let n = self.channels.min(channels);
            let mut tmp = vec![0.0f32; self.channels * frames];
            for c in 0..self.channels {
                let src = c.min(n - 1);
                tmp[c * frames..(c + 1) * frames].copy_from_slice(&buf[src * frames..(src + 1) * frames]);
            }
            self.meter.push(&tmp, frames);
        }
        self.frames += frames as u64;
        for c in 0..channels.min(2) {
            let m = buf[c * frames..(c + 1) * frames].iter().fold(0.0f32, |m, v| m.max(v.abs()));
            self.recent_peak[c] = self.recent_peak[c].max(m);
        }
        if channels == 1 {
            self.recent_peak[1] = self.recent_peak[0];
        }
    }

    fn reset(&mut self) {
        self.meter = Meter::new(self.rate as f64, self.channels);
        self.integrated = f32::NEG_INFINITY;
        self.range = 0.0;
        self.slow_at = 0;
        self.frames = 0;
        self.recent_peak = [0.0; 2];
    }

    fn readout(&mut self, out: &mut [f32]) -> usize {
        if out.len() < 9 {
            return 0;
        }
        let m = &self.meter;
        let subs = m.subs.len();
        if subs >= self.slow_at + SLOW_EVERY || (subs > 0 && self.slow_at == 0) {
            self.integrated = f(m.integrated());
            self.range = m.range() as f32;
            self.slow_at = subs;
        }
        let tp = |c: usize| m.tp.peak[c].max(m.sample_peak[c]);
        out[0] = f(m.recent(4));
        out[1] = f(m.recent(30));
        out[2] = self.integrated;
        out[3] = self.range;
        out[4] = tp(0);
        out[5] = tp(if self.channels > 1 { 1 } else { 0 });
        out[6] = f(m.max_window(4));
        out[7] = f(m.max_window(30));
        out[8] = (self.frames as f64 / self.rate as f64) as f32;
        if out.len() < 11 {
            return 9;
        }
        out[9] = self.recent_peak[0];
        out[10] = self.recent_peak[1];
        self.recent_peak = [0.0; 2];
        11
    }
}

#[cfg(test)]
mod tests {
    use crate::fx::testutil::*;

    #[test]
    fn passes_audio_through_and_measures_it() {
        let rate = 48000.0;
        // A 1 kHz stereo sine at -20 dBFS reads -20 LUFS (BS.1770 calibration).
        let amp = 10f32.powf(-20.0 / 20.0);
        let x = sine(1000.0, rate, 4 * 48000, amp);
        let mut fx = make(94, rate, 2);
        let (l, r) = run_stereo(fx.as_mut(), &x, &x);
        assert_eq!(l, x);
        assert_eq!(r, x);
        let mut out = [0.0f32; 12];
        assert_eq!(fx.readout(&mut out), 11);
        assert!((out[9] - amp).abs() < 0.01 && (out[10] - amp).abs() < 0.01);
        // The live peak starts over after each readout.
        fx.readout(&mut out);
        assert_eq!(out[9], 0.0);
        for (i, v) in out[..3].iter().enumerate() {
            assert!((v + 20.0).abs() < 0.1, "{i}: {v}");
        }
        assert!(out[3].abs() < 0.5, "range {}", out[3]);
        assert!((out[4] - amp).abs() < 0.01 && (out[5] - amp).abs() < 0.01);
        assert!((out[8] - 4.0).abs() < 1e-3);
    }

    #[test]
    fn starts_over_on_reset() {
        let mut fx = make(94, 48000.0, 1);
        let x = sine(1000.0, 48000.0, 48000, 0.5);
        run_mono(fx.as_mut(), &x);
        fx.reset();
        let mut out = [0.0f32; 9];
        fx.readout(&mut out);
        assert!(out[0] == f32::NEG_INFINITY && out[2] == f32::NEG_INFINITY);
        assert_eq!(out[8], 0.0);
    }
}
