//! Analog Delay: a feedback delay with character. Each mode shapes the
//! repeats differently inside the loop:
//!   0 Tape            gentle symmetric saturation, wow and flutter
//!   1 Tape and Tube   asymmetric (even harmonic) saturation, wow and flutter
//!   2 Analog          darker bucket brigade style filtering, harder clipping
//! Trash adds drive and noise; spread offsets the right channel's delay and
//! widens the repeats.
//!
//! Params: 0 mode, 1 dry %, 2 wet %, 3 delay ms, 4 feedback %, 5 trash %,
//! 6 spread %, 7 low cut Hz, 8 high cut Hz.

use super::{feedback_tail, soft_limit, tanh_r};
use crate::fx::util::{Biquad, Coefs, DelayLine, Rng, TAU};
use crate::fx::{Effect, Smooth};

pub const MAX_MS: f32 = 8000.0;
/// Right channel delay is longer by up to this fraction at 200 % spread.
const SPREAD_OFFSET: f32 = 0.08;
/// Wow (slow) and flutter (fast) depth as a fraction of the delay time.
const WOW: f32 = 0.0025;
const FLUTTER: f32 = 0.0004;

pub struct AnalogDelay {
    rate: f32,
    lines: [DelayLine; 2],
    time: [Smooth; 2],
    mode: u32,
    dry: Smooth,
    wet: Smooth,
    ms: f32,
    fb: f32,
    trash: f32,
    spread: f32,
    low_cut: f32,
    high_cut: f32,
    hp: [Biquad; 2],
    lp: [Biquad; 2],
    lp2: [Biquad; 2],
    wow: f32,
    flutter: f32,
    rng: Rng,
    fresh: bool,
}

impl AnalogDelay {
    pub fn new(rate: f32, _channels: usize) -> AnalogDelay {
        let max = (MAX_MS * (1.0 + SPREAD_OFFSET * 2.0) * 1.01 * 0.001 * rate) as usize + 16;
        let mut d = AnalogDelay {
            rate,
            lines: [DelayLine::new(max), DelayLine::new(max)],
            time: [Smooth::new(0.35 * rate, rate, 150.0), Smooth::new(0.35 * rate, rate, 150.0)],
            mode: 0,
            dry: Smooth::new(0.8, rate, 20.0),
            wet: Smooth::new(0.5, rate, 20.0),
            ms: 350.0,
            fb: 0.45,
            trash: 0.0,
            spread: 1.0,
            low_cut: 80.0,
            high_cut: 6000.0,
            hp: [Biquad::default(); 2],
            lp: [Biquad::default(); 2],
            lp2: [Biquad::default(); 2],
            wow: 0.0,
            flutter: 0.0,
            rng: Rng(0x2545_f491),
            fresh: true,
        };
        d.update();
        d
    }

    fn update(&mut self) {
        let r = self.rate;
        let hp = Coefs::highpass(r, self.low_cut, 0.7071);
        let lp = Coefs::lowpass(r, self.high_cut, 0.7071);
        // Bucket brigade devices roll off early; tape keeps a gentle top.
        let lp2 = match self.mode {
            2 => Coefs::lowpass(r, self.high_cut.min(3500.0), 0.6),
            1 => Coefs::high_shelf(r, 5000.0, 0.7071, -2.0),
            _ => Coefs::high_shelf(r, 8000.0, 0.7071, -1.0),
        };
        for c in 0..2 {
            self.hp[c].c = hp;
            self.lp[c].c = lp;
            self.lp2[c].c = lp2;
        }
        let base = self.ms * self.rate / 1000.0;
        self.time[0].target = base;
        self.time[1].target = base * (1.0 + SPREAD_OFFSET * self.spread);
    }

    #[inline]
    fn saturate(mode: u32, x: f32, drive: f32) -> f32 {
        match mode {
            1 => {
                let y = drive * x;
                tanh_r(y + 0.2 * y * y) / drive
            }
            // Clean until near full scale, then a short knee into clipping.
            2 => soft_limit(drive * x) / drive,
            _ => tanh_r(drive * x) / drive,
        }
    }
}

impl Effect for AnalogDelay {
    fn set_param(&mut self, idx: u32, v: f32) {
        match idx {
            0 => self.mode = (v.round() as u32).min(2),
            1 => self.dry.target = (v * 0.01).clamp(0.0, 2.0),
            2 => self.wet.target = (v * 0.01).clamp(0.0, 2.0),
            3 => self.ms = v.clamp(5.0, MAX_MS),
            4 => self.fb = (v * 0.01).clamp(0.0, 2.0),
            5 => self.trash = (v * 0.01).clamp(0.0, 1.0),
            6 => self.spread = (v * 0.01).clamp(0.0, 2.0),
            7 => self.low_cut = v.clamp(10.0, 2000.0),
            8 => self.high_cut = v.clamp(500.0, 20000.0),
            _ => {}
        }
        self.update();
    }

    fn process(&mut self, buf: &mut [f32], channels: usize, frames: usize) {
        if self.fresh {
            self.fresh = false;
            self.time.iter_mut().for_each(|s| s.settle());
            self.dry.settle();
            self.wet.settle();
        }
        let ch = channels.min(2);
        let tape = self.mode < 2;
        let drive = 1.0 + 4.0 * self.trash;
        let noise = if self.mode == 2 { 0.003 } else { 0.0015 } * self.trash * self.trash;
        let wow_inc = 0.55 / self.rate;
        let flutter_inc = 6.3 / self.rate;
        let width = (self.spread * 0.5).min(1.0);
        for i in 0..frames {
            self.wow = (self.wow + wow_inc).fract();
            self.flutter = (self.flutter + flutter_inc).fract();
            let m = if tape { 1.0 + WOW * (TAU * self.wow).sin() + FLUTTER * (TAU * self.flutter).sin() } else { 1.0 };
            let (dry, wet) = (self.dry.next(), self.wet.next());
            let mut w = [0.0f32; 2];
            for c in 0..ch {
                let d = (self.time[c].next() * m - 1.0).max(1.0);
                w[c] = self.lines[c].tap_cubic(d);
            }
            if ch == 2 {
                // Width of the repeats: 0 = mono, 1 = as delayed.
                let mid = 0.5 * (w[0] + w[1]);
                let side = 0.5 * (w[0] - w[1]) * width;
                w = [mid + side, mid - side];
            }
            for c in 0..ch {
                let x = buf[c * frames + i];
                // The whole wet path is coloured, so the first repeat already
                // has the mode's tone; feedback passes through it again.
                let v = x + w[c] * self.fb + noise * self.rng.bipolar();
                let f = self.lp2[c].process(self.lp[c].process(self.hp[c].process(v)));
                self.lines[c].push(Self::saturate(self.mode, f, drive));
                buf[c * frames + i] = x * dry + w[c] * wet;
            }
        }
        for b in self.hp.iter_mut().chain(self.lp.iter_mut()).chain(self.lp2.iter_mut()) {
            b.flush();
        }
    }

    fn reset(&mut self) {
        self.lines.iter_mut().for_each(|l| l.clear());
        for b in self.hp.iter_mut().chain(self.lp.iter_mut()).chain(self.lp2.iter_mut()) {
            b.reset();
        }
        self.time.iter_mut().for_each(|s| s.settle());
    }

    fn tail(&self) -> u32 {
        let longest = self.ms as f64 * (1.0 + SPREAD_OFFSET as f64 * self.spread as f64) * 1.003;
        feedback_tail(longest * 0.001 * self.rate as f64, self.fb as f64, self.rate)
    }
}

#[cfg(test)]
mod tests {
    use crate::fx::testutil::*;

    #[test]
    fn first_repeat_arrives_on_time() {
        for mode in 0..3 {
            let mut fx = make(62, 48000.0, 1);
            for (i, v) in [(0, mode as f32), (1, 0.0), (2, 100.0), (3, 100.0), (4, 0.0)] {
                fx.set_param(i, v);
            }
            let x = sine(440.0, 48000.0, 48000, 0.3);
            let mut xin = x.clone();
            xin[4800..].iter_mut().for_each(|v| *v = 0.0);
            let y = run_mono(fx.as_mut(), &xin);
            // Nothing before the delay, the tone after it, silence after the repeat.
            assert!(peak(&y[..4700]) < 1e-4, "mode {mode}");
            // Unity gain through the coloured path for a moderate tone.
            let r = rms(&y[5500..9000]) / rms(&x[5500..9000]);
            assert!(r > 0.8 && r < 1.15, "mode {mode}: {r}");
            assert!(peak(&y[10200..]) < 1e-3, "mode {mode}");
        }
    }

    #[test]
    fn feedback_above_unity_saturates_instead_of_exploding() {
        let mut fx = make(62, 48000.0, 2);
        for (i, v) in [(0, 1.0), (3, 20.0), (4, 120.0), (5, 100.0)] {
            fx.set_param(i, v);
        }
        let x = noise(96000, 0.5, 9);
        let (l, r) = run_stereo(fx.as_mut(), &x, &x);
        assert!(peak(&l) < 4.0 && peak(&r) < 4.0);
        assert!(fx.tail() == 30 * 48000);
    }

    #[test]
    fn spread_offsets_right_channel() {
        let mut fx = make(62, 48000.0, 2);
        for (i, v) in [(0, 2.0), (1, 0.0), (2, 100.0), (3, 100.0), (4, 0.0), (6, 200.0)] {
            fx.set_param(i, v);
        }
        let mut l = vec![0.0; 9600];
        l[0] = 1.0;
        let (ol, or) = run_stereo(fx.as_mut(), &l, &l);
        let argmax = |s: &[f32]| s.iter().enumerate().fold(0, |b, (i, v)| if v.abs() > s[b].abs() { i } else { b });
        let (pl, pr) = (argmax(&ol), argmax(&or));
        assert!((pl as i32 - 4800).abs() < 30, "{pl}");
        assert!(pr > pl + 600, "{pl} {pr}");
    }
}
