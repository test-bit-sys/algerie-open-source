//! Channel Mixer (kind 37): a 2x2 matrix with per-output polarity inversion.
//! Params: 0 left from left %, 1 left from right %, 2 invert left,
//!         3 right from left %, 4 right from right %, 5 invert right.
//! Mono input is treated as both left and right and produces the left output.

use crate::fx::Effect;
use super::common::Ramp;

pub struct ChannelMixer {
    p: [f32; 6],
    m: [Ramp; 4], // ll, rl, lr, rr
}

impl ChannelMixer {
    pub fn new(rate: f32, _channels: usize) -> ChannelMixer {
        let mut c = ChannelMixer { p: [100.0, 0.0, 0.0, 0.0, 100.0, 0.0], m: [Ramp::new(0.0, rate, 15.0); 4] };
        c.update();
        for s in &mut c.m {
            s.settle();
        }
        c
    }
    fn update(&mut self) {
        let il = if self.p[2] >= 0.5 { -0.01 } else { 0.01 };
        let ir = if self.p[5] >= 0.5 { -0.01 } else { 0.01 };
        self.m[0].target = self.p[0] * il;
        self.m[1].target = self.p[1] * il;
        self.m[2].target = self.p[3] * ir;
        self.m[3].target = self.p[4] * ir;
    }
}

impl Effect for ChannelMixer {
    fn set_param(&mut self, idx: u32, v: f32) {
        if (idx as usize) < self.p.len() {
            self.p[idx as usize] = if idx == 2 || idx == 5 { v } else { v.clamp(-400.0, 400.0) };
            self.update();
        }
    }
    fn process(&mut self, buf: &mut [f32], channels: usize, frames: usize) {
        if channels >= 2 {
            for i in 0..frames {
                let (l, r) = (buf[i], buf[frames + i]);
                let (ll, rl, lr, rr) = (self.m[0].next(), self.m[1].next(), self.m[2].next(), self.m[3].next());
                buf[i] = l * ll + r * rl;
                buf[frames + i] = l * lr + r * rr;
            }
        } else {
            for x in &mut buf[..frames] {
                let g = self.m[0].next() + self.m[1].next();
                self.m[2].next();
                self.m[3].next();
                *x *= g;
            }
        }
    }
    fn reset(&mut self) {
        for s in &mut self.m {
            s.settle();
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::fx::testutil::*;

    #[test]
    fn swaps_mixes_and_inverts() {
        let l = sine(300.0, 48000.0, 4800, 0.5);
        let r = sine(700.0, 48000.0, 4800, 0.25);
        let mut fx = make(37, 48000.0, 2);
        for (i, v) in [(0, 0.0), (1, 100.0), (3, 100.0), (4, 0.0)] {
            fx.set_param(i, v);
        }
        fx.reset();
        let (a, b) = run_stereo(fx.as_mut(), &l, &r);
        assert!((0..4800).all(|i| (a[i] - r[i]).abs() < 1e-6 && (b[i] - l[i]).abs() < 1e-6));
        let mut fx = make(37, 48000.0, 2);
        for (i, v) in [(0, 50.0), (1, 50.0), (3, 50.0), (4, 50.0), (5, 1.0)] {
            fx.set_param(i, v);
        }
        fx.reset();
        let (a, b) = run_stereo(fx.as_mut(), &l, &r);
        assert!((0..4800).all(|i| (a[i] - 0.5 * (l[i] + r[i])).abs() < 1e-6 && (b[i] + a[i]).abs() < 1e-6));
    }

    #[test]
    fn parameter_changes_are_smoothed() {
        let x = vec![1.0f32; 2048];
        let mut fx = make(37, 48000.0, 1);
        fx.reset();
        fx.set_param(0, 0.0);
        let y = run_mono(fx.as_mut(), &x);
        assert!(y[0] > 0.9 && y[2047] < 0.1);
        assert!(y.windows(2).all(|w| (w[0] - w[1]).abs() < 0.01));
    }
}
