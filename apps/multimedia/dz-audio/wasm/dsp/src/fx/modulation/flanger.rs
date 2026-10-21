//! Flanger: a short delay swept between an initial and a final time, mixed
//! with the dry signal for moving comb notches.
//!
//! Params: 0 initial delay ms, 1 final delay ms, 2 stereo phasing degrees,
//! 3 feedback %, 4 modulation rate Hz, 5 inverted, 6 special effects,
//! 7 sinusoidal, 8 mix %, 9 output gain dB.
//!
//! Inverted flips the polarity of the delayed signal (notches move to where
//! the peaks were). Special effects blends a second, mirrored sweep in
//! opposite polarity for a deeper, more animated sound. Without sinusoidal
//! the sweep is triangular (linear in time).

use super::{fsin, ftri};
use crate::fx::delay::feedback_tail;
use crate::fx::util::{db_to_gain, sanitize, DelayLine};
use crate::fx::{Effect, Smooth};

pub const MAX_MS: f32 = 20.0;

pub struct Flanger {
    rate: f32,
    lines: [DelayLine; 2],
    init: Smooth,
    fin: Smooth,
    init_ms: f32,
    fin_ms: f32,
    phasing: f32,
    fb: f32,
    lfo_rate: f32,
    inverted: bool,
    special: bool,
    sinusoidal: bool,
    mix: Smooth,
    gain: Smooth,
    phase: f32,
    last: [f32; 2],
    fresh: bool,
}

impl Flanger {
    pub fn new(rate: f32, _channels: usize) -> Flanger {
        let max = (MAX_MS * rate / 1000.0) as usize + 8;
        Flanger {
            rate,
            lines: [DelayLine::new(max), DelayLine::new(max)],
            init: Smooth::new(1.0, rate, 50.0),
            fin: Smooth::new(5.0, rate, 50.0),
            init_ms: 1.0,
            fin_ms: 5.0,
            phasing: 0.25,
            fb: 0.5,
            lfo_rate: 0.3,
            inverted: false,
            special: false,
            sinusoidal: true,
            mix: Smooth::new(0.5, rate, 20.0),
            gain: Smooth::new(1.0, rate, 20.0),
            phase: 0.0,
            last: [0.0; 2],
            fresh: true,
        }
    }
}

impl Effect for Flanger {
    fn set_param(&mut self, idx: u32, v: f32) {
        match idx {
            0 => {
                self.init_ms = v.clamp(0.0, MAX_MS);
                self.init.target = self.init_ms;
            }
            1 => {
                self.fin_ms = v.clamp(0.0, MAX_MS);
                self.fin.target = self.fin_ms;
            }
            2 => self.phasing = v.clamp(0.0, 360.0) / 360.0,
            3 => self.fb = (v * 0.01).clamp(0.0, 0.95),
            4 => self.lfo_rate = v.clamp(0.0, 60.0),
            5 => self.inverted = v >= 0.5,
            6 => self.special = v >= 0.5,
            7 => self.sinusoidal = v >= 0.5,
            8 => self.mix.target = (v * 0.01).clamp(0.0, 1.0),
            9 => self.gain.target = db_to_gain(v.clamp(-40.0, 24.0)),
            _ => {}
        }
    }

    fn process(&mut self, buf: &mut [f32], channels: usize, frames: usize) {
        if self.fresh {
            self.fresh = false;
            for s in [&mut self.init, &mut self.fin, &mut self.mix, &mut self.gain] {
                s.settle();
            }
        }
        let ch = channels.min(2);
        let fpm = self.rate / 1000.0;
        let inc = self.lfo_rate / self.rate;
        let sign = if self.inverted { -1.0 } else { 1.0 };
        for i in 0..frames {
            self.phase += inc;
            if self.phase >= 1.0 {
                self.phase -= 1.0;
            }
            let (a, b) = (self.init.next(), self.fin.next());
            let (mix, gain) = (self.mix.next(), self.gain.next());
            for c in 0..ch {
                let p = self.phase + if c == 1 { self.phasing } else { 0.0 };
                let u = 0.5 + 0.5 * if self.sinusoidal { fsin(p) } else { ftri(p) };
                let ms = a + (b - a) * u;
                let line = &self.lines[c];
                let mut wet = line.tap_cubic((ms * fpm - 1.0).max(1.0)) * sign;
                if self.special {
                    let mirror = a + b - ms;
                    wet = 0.7 * wet - 0.5 * line.tap_cubic((mirror * fpm - 1.0).max(1.0)) * sign;
                }
                let x = buf[c * frames + i];
                self.lines[c].push(x + self.fb * self.last[c]);
                self.last[c] = wet;
                buf[c * frames + i] = gain * (x * (1.0 - mix) + wet * mix);
            }
        }
        self.last = [sanitize(self.last[0]), sanitize(self.last[1])];
    }

    fn reset(&mut self) {
        self.lines.iter_mut().for_each(|l| l.clear());
        self.last = [0.0; 2];
    }

    fn tail(&self) -> u32 {
        let ms = self.init_ms.max(self.fin_ms) as f64;
        feedback_tail(ms * self.rate as f64 / 1000.0, self.fb as f64, self.rate)
    }
}

#[cfg(test)]
mod tests {
    use crate::fx::testutil::*;

    /// Level of a steady sine through a static flanger (no sweep).
    fn static_gain(delay_ms: f32, f: f32, inverted: bool) -> f32 {
        let rate = 48000.0;
        let mut fx = make(71, rate, 1);
        for (i, v) in [(0, delay_ms), (1, delay_ms), (3, 0.0), (4, 0.0), (5, if inverted { 1.0 } else { 0.0 }), (8, 50.0)] {
            fx.set_param(i, v);
        }
        let x = sine(f, rate, 9600, 0.5);
        let y = run_mono(fx.as_mut(), &x);
        rms(&y[4800..]) / rms(&x[4800..])
    }

    #[test]
    fn comb_notches_follow_delay() {
        // 1 ms delay: notch at 500 Hz, peak at 1 kHz; inversion swaps them.
        assert!(static_gain(1.0, 500.0, false) < 0.05);
        assert!(static_gain(1.0, 1000.0, false) > 0.95);
        assert!(static_gain(1.0, 1000.0, true) < 0.05);
        assert!(static_gain(1.0, 500.0, true) > 0.95);
    }

    #[test]
    fn sweeps_and_stays_finite_with_feedback() {
        let rate = 48000.0;
        let mut fx = make(71, rate, 2);
        for (i, v) in [(0, 0.5), (1, 8.0), (2, 90.0), (3, 95.0), (4, 2.0), (6, 1.0)] {
            fx.set_param(i, v);
        }
        let x = noise(48000, 0.5, 4);
        let (l, r) = run_stereo(fx.as_mut(), &x, &x);
        assert!(peak(&l) < 8.0 && l.iter().chain(&r).all(|v| v.is_finite()));
        let diff: Vec<f32> = l.iter().zip(&r).map(|(a, b)| a - b).collect();
        assert!(rms(&diff) > 0.01, "stereo phasing should differ between channels");
    }
}
