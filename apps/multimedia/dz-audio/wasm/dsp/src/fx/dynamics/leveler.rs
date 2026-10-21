//! Speech Volume Leveler (kind 36): a slow RMS automatic gain control that
//! moves speech toward a target level, holds its gain through pauses, gently
//! expands noise below the gate threshold, and never clips.
//!
//! Params: 0 target level dB (RMS), 1 leveling amount %, 2 noise gate on,
//!   3 noise gate threshold dB, 4 attack ms (gain falling), 5 release ms
//!   (gain rising), 6 maximum boost dB, 7 maximum cut dB, 8 target dynamic
//!   range dB (passages further than this below the target are background:
//!   their gain is held instead of raised), 9 boost low signals (level those
//!   passages too).

use super::common::{db_lin, frame_peak, lin_db, Detector, GainSmoother};
use crate::fx::util::{expand_db, ms_coef};
use crate::fx::Effect;

const WINDOW_MS: f32 = 50.0;
const GATE_RATIO: f32 = 2.0;
const SAFE_PEAK: f32 = 0.98;

pub struct Leveler {
    rate: f32,
    target: f32,
    amount: f32,
    gate_on: bool,
    gate_thr: f32,
    max_boost: f32,
    max_cut: f32,
    range: f32,
    boost_low: bool,
    det: Detector,
    agc: GainSmoother,
    gate: GainSmoother,
    peak_env: f32,
    peak_rel: f32,
}

impl Leveler {
    pub fn new(rate: f32, _channels: usize) -> Leveler {
        let mut l = Leveler {
            rate,
            target: -18.0,
            amount: 0.6,
            gate_on: true,
            gate_thr: -50.0,
            max_boost: 15.0,
            max_cut: 15.0,
            range: 45.0,
            boost_low: false,
            det: Detector::default(),
            agc: GainSmoother::default(),
            gate: GainSmoother::default(),
            peak_env: 0.0,
            peak_rel: ms_coef(50.0, rate),
        };
        l.det.set(rate, WINDOW_MS, WINDOW_MS, true);
        l.agc.set(rate, 300.0, 1500.0);
        l.gate.set(rate, 50.0, 10.0);
        l
    }
}

impl Effect for Leveler {
    fn set_param(&mut self, idx: u32, v: f32) {
        match idx {
            0 => self.target = v.clamp(-60.0, 0.0),
            1 => self.amount = (v * 0.01).clamp(0.0, 1.0),
            2 => self.gate_on = v >= 0.5,
            3 => self.gate_thr = v.clamp(-100.0, 0.0),
            4 => self.agc.att = ms_coef(v.max(1.0), self.rate),
            5 => self.agc.rel = ms_coef(v.max(1.0), self.rate),
            6 => self.max_boost = v.clamp(0.0, 48.0),
            7 => self.max_cut = v.clamp(0.0, 48.0),
            8 => self.range = v.clamp(1.0, 120.0),
            9 => self.boost_low = v >= 0.5,
            _ => {}
        }
    }
    fn process(&mut self, buf: &mut [f32], channels: usize, frames: usize) {
        for i in 0..frames {
            let p = frame_peak(buf, channels, frames, i);
            let level = lin_db(self.det.next(p) + 1e-10);
            let background = !self.boost_low && level < self.target - self.range;
            let quiet = (self.gate_on && level < self.gate_thr) || background;
            let g = if quiet {
                // Hold the speech gain through pauses.
                self.agc.db
            } else {
                let want = ((self.target - level) * self.amount).clamp(-self.max_cut, self.max_boost);
                self.agc.next(want)
            };
            let gate_db = if self.gate_on { self.gate.next(expand_db(level, self.gate_thr, GATE_RATIO, 6.0)) } else { self.gate.next(0.0) };
            let mut gain = db_lin(g + gate_db);
            // Never let the boost clip: instant-attack peak guard.
            let out_peak = p * gain;
            self.peak_env = if out_peak > self.peak_env { out_peak } else { out_peak + (self.peak_env - out_peak) * self.peak_rel };
            if self.peak_env > SAFE_PEAK {
                gain *= SAFE_PEAK / self.peak_env;
            }
            for c in 0..channels {
                buf[c * frames + i] *= gain;
            }
        }
    }
    fn reset(&mut self) {
        self.det.reset();
        self.agc.reset();
        self.gate.reset();
        self.peak_env = 0.0;
    }
}

#[cfg(test)]
mod tests {
    use crate::fx::testutil::*;
    use crate::fx::util::gain_to_db;

    fn out_level(amp: f32, params: &[(u32, f32)]) -> f32 {
        let r = 48000.0;
        let mut fx = make(36, r, 1);
        for &(i, v) in params {
            fx.set_param(i, v);
        }
        fx.reset();
        let x = sine(400.0, r, 48000 * 6, amp);
        let y = run_mono(fx.as_mut(), &x);
        gain_to_db(rms(&y[48000 * 5..]))
    }

    #[test]
    fn levels_toward_the_target() {
        let full = [(0, -20.0), (1, 100.0), (5, 500.0), (6, 24.0)];
        assert!((out_level(0.02, &full) + 20.0).abs() < 0.5); // -37 dB in -> -20 out
        assert!((out_level(0.5, &full) + 20.0).abs() < 0.5); // -9 dB in -> -20 out
        // Half the amount moves half way.
        let half = out_level(0.02, &[(0, -20.0), (1, 50.0), (5, 500.0)]);
        assert!((half + 28.5).abs() < 0.7, "{half}");
        // Boost is capped.
        let capped = out_level(0.002, &[(0, -20.0), (1, 100.0), (3, -80.0), (5, 500.0), (6, 10.0)]);
        assert!((capped + 47.0).abs() < 0.7, "{capped}");
    }

    #[test]
    fn gate_does_not_raise_noise() {
        let gated = out_level(0.0005, &[(0, -20.0), (1, 100.0), (3, -50.0)]);
        assert!(gated < -70.0, "{gated}");
    }

    #[test]
    fn dynamic_range_holds_background_unless_boosting_low_signals() {
        // -57 dB RMS speech-like tone, 37 dB below the target: background with a 20 dB range.
        let held = out_level(0.002, &[(0, -20.0), (1, 100.0), (3, -90.0), (5, 500.0), (6, 40.0), (8, 20.0)]);
        assert!((held + 57.0).abs() < 1.0, "{held}");
        let boosted = out_level(0.002, &[(0, -20.0), (1, 100.0), (3, -90.0), (5, 500.0), (6, 40.0), (8, 20.0), (9, 1.0)]);
        assert!((boosted + 20.0).abs() < 1.0, "{boosted}");
    }

    #[test]
    fn never_clips() {
        let r = 48000.0;
        let mut fx = make(36, r, 1);
        fx.set_param(0, -3.0);
        fx.set_param(1, 100.0);
        fx.set_param(6, 30.0);
        fx.reset();
        let mut x = sine(400.0, r, 48000 * 4, 0.02);
        for v in &mut x[48000 * 3..] {
            *v *= 45.0;
        }
        let y = run_mono(fx.as_mut(), &x);
        assert!(peak(&y) <= 0.999);
    }
}
