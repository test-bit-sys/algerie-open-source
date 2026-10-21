//! Studio Reverb: diffused input into an 8-line FDN plus a room-scaled early
//! reflection pattern, with output tone controls and stereo width.
//!
//! Params: 0 room size %, 1 decay ms (T60), 2 early reflections %,
//! 3 stereo width %, 4 high frequency cut Hz, 5 low frequency cut Hz,
//! 6 damping % (faster high frequency decay), 7 diffusion %, 8 dry %, 9 wet %.

use super::fdn::{Diffuser, EarlyTaps, Fdn};
use super::reverb_tail;
use crate::fx::util::{Biquad, Coefs};
use crate::fx::{Effect, Smooth};

const MAX_SCALE: f32 = 1.6;
/// Early reflection pattern at scale 1: (ms, gain) for left; right is offset.
const ER_MS: [f32; 10] = [7.3, 11.9, 16.1, 21.7, 26.3, 31.9, 38.3, 43.1, 51.7, 59.3];
const ER_GAIN: [f32; 10] = [0.84, -0.71, 0.66, 0.55, -0.49, 0.41, -0.36, 0.30, 0.25, -0.21];

pub struct StudioReverb {
    rate: f32,
    fdn: Fdn,
    diff: Diffuser,
    er: [EarlyTaps; 2],
    hp: [Biquad; 2],
    lp: [Biquad; 2],
    size: f32,
    decay: f32,
    early: Smooth,
    width: Smooth,
    hf_cut: f32,
    lf_cut: f32,
    damping: f32,
    diffusion: f32,
    dry: Smooth,
    wet: Smooth,
    fresh: bool,
}

impl StudioReverb {
    pub fn new(rate: f32, _channels: usize) -> StudioReverb {
        let er_max = ((ER_MS[9] * 1.1 * MAX_SCALE + 2.0) * rate / 1000.0) as usize;
        let mut r = StudioReverb {
            rate,
            fdn: Fdn::new(rate, MAX_SCALE),
            diff: Diffuser::new(rate, MAX_SCALE),
            er: [EarlyTaps::new(er_max), EarlyTaps::new(er_max)],
            hp: [Biquad::default(); 2],
            lp: [Biquad::default(); 2],
            size: 0.5,
            decay: 1500.0,
            early: Smooth::new(0.5, rate, 20.0),
            width: Smooth::new(1.0, rate, 20.0),
            hf_cut: 8000.0,
            lf_cut: 80.0,
            damping: 0.5,
            diffusion: 0.8,
            dry: Smooth::new(0.9, rate, 20.0),
            wet: Smooth::new(0.4, rate, 20.0),
            fresh: true,
        };
        r.update();
        r
    }

    fn update(&mut self) {
        let scale = 0.4 + 1.2 * self.size;
        self.fdn.set(scale, self.decay / 1000.0, 1.0 - 0.85 * self.damping, 0.12 + 0.2 * self.diffusion, 0.31);
        self.diff.set(self.diffusion, 0.5 + 0.5 * scale);
        let fpm = self.rate / 1000.0;
        for c in 0..2 {
            let er = &mut self.er[c];
            let max = er.max_frames();
            er.count = ER_MS.len();
            for k in 0..ER_MS.len() {
                let ms = ER_MS[k] * scale * if c == 1 { 1.07 } else { 1.0 } + if c == 1 { 1.3 } else { 0.0 };
                er.times[k] = ((ms * fpm) as usize).min(max);
                let g = ER_GAIN[k] * if c == 1 && k % 3 == 1 { -1.0 } else { 1.0 };
                // Sparser, quieter reflections at low diffusion.
                er.gains[k] = g * (0.55 + 0.45 * self.diffusion) * 0.6;
            }
        }
        let hp = Coefs::highpass(self.rate, self.lf_cut, 0.7071);
        let lp = Coefs::lowpass(self.rate, self.hf_cut, 0.7071);
        for c in 0..2 {
            self.hp[c].c = hp;
            self.lp[c].c = lp;
        }
    }
}

impl Effect for StudioReverb {
    fn set_param(&mut self, idx: u32, v: f32) {
        match idx {
            0 => self.size = (v * 0.01).clamp(0.0, 1.0),
            1 => self.decay = v.clamp(50.0, 30000.0),
            2 => self.early.target = (v * 0.01).clamp(0.0, 1.0),
            3 => self.width.target = (v * 0.01).clamp(0.0, 1.0),
            4 => self.hf_cut = v.clamp(20.0, 22000.0),
            5 => self.lf_cut = v.clamp(10.0, 4000.0),
            6 => self.damping = (v * 0.01).clamp(0.0, 1.0),
            7 => self.diffusion = (v * 0.01).clamp(0.0, 1.0),
            8 => self.dry.target = (v * 0.01).clamp(0.0, 1.0),
            9 => self.wet.target = (v * 0.01).clamp(0.0, 1.0),
            _ => return,
        }
        if !(2..=3).contains(&idx) && idx < 8 {
            self.update();
        }
    }

    fn process(&mut self, buf: &mut [f32], channels: usize, frames: usize) {
        if self.fresh {
            self.fresh = false;
            for s in [&mut self.early, &mut self.width, &mut self.dry, &mut self.wet] {
                s.settle();
            }
        }
        let stereo = channels >= 2;
        for i in 0..frames {
            let xl = buf[i];
            let xr = if stereo { buf[frames + i] } else { xl };
            let (early, width) = (self.early.next(), self.width.next());
            let (dry, wet) = (self.dry.next(), self.wet.next());
            let el = self.er[0].process(xl);
            let er = self.er[1].process(xr);
            let dl = self.diff.process(0, xl);
            let dr = self.diff.process(1, xr);
            let (ll, lr) = self.fdn.process(dl + el * 0.3, dr + er * 0.3);
            let mut wl = ll + el * early;
            let mut wr = lr + er * early;
            wl = self.lp[0].process(self.hp[0].process(wl));
            wr = self.lp[1].process(self.hp[1].process(wr));
            let mid = 0.5 * (wl + wr);
            let side = 0.5 * (wl - wr) * width;
            if stereo {
                buf[i] = xl * dry + (mid + side) * wet;
                buf[frames + i] = xr * dry + (mid - side) * wet;
            } else {
                buf[i] = xl * dry + mid * wet;
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
        self.er.iter_mut().for_each(|e| e.clear());
        for b in self.hp.iter_mut().chain(self.lp.iter_mut()) {
            b.reset();
        }
    }

    fn tail(&self) -> u32 {
        reverb_tail(self.decay, 0.0, self.rate)
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::*;
    use crate::fx::testutil::*;

    #[test]
    fn decay_follows_parameter() {
        let rate = 48000.0;
        for decay in [800.0f32, 3000.0] {
            let mut fx = make(80, rate, 2);
            for (i, v) in [(1, decay), (2, 0.0), (4, 20000.0), (5, 20.0), (6, 0.0), (8, 0.0), (9, 100.0)] {
                fx.set_param(i, v);
            }
            let (l, _) = impulse_response(fx.as_mut(), decay / 1000.0 * 1.3, rate);
            let est = t60(&l, rate);
            assert!((est * 1000.0 - decay).abs() < decay * 0.2, "{decay}: {est}");
            assert_eq!(fx.tail(), ((decay as f64 + 250.0) * 48.0).round() as u32);
        }
    }

    #[test]
    fn width_zero_is_mono_and_level_is_sane() {
        let rate = 48000.0;
        let mut fx = make(80, rate, 2);
        for (i, v) in [(3, 0.0), (8, 0.0), (9, 100.0)] {
            fx.set_param(i, v);
        }
        let x = noise(48000, 0.3, 1);
        let y = noise(48000, 0.3, 2);
        let (l, r) = run_stereo(fx.as_mut(), &x, &y);
        for i in 0..l.len() {
            assert!((l[i] - r[i]).abs() < 1e-5);
        }
        let ratio = rms(&l[24000..]) / 0.3 * 3f32.sqrt();
        assert!(ratio > 0.1 && ratio < 3.0, "{ratio}");
    }

    #[test]
    fn damping_darkens_the_tail() {
        let rate = 48000.0;
        let hf = |damp: f32| {
            let mut fx = make(80, rate, 1);
            for (i, v) in [(6, damp), (2, 0.0), (8, 0.0), (9, 100.0), (4, 20000.0)] {
                fx.set_param(i, v);
            }
            let (l, _) = impulse_response(fx.as_mut(), 1.0, rate);
            let s = &l[24000..36000];
            s.windows(2).map(|w| (w[1] - w[0]).powi(2)).sum::<f32>() / s.iter().map(|v| v * v).sum::<f32>()
        };
        assert!(hf(100.0) < hf(0.0) * 0.5);
    }
}
