//! Chorus/Flanger: a compact two-voice unit. Chorus mode sweeps a longer
//! delay in quadrature between the channels; flanger mode sweeps a short delay
//! with feedback. Transience emphasises the wet signal on attacks.
//!
//! Params: 0 mode (0 chorus, 1 flanger), 1 speed Hz, 2 width %, 3 intensity %
//! (feedback), 4 transience %, 5 mix %.

use super::fsin;
use crate::fx::delay::feedback_tail;
use crate::fx::util::{ms_coef, sanitize, DelayLine};
use crate::fx::{Effect, Smooth};

const CHORUS_MS: f32 = 18.0;
const CHORUS_SWEEP_MS: f32 = 8.0;
const FLANGE_MS: f32 = 3.0;
const FLANGE_SWEEP_MS: f32 = 2.8;

pub struct ChorusFlanger {
    rate: f32,
    lines: [DelayLine; 2],
    flanger: bool,
    speed: f32,
    width: Smooth,
    fb: f32,
    transience: f32,
    mix: Smooth,
    phase: f32,
    last: [f32; 2],
    fast: f32,
    slow: f32,
    fast_c: f32,
    slow_c: f32,
    fresh: bool,
}

impl ChorusFlanger {
    pub fn new(rate: f32, _channels: usize) -> ChorusFlanger {
        let max = ((CHORUS_MS + CHORUS_SWEEP_MS) * rate / 1000.0) as usize + 8;
        ChorusFlanger {
            rate,
            lines: [DelayLine::new(max), DelayLine::new(max)],
            flanger: false,
            speed: 0.8,
            width: Smooth::new(0.5, rate, 50.0),
            fb: 0.3,
            transience: 0.0,
            mix: Smooth::new(0.5, rate, 20.0),
            phase: 0.0,
            last: [0.0; 2],
            fast: 0.0,
            slow: 0.0,
            fast_c: ms_coef(2.0, rate),
            slow_c: ms_coef(60.0, rate),
            fresh: true,
        }
    }
}

impl Effect for ChorusFlanger {
    fn set_param(&mut self, idx: u32, v: f32) {
        match idx {
            0 => self.flanger = v >= 0.5,
            1 => self.speed = v.clamp(0.0, 50.0),
            2 => self.width.target = (v * 0.01).clamp(0.0, 1.0),
            3 => self.fb = (v * 0.01 * 0.9).clamp(0.0, 0.9),
            4 => self.transience = (v * 0.01).clamp(0.0, 1.0),
            5 => self.mix.target = (v * 0.01).clamp(0.0, 1.0),
            _ => {}
        }
    }

    fn process(&mut self, buf: &mut [f32], channels: usize, frames: usize) {
        if self.fresh {
            self.fresh = false;
            self.width.settle();
            self.mix.settle();
        }
        let ch = channels.min(2);
        let fpm = self.rate / 1000.0;
        let (base, sweep) = if self.flanger { (FLANGE_MS, FLANGE_SWEEP_MS) } else { (CHORUS_MS, CHORUS_SWEEP_MS) };
        let fb = if self.flanger { self.fb } else { self.fb * 0.5 };
        let inc = self.speed / self.rate;
        for i in 0..frames {
            self.phase += inc;
            if self.phase >= 1.0 {
                self.phase -= 1.0;
            }
            let (width, mix) = (self.width.next(), self.mix.next());
            // Transient detector on the mono input.
            let mut m = 0.0;
            for c in 0..ch {
                m += buf[c * frames + i].abs();
            }
            m /= ch as f32;
            self.fast = m + (self.fast - m) * self.fast_c;
            self.slow = m + (self.slow - m) * self.slow_c;
            let t = ((self.fast - self.slow) / (self.slow + 1e-3)).clamp(0.0, 4.0);
            let boost = 1.0 + self.transience * t;
            for c in 0..ch {
                let off = if c == 1 { 0.25 } else { 0.0 };
                let ms = base + sweep * width * fsin(self.phase + off);
                let wet = self.lines[c].tap_cubic((ms * fpm - 1.0).max(1.0));
                let x = buf[c * frames + i];
                self.lines[c].push(x + fb * self.last[c]);
                self.last[c] = wet;
                buf[c * frames + i] = x * (1.0 - mix) + wet * mix * boost.min(3.0);
            }
        }
        self.last = [sanitize(self.last[0]), sanitize(self.last[1])];
        self.fast = sanitize(self.fast);
        self.slow = sanitize(self.slow);
    }

    fn reset(&mut self) {
        self.lines.iter_mut().for_each(|l| l.clear());
        self.last = [0.0; 2];
        self.fast = 0.0;
        self.slow = 0.0;
    }

    fn tail(&self) -> u32 {
        let (ms, fb) = if self.flanger { (FLANGE_MS + FLANGE_SWEEP_MS, self.fb) } else { (CHORUS_MS + CHORUS_SWEEP_MS, self.fb * 0.5) };
        feedback_tail(ms as f64 * self.rate as f64 / 1000.0, fb as f64, self.rate)
    }
}

#[cfg(test)]
mod tests {
    use crate::fx::testutil::*;

    #[test]
    fn modes_differ_and_stay_finite() {
        let rate = 48000.0;
        let x = noise(24000, 0.5, 11);
        let mut out = Vec::new();
        for mode in [0.0, 1.0] {
            let mut fx = make(73, rate, 2);
            for (i, v) in [(0, mode), (2, 100.0), (3, 80.0), (4, 50.0), (5, 50.0)] {
                fx.set_param(i, v);
            }
            let (l, r) = run_stereo(fx.as_mut(), &x, &x);
            assert!(l.iter().chain(&r).all(|v| v.is_finite()) && peak(&l) < 6.0);
            out.push(l);
        }
        let diff: Vec<f32> = out[0].iter().zip(&out[1]).map(|(a, b)| a - b).collect();
        assert!(rms(&diff) > 0.05);
    }

    #[test]
    fn transience_lifts_attacks() {
        let rate = 48000.0;
        let mut x = vec![0.0f32; 24000];
        for i in 12000..24000 {
            x[i] = 0.5 * ((i as f32) * 0.05).sin();
        }
        let level = |tr: f32| {
            let mut fx = make(73, rate, 1);
            for (i, v) in [(4, tr), (5, 100.0), (3, 0.0)] {
                fx.set_param(i, v);
            }
            let y = run_mono(fx.as_mut(), &x);
            rms(&y[12000..13500])
        };
        assert!(level(100.0) > level(0.0) * 1.2);
    }
}
