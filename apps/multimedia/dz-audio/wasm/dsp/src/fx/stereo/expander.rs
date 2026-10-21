//! Stereo Expander: re-pans the centre (mid) image and widens or narrows the
//! stereo field by scaling the side signal.
//!
//! Params: 0 centre pan (-100 left .. 100 right), 1 width % (0 mono, 100
//! unchanged, up to 300), 2 output gain dB.
//! The pan law keeps the centre at unity when it is not moved and constant
//! power as it moves. Mono input only receives the output gain.

use crate::fx::util::{db_to_gain, PI};
use crate::fx::{Effect, Smooth};

pub struct StereoExpander {
    pan: f32,
    width: f32,
    gain_db: f32,
    gl: Smooth,
    gr: Smooth,
    side: Smooth,
    out: Smooth,
    fresh: bool,
}

impl StereoExpander {
    pub fn new(rate: f32, _channels: usize) -> StereoExpander {
        let s = |v| Smooth::new(v, rate, 20.0);
        StereoExpander { pan: 0.0, width: 100.0, gain_db: 0.0, gl: s(1.0), gr: s(1.0), side: s(1.0), out: s(1.0), fresh: true }
    }

    fn update(&mut self) {
        let theta = (self.pan.clamp(-100.0, 100.0) / 100.0 + 1.0) * PI / 4.0;
        let targets = [
            (std::f32::consts::SQRT_2 * theta.cos(), &mut self.gl),
            (std::f32::consts::SQRT_2 * theta.sin(), &mut self.gr),
            (self.width.clamp(0.0, 300.0) / 100.0, &mut self.side),
            (db_to_gain(self.gain_db), &mut self.out),
        ];
        for (v, s) in targets {
            if self.fresh {
                s.jump(v);
            } else {
                s.target = v;
            }
        }
    }
}

impl Effect for StereoExpander {
    fn set_param(&mut self, idx: u32, value: f32) {
        if !value.is_finite() {
            return;
        }
        match idx {
            0 => self.pan = value,
            1 => self.width = value,
            2 => self.gain_db = value,
            _ => return,
        }
        self.update();
    }

    fn process(&mut self, buf: &mut [f32], channels: usize, frames: usize) {
        self.fresh = false;
        if channels < 2 {
            for x in &mut buf[..frames] {
                *x *= self.out.next();
            }
            return;
        }
        let (l, r) = buf.split_at_mut(frames);
        for i in 0..frames {
            let m = 0.5 * (l[i] + r[i]);
            let s = 0.5 * (l[i] - r[i]) * self.side.next();
            let g = self.out.next();
            l[i] = (m * self.gl.next() + s) * g;
            r[i] = (m * self.gr.next() - s) * g;
        }
    }

    fn reset(&mut self) {
        for s in [&mut self.gl, &mut self.gr, &mut self.side, &mut self.out] {
            s.settle();
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::fx::testutil::*;

    #[test]
    fn neutral_is_transparent_and_width_scales_side() {
        let r = 48000.0;
        let l = noise(4800, 0.5, 1);
        let rr = noise(4800, 0.5, 2);
        let mut fx = make(110, r, 2);
        let (ol, or) = run_stereo(fx.as_mut(), &l, &rr);
        for i in 0..4800 {
            assert!((ol[i] - l[i]).abs() < 1e-6 && (or[i] - rr[i]).abs() < 1e-6);
        }
        // Width 0 makes mono.
        let mut fx = make(110, r, 2);
        fx.set_param(1, 0.0);
        let (ol, or) = run_stereo(fx.as_mut(), &l, &rr);
        for i in 0..4800 {
            assert!((ol[i] - or[i]).abs() < 1e-6);
        }
        // Width 200 doubles the side signal.
        let mut fx = make(110, r, 2);
        fx.set_param(1, 200.0);
        let (ol, or) = run_stereo(fx.as_mut(), &l, &rr);
        let side_in: Vec<f32> = l.iter().zip(&rr).map(|(a, b)| a - b).collect();
        let side_out: Vec<f32> = ol.iter().zip(&or).map(|(a, b)| a - b).collect();
        assert!((rms(&side_out) / rms(&side_in) - 2.0).abs() < 0.01);
    }

    #[test]
    fn centre_pan_moves_the_mid_image() {
        let r = 48000.0;
        let x = sine(440.0, r, 4800, 0.5);
        let mut fx = make(110, r, 2);
        fx.set_param(0, -100.0);
        let (ol, or) = run_stereo(fx.as_mut(), &x, &x);
        assert!(rms(&or) < 1e-4);
        assert!((rms(&ol) / rms(&x) - std::f32::consts::SQRT_2).abs() < 0.01);
    }
}
