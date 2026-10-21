//! Echo: repeating echoes with per-channel delay, feedback and level, an
//! optional left/right lock, echo bounce (echoes alternate between channels)
//! and an 8-band successive echo EQ inside the feedback loop, so each repeat
//! is filtered again.
//!
//! Params: 0 left delay ms, 1 left feedback %, 2 left echo level %,
//! 3 right delay ms, 4 right feedback %, 5 right echo level %, 6 lock,
//! 7 bounce, 8..15 EQ band gains dB at 100 Hz .. 12.8 kHz (the outer two are
//! shelves), 16 dry %.

use super::{feedback_tail, soft_limit};
use crate::fx::util::{db_to_gain, Biquad, Coefs, DelayLine};
use crate::fx::{Effect, Smooth};

pub const MAX_MS: f32 = 5000.0;
pub const BANDS: [f32; 8] = [100.0, 200.0, 400.0, 800.0, 1600.0, 3200.0, 6400.0, 12800.0];

pub struct Echo {
    rate: f32,
    lines: [DelayLine; 2],
    time: [Smooth; 2],
    ms: [f32; 2],
    fb: [f32; 2],
    level: [f32; 2],
    lock: bool,
    bounce: bool,
    eq_db: [f32; 8],
    eq: [[Biquad; 8]; 2],
    eq_on: bool,
    dry: f32,
    fresh: bool,
}

impl Echo {
    pub fn new(rate: f32, _channels: usize) -> Echo {
        let max = (MAX_MS * 0.001 * rate) as usize + 8;
        let t = 0.3 * rate;
        let mut e = Echo {
            rate,
            lines: [DelayLine::new(max), DelayLine::new(max)],
            time: [Smooth::new(t, rate, 80.0), Smooth::new(t, rate, 80.0)],
            ms: [300.0; 2],
            fb: [0.4; 2],
            level: [0.6; 2],
            lock: true,
            bounce: false,
            eq_db: [0.0; 8],
            eq: [[Biquad::default(); 8]; 2],
            eq_on: false,
            dry: 1.0,
            fresh: true,
        };
        e.update_eq();
        e
    }

    fn update_eq(&mut self) {
        self.eq_on = self.eq_db.iter().any(|g| g.abs() > 1e-3);
        for (b, &f) in BANDS.iter().enumerate() {
            // The outer bands are shelves so a cut also covers the extremes.
            let g = self.eq_db[b];
            let c = if f >= self.rate * 0.45 {
                Coefs::IDENTITY
            } else if b == 0 {
                Coefs::low_shelf(self.rate, f * 1.41, 0.7071, g)
            } else if b == BANDS.len() - 1 {
                Coefs::high_shelf(self.rate, f / 1.41, 0.7071, g)
            } else {
                Coefs::peaking(self.rate, f, 1.41, g)
            };
            self.eq[0][b].c = c;
            self.eq[1][b].c = c;
        }
    }

    fn side(&self, c: usize) -> usize {
        if self.lock {
            0
        } else {
            c
        }
    }

    /// Largest per-pass loop gain (feedback times the strongest EQ boost).
    pub fn loop_gain(&self) -> f64 {
        let boost = self.eq_db.iter().fold(0.0f32, |m, &g| m.max(g));
        let fb = if self.lock { self.fb[0] } else { self.fb[0].max(self.fb[1]) };
        fb as f64 * db_to_gain(boost) as f64
    }
}

impl Effect for Echo {
    fn set_param(&mut self, idx: u32, v: f32) {
        match idx {
            0 | 3 => {
                let c = (idx / 3) as usize;
                self.ms[c] = v.clamp(1.0, MAX_MS);
            }
            1 | 4 => self.fb[(idx / 3) as usize] = (v * 0.01).clamp(0.0, 1.0),
            2 | 5 => self.level[(idx / 3) as usize] = (v * 0.01).clamp(0.0, 1.0),
            6 => self.lock = v >= 0.5,
            7 => self.bounce = v >= 0.5,
            8..=15 => {
                self.eq_db[(idx - 8) as usize] = v.clamp(-40.0, 15.0);
                self.update_eq();
            }
            16 => self.dry = (v * 0.01).clamp(0.0, 1.0),
            _ => {}
        }
        for c in 0..2 {
            let s = self.side(c);
            self.time[c].target = self.ms[s] * self.rate / 1000.0;
        }
    }

    fn process(&mut self, buf: &mut [f32], channels: usize, frames: usize) {
        if self.fresh {
            self.fresh = false;
            self.time.iter_mut().for_each(|s| s.settle());
        }
        let stereo = channels >= 2;
        let (s0, s1) = (self.side(0), self.side(1));
        let fb = [self.fb[s0], self.fb[s1]];
        let level = [self.level[s0], self.level[s1]];
        let bounce = self.bounce && stereo;
        for i in 0..frames {
            let mut w = [0.0f32; 2];
            let mut back = [0.0f32; 2];
            for c in 0..channels.min(2) {
                let d = (self.time[c].next() - 1.0).max(0.0);
                w[c] = self.lines[c].tap_linear(d);
                let mut f = w[c];
                if self.eq_on {
                    for b in &mut self.eq[c] {
                        f = b.process(f);
                    }
                }
                back[c] = soft_limit(f * fb[c]);
            }
            if bounce {
                back.swap(0, 1);
            }
            for c in 0..channels.min(2) {
                let x = buf[c * frames + i];
                self.lines[c].push(x + back[c]);
                buf[c * frames + i] = x * self.dry + w[c] * level[c];
            }
        }
        for row in &mut self.eq {
            row.iter_mut().for_each(|b| b.flush());
        }
    }

    fn reset(&mut self) {
        self.lines.iter_mut().for_each(|l| l.clear());
        self.eq.iter_mut().flatten().for_each(|b| b.reset());
        self.time.iter_mut().for_each(|s| s.settle());
    }

    fn tail(&self) -> u32 {
        let ms = if self.lock { self.ms[0] } else { self.ms[0].max(self.ms[1]) } as f64;
        feedback_tail(ms * 0.001 * self.rate as f64, self.loop_gain(), self.rate)
    }
}

#[cfg(test)]
mod tests {
    use crate::fx::testutil::*;

    fn impulse(n: usize) -> Vec<f32> {
        let mut x = vec![0.0; n];
        x[0] = 1.0;
        x
    }

    #[test]
    fn repeats_decay_by_feedback() {
        let mut fx = make(61, 48000.0, 2);
        for (i, v) in [(0, 10.0), (1, 50.0), (2, 100.0), (6, 1.0), (16, 0.0)] {
            fx.set_param(i, v);
        }
        let (l, _) = run_stereo(fx.as_mut(), &impulse(2000), &vec![0.0; 2000]);
        assert!((l[480] - 1.0).abs() < 1e-4, "{}", l[480]);
        assert!((l[960] - 0.5).abs() < 1e-4, "{}", l[960]);
        assert!((l[1440] - 0.25).abs() < 1e-4, "{}", l[1440]);
    }

    #[test]
    fn bounce_alternates_channels() {
        let mut fx = make(61, 48000.0, 2);
        for (i, v) in [(0, 10.0), (1, 50.0), (2, 100.0), (6, 1.0), (7, 1.0), (16, 0.0)] {
            fx.set_param(i, v);
        }
        let (l, r) = run_stereo(fx.as_mut(), &impulse(2000), &vec![0.0; 2000]);
        assert!(l[480] > 0.9 && r[480].abs() < 1e-6);
        assert!(r[960] > 0.4 && l[960].abs() < 1e-6);
        assert!(l[1440] > 0.2);
    }

    #[test]
    fn successive_eq_darkens_repeats() {
        let rate = 48000.0;
        let mut fx = make(61, rate, 1);
        for (i, v) in [(0, 50.0), (1, 90.0), (2, 100.0), (16, 0.0), (15, -20.0), (14, -20.0)] {
            fx.set_param(i, v);
        }
        let x = noise(48000, 0.3, 3);
        let mut xin = x.clone();
        xin[2400..].iter_mut().for_each(|v| *v = 0.0);
        let y = run_mono(fx.as_mut(), &xin);
        // High-passed energy of later repeats falls faster than full-band energy.
        let hp = |s: &[f32]| s.windows(2).map(|w| (w[1] - w[0]).powi(2)).sum::<f32>() / s.iter().map(|v| v * v).sum::<f32>().max(1e-12);
        let early = hp(&y[2400..4800]);
        let late = hp(&y[24000..26400]);
        assert!(late < early * 0.5, "{early} {late}");
        assert!(fx.tail() > 2400);
    }

    #[test]
    fn full_feedback_stays_bounded() {
        let mut fx = make(61, 48000.0, 2);
        for (i, v) in [(0, 5.0), (1, 100.0), (2, 100.0), (8, 15.0)] {
            fx.set_param(i, v);
        }
        let x = noise(48000, 0.9, 5);
        let (l, _) = run_stereo(fx.as_mut(), &x, &x);
        assert!(peak(&l) < 3.0);
        assert!(l.iter().all(|v| v.is_finite()));
    }
}
