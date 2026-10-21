//! Vocal Enhancer: fixed filter networks plus light compression, voiced for
//! a low voice (warmth, less mud), a high voice (presence, air) or a music
//! bed (a gentle midrange dip that leaves room for speech).
//!
//! Params: 0 mode (0 male voice, 1 female voice, 2 music), 1 amount %.

use crate::fx::util::{compress_db, db_to_gain, gain_to_db, Biquad, Coefs, Envelope};
use crate::fx::{Effect, Smooth};

#[derive(Clone, Copy)]
enum Band {
    Peak(f32, f32, f32),
    HighShelf(f32, f32),
}

struct Voicing {
    hp: f32,
    bands: [Band; 3],
    thr: f32,
    ratio: f32,
}

const VOICINGS: [Voicing; 3] = [
    Voicing { hp: 80.0, bands: [Band::Peak(150.0, 2.0, 0.9), Band::Peak(350.0, -3.0, 1.2), Band::Peak(3000.0, 2.5, 1.0)], thr: -20.0, ratio: 3.0 },
    Voicing { hp: 120.0, bands: [Band::Peak(250.0, -2.0, 1.0), Band::Peak(4500.0, 3.0, 0.9), Band::HighShelf(10000.0, 3.0)], thr: -20.0, ratio: 2.5 },
    Voicing { hp: 30.0, bands: [Band::Peak(1000.0, -1.5, 0.7), Band::Peak(2500.0, -4.0, 0.8), Band::HighShelf(12000.0, 1.0)], thr: 0.0, ratio: 1.0 },
];

pub struct VocalEnhancer {
    rate: f32,
    channels: usize,
    mode: usize,
    amount: f32,
    filters: [[Biquad; 5]; 2],
    env: Envelope,
    thr: f32,
    ratio: f32,
    makeup: f32,
    gain: Smooth,
}

impl VocalEnhancer {
    pub fn new(rate: f32, channels: usize) -> VocalEnhancer {
        let mut v = VocalEnhancer {
            rate,
            channels,
            mode: 0,
            amount: 1.0,
            filters: [[Biquad::default(); 5]; 2],
            env: Envelope::new(rate, 8.0, 180.0),
            thr: 0.0,
            ratio: 1.0,
            makeup: 1.0,
            gain: Smooth::new(1.0, rate, 5.0),
        };
        v.update();
        v
    }

    fn update(&mut self) {
        let v = &VOICINGS[self.mode.min(2)];
        let a = self.amount;
        let r = self.rate;
        // HP glides from 20 Hz (amount 0) to its voicing frequency.
        let hp = 20.0 * (v.hp / 20.0).powf(a);
        let mut cs = [Coefs::IDENTITY; 5];
        cs[0] = Coefs::highpass(r, hp, 0.707);
        cs[1] = Coefs::highpass(r, hp, 0.707);
        for (i, b) in v.bands.iter().enumerate() {
            cs[i + 2] = match *b {
                Band::Peak(f, g, q) => Coefs::peaking(r, f, q, g * a),
                Band::HighShelf(f, g) => Coefs::high_shelf(r, f, 0.707, g * a),
            };
        }
        for ch in &mut self.filters {
            for (b, c) in ch.iter_mut().zip(cs.iter()) {
                b.c = *c;
            }
        }
        self.thr = v.thr;
        self.ratio = 1.0 + (v.ratio - 1.0) * a;
        self.makeup = db_to_gain(-0.6 * compress_db(-10.0, self.thr, self.ratio, 8.0));
    }
}

impl Effect for VocalEnhancer {
    fn set_param(&mut self, idx: u32, v: f32) {
        match idx {
            0 => self.mode = (v as usize).min(2),
            1 => self.amount = (v / 100.0).clamp(0.0, 1.0),
            _ => {}
        }
        self.update();
    }

    fn process(&mut self, buf: &mut [f32], channels: usize, frames: usize) {
        let channels = channels.min(self.channels);
        for c in 0..channels {
            let f = &mut self.filters[c];
            for x in &mut buf[c * frames..(c + 1) * frames] {
                let mut y = *x;
                for b in f.iter_mut() {
                    y = b.process(y);
                }
                *x = y;
            }
            for b in f.iter_mut() {
                b.flush();
            }
        }
        let comp = self.ratio > 1.0001;
        for i in 0..frames {
            if comp {
                let mut p = 0.0f32;
                for c in 0..channels {
                    p = p.max(buf[c * frames + i].abs());
                }
                let e = self.env.next(p);
                // Gain curve every 8 frames; the 5 ms gain smoother glides between.
                if i % 8 == 0 {
                    self.gain.target = db_to_gain(compress_db(gain_to_db(e), self.thr, self.ratio, 8.0)) * self.makeup;
                }
            } else {
                self.gain.target = 1.0;
            }
            let g = self.gain.next();
            for c in 0..channels {
                buf[c * frames + i] *= g;
            }
        }
    }

    fn reset(&mut self) {
        for ch in &mut self.filters {
            for b in ch.iter_mut() {
                b.reset();
            }
        }
        self.env.reset();
        self.gain.settle();
    }
}

#[cfg(test)]
mod tests {
    use crate::fx::testutil::*;
    use crate::fx::util::gain_to_db;

    /// Gain in dB for a quiet sine (below the compressor threshold).
    fn sine_gain_db(kind: u32, params: &[(u32, f32)], f: f32, rate: f32) -> f32 {
        let mut fx = make(kind, rate, 1);
        for &(i, v) in params {
            fx.set_param(i, v);
        }
        fx.reset();
        let x = sine(f, rate, 24000, 0.01);
        let y = run_mono(fx.as_mut(), &x);
        gain_to_db(rms(&y[12000..]) / rms(&x[12000..]))
    }

    #[test]
    fn voicings_shape_the_spectrum() {
        let r = 48000.0;
        // Male voice: mud cut around 350 Hz relative to presence at 3 kHz.
        let mud = sine_gain_db(92, &[(0, 0.0)], 350.0, r);
        let pres = sine_gain_db(92, &[(0, 0.0)], 3000.0, r);
        assert!(pres > mud + 3.0, "mud {mud} presence {pres}");
        // Female voice: strong low cut and air boost.
        let low = sine_gain_db(92, &[(0, 1.0)], 50.0, r);
        let air = sine_gain_db(92, &[(0, 1.0)], 12000.0, r);
        assert!(air > low + 10.0, "low {low} air {air}");
        // Music: dip at 2.5 kHz relative to 200 Hz.
        let dip = sine_gain_db(92, &[(0, 2.0)], 2500.0, r);
        let body = sine_gain_db(92, &[(0, 2.0)], 200.0, r);
        assert!(body - dip > 3.0, "dip {dip} body {body}");
    }

    #[test]
    fn zero_amount_is_nearly_transparent() {
        let r = 48000.0;
        for f in [100.0, 1000.0, 8000.0] {
            let db = sine_gain_db(92, &[(0, 1.0), (1, 0.0)], f, r);
            assert!(db.abs() < 0.3, "{f}: {db}");
        }
    }
}
