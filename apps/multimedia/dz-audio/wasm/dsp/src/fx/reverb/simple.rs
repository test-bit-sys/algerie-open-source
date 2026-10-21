//! Reverb: a straightforward algorithmic reverb. The room grows with the
//! decay time; attack spreads the input over time so the reverb builds up
//! gradually instead of starting at full density.
//!
//! Params: 0 decay ms (T60), 1 pre-delay ms, 2 attack ms, 3 high cut Hz,
//! 4 low cut Hz, 5 diffusion %, 6 dry % (0..200), 7 wet % (0..500),
//! 8 perception % (0..200: absorbent surfaces lose their highs sooner,
//! reflective ones keep them and shimmer slightly), 9 sum inputs (0/1: both
//! channels feed the room as one source).

use super::fdn::{Diffuser, Fdn};
use super::reverb_tail;
use crate::fx::util::{Biquad, Coefs, DelayLine};
use crate::fx::{Effect, Smooth};

const MAX_SCALE: f32 = 1.6;
pub const MAX_PREDELAY_MS: f32 = 500.0;
pub const MAX_ATTACK_MS: f32 = 1000.0;
const SMEAR_TAPS: usize = 8;

pub struct Reverb {
    rate: f32,
    fdn: Fdn,
    diff: Diffuser,
    pre: [DelayLine; 2],
    pre_frames: usize,
    att: [DelayLine; 2],
    smear_t: [usize; SMEAR_TAPS],
    smear_g: [f32; SMEAR_TAPS],
    smear_n: usize,
    hp: [Biquad; 2],
    lp: [Biquad; 2],
    decay: f32,
    predelay: f32,
    attack: f32,
    high_cut: f32,
    low_cut: f32,
    diffusion: f32,
    perception: f32,
    sum: bool,
    dry: Smooth,
    wet: Smooth,
    fresh: bool,
}

impl Reverb {
    pub fn new(rate: f32, _channels: usize) -> Reverb {
        let pre = (MAX_PREDELAY_MS * rate / 1000.0) as usize + 2;
        let att = (MAX_ATTACK_MS * rate / 1000.0) as usize + 2;
        let mut r = Reverb {
            rate,
            fdn: Fdn::new(rate, MAX_SCALE),
            diff: Diffuser::new(rate, MAX_SCALE),
            pre: [DelayLine::new(pre), DelayLine::new(pre)],
            pre_frames: 0,
            att: [DelayLine::new(att), DelayLine::new(att)],
            smear_t: [0; SMEAR_TAPS],
            smear_g: [0.0; SMEAR_TAPS],
            smear_n: 1,
            hp: [Biquad::default(); 2],
            lp: [Biquad::default(); 2],
            decay: 2000.0,
            predelay: 20.0,
            attack: 0.0,
            high_cut: 7000.0,
            low_cut: 100.0,
            diffusion: 0.8,
            perception: 0.7,
            sum: false,
            dry: Smooth::new(0.8, rate, 20.0),
            wet: Smooth::new(0.35, rate, 20.0),
            fresh: true,
        };
        r.update();
        r
    }

    fn update(&mut self) {
        let t = self.decay / 1000.0;
        let scale = (0.45 + 0.22 * t).min(MAX_SCALE);
        // Perception 70 % keeps the original high-frequency decay (0.545 of the low).
        self.fdn.set(scale, t, 0.3 + 0.35 * self.perception, 0.15 + 0.15 * self.perception, 0.27);
        self.diff.set(self.diffusion, 0.5 + 0.5 * scale);
        self.pre_frames = (self.predelay * self.rate / 1000.0).round() as usize;
        let a = (self.attack * self.rate / 1000.0) as usize;
        if a < SMEAR_TAPS {
            self.smear_n = 1;
            self.smear_t[0] = 0;
            self.smear_g[0] = 1.0;
        } else {
            // A rising ramp of taps across the attack time, energy normalised.
            self.smear_n = SMEAR_TAPS;
            let mut e = 0.0;
            for k in 0..SMEAR_TAPS {
                self.smear_t[k] = a * k / (SMEAR_TAPS - 1);
                self.smear_g[k] = (k + 1) as f32;
                e += self.smear_g[k] * self.smear_g[k];
            }
            let n = 1.0 / e.sqrt();
            self.smear_g.iter_mut().for_each(|g| *g *= n);
        }
        let hp = Coefs::highpass(self.rate, self.low_cut, 0.7071);
        let lp = Coefs::lowpass(self.rate, self.high_cut, 0.7071);
        for c in 0..2 {
            self.hp[c].c = hp;
            self.lp[c].c = lp;
        }
    }
}

impl Effect for Reverb {
    fn set_param(&mut self, idx: u32, v: f32) {
        match idx {
            0 => self.decay = v.clamp(20.0, 30000.0),
            1 => self.predelay = v.clamp(0.0, MAX_PREDELAY_MS),
            2 => self.attack = v.clamp(0.0, MAX_ATTACK_MS),
            3 => self.high_cut = v.clamp(500.0, 22000.0),
            4 => self.low_cut = v.clamp(10.0, 2000.0),
            5 => self.diffusion = (v * 0.01).clamp(0.0, 1.0),
            6 => self.dry.target = (v * 0.01).clamp(0.0, 2.0),
            7 => self.wet.target = (v * 0.01).clamp(0.0, 5.0),
            8 => self.perception = (v * 0.01).clamp(0.0, 2.0),
            9 => self.sum = v >= 0.5,
            _ => return,
        }
        if idx < 6 || idx == 8 {
            self.update();
        }
    }

    fn process(&mut self, buf: &mut [f32], channels: usize, frames: usize) {
        if self.fresh {
            self.fresh = false;
            self.dry.settle();
            self.wet.settle();
        }
        let stereo = channels >= 2;
        for i in 0..frames {
            let x = [buf[i], if stereo { buf[frames + i] } else { buf[i] }];
            let (dry, wet) = (self.dry.next(), self.wet.next());
            let mut d = [0.0f32; 2];
            let m = 0.5 * (x[0] + x[1]);
            let send = if self.sum { [m, m] } else { x };
            for c in 0..2 {
                self.pre[c].push(send[c]);
                let p = self.pre[c].tap(self.pre_frames);
                self.att[c].push(p);
                let mut s = 0.0;
                for k in 0..self.smear_n {
                    s += self.att[c].tap(self.smear_t[k]) * self.smear_g[k];
                }
                d[c] = self.diff.process(c, s);
            }
            let (l, r) = self.fdn.process(d[0], d[1]);
            let wl = self.lp[0].process(self.hp[0].process(l));
            let wr = self.lp[1].process(self.hp[1].process(r));
            if stereo {
                buf[i] = x[0] * dry + wl * wet;
                buf[frames + i] = x[1] * dry + wr * wet;
            } else {
                buf[i] = x[0] * dry + 0.5 * (wl + wr) * wet;
            }
        }
        self.fdn.flush();
        for b in self.hp.iter_mut().chain(self.lp.iter_mut()) {
            b.flush();
        }
    }

    fn reset(&mut self) {
        self.fdn.reset();
        self.diff.clear();
        self.pre.iter_mut().chain(self.att.iter_mut()).for_each(|l| l.clear());
        for b in self.hp.iter_mut().chain(self.lp.iter_mut()) {
            b.reset();
        }
    }

    fn tail(&self) -> u32 {
        reverb_tail(self.decay + self.attack, self.predelay, self.rate)
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::*;
    use crate::fx::testutil::*;

    #[test]
    fn predelay_holds_off_the_reverb() {
        let rate = 48000.0;
        let mut fx = make(81, rate, 2);
        for (i, v) in [(1, 100.0), (6, 0.0), (7, 100.0)] {
            fx.set_param(i, v);
        }
        let (l, _) = impulse_response(fx.as_mut(), 0.5, rate);
        assert!(peak(&l[..4700]) < 1e-6);
        assert!(peak(&l[4800..]) > 1e-3);
        assert_eq!(fx.tail(), ((2000.0 + 100.0 + 250.0) * 48.0) as u32);
    }

    #[test]
    fn perception_keeps_or_loses_the_highs_and_sum_inputs_feeds_both_sides() {
        let rate = 48000.0;
        // High-frequency energy late in the tail: reflective keeps more than absorbent.
        let late_hf = |perception: f32| {
            let mut fx = make(81, rate, 1);
            for (i, v) in [(1, 0.0), (3, 20000.0), (6, 0.0), (7, 100.0), (8, perception)] {
                fx.set_param(i, v);
            }
            let (l, _) = impulse_response(fx.as_mut(), 1.0, rate);
            let hp: Vec<f32> = l.windows(2).map(|w| w[1] - w[0]).collect();
            rms(&hp[24000..47000]) / rms(&l[24000..47000]).max(1e-12)
        };
        assert!(late_hf(200.0) > late_hf(0.0) * 1.3, "{} vs {}", late_hf(200.0), late_hf(0.0));
        // Input on the left only: with Sum Inputs both outputs carry the same energy.
        let mut fx = make(81, rate, 2);
        for (i, v) in [(1, 0.0), (6, 0.0), (7, 100.0), (9, 1.0)] {
            fx.set_param(i, v);
        }
        let n = 48000;
        let mut l = vec![0.0f32; n];
        l[0] = 1.0;
        let r = vec![0.0f32; n];
        let (yl, yr) = run_stereo(fx.as_mut(), &l, &r);
        let (el, er) = (rms(&yl), rms(&yr));
        assert!((el / er - 1.0).abs() < 0.3, "{el} vs {er}");
    }

    #[test]
    fn attack_builds_up_slowly() {
        let rate = 48000.0;
        let energy_first = |attack: f32| {
            let mut fx = make(81, rate, 1);
            for (i, v) in [(1, 0.0), (2, attack), (6, 0.0), (7, 100.0)] {
                fx.set_param(i, v);
            }
            let (l, _) = impulse_response(fx.as_mut(), 1.0, rate);
            rms(&l[..4800]) / rms(&l[..48000])
        };
        assert!(energy_first(400.0) < energy_first(0.0) * 0.6);
    }

    #[test]
    fn decay_follows_parameter() {
        let rate = 48000.0;
        let mut fx = make(81, rate, 1);
        for (i, v) in [(0, 1500.0), (1, 0.0), (3, 20000.0), (4, 20.0), (6, 0.0), (7, 100.0)] {
            fx.set_param(i, v);
        }
        let (l, _) = impulse_response(fx.as_mut(), 2.0, rate);
        let est = t60(&l, rate);
        // High frequencies decay faster, so the broadband estimate runs short.
        assert!(est > 0.9 && est < 1.7, "{est}");
    }
}
