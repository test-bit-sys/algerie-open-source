//! Full Reverb: early reflections computed from a shoebox room (volume and
//! width to depth ratio, first and second order image sources heard by two
//! spaced virtual microphones), a diffused FDN late reverb and a three band
//! colouration EQ on the reverb.
//!
//! Params: 0 decay ms, 1 pre-delay ms, 2 diffusion %, 3 perception %,
//! 4 room size m^3, 5 dimension (width / depth), 6 high pass cutoff Hz,
//! 7 low shelf Hz, 8 low shelf dB, 9 mid Hz, 10 mid dB, 11 mid Q,
//! 12 high shelf Hz, 13 high shelf dB, 14 dry %, 15 reverb %, 16 early %,
//! 17 left/right location % (-100 left wall .. 100 right wall), 18 include
//! direct (0/1: the direct path joins the early reflections, so the source's
//! position is heard), 19 sum inputs (0/1: both channels feed the room as one
//! mono source).
//!
//! Perception: low values give a smooth, regular space; high values add
//! irregular reflection timing and more modulation for a livelier room.

use super::fdn::{Diffuser, EarlyTaps, Fdn};
use super::reverb_tail;
use crate::fx::util::{Biquad, Coefs, DelayLine};
use crate::fx::{Effect, Smooth};

const MAX_SCALE: f32 = 2.0;
pub const MAX_PREDELAY_MS: f32 = 500.0;
const ER_MAX_MS: f32 = 320.0;
const SPEED_OF_SOUND: f32 = 343.0;
/// Fixed pseudo random offsets for reflection timing irregularity.
const JITTER: [f32; 12] = [0.31, -0.74, 0.55, -0.12, 0.91, -0.43, 0.08, -0.97, 0.66, -0.27, 0.49, -0.58];

pub struct FullReverb {
    rate: f32,
    fdn: Fdn,
    diff: Diffuser,
    er: [EarlyTaps; 2],
    pre: [DelayLine; 2],
    pre_frames: usize,
    hp: [Biquad; 2],
    eq: [[Biquad; 3]; 2],
    p: [f32; 20],
    dry: Smooth,
    rev: Smooth,
    early: Smooth,
    fresh: bool,
}

impl FullReverb {
    pub fn new(rate: f32, _channels: usize) -> FullReverb {
        let er = (ER_MAX_MS * rate / 1000.0) as usize + 2;
        let pre = (MAX_PREDELAY_MS * rate / 1000.0) as usize + 2;
        let mut r = FullReverb {
            rate,
            fdn: Fdn::new(rate, MAX_SCALE),
            diff: Diffuser::new(rate, MAX_SCALE),
            er: [EarlyTaps::new(er), EarlyTaps::new(er)],
            pre: [DelayLine::new(pre), DelayLine::new(pre)],
            pre_frames: 0,
            hp: [Biquad::default(); 2],
            eq: [[Biquad::default(); 3]; 2],
            p: [1800.0, 12.0, 85.0, 40.0, 450.0, 1.5, 60.0, 180.0, 0.0, 1200.0, 0.0, 1.0, 5000.0, -3.0, 90.0, 30.0, 25.0, 0.0, 0.0, 0.0],
            dry: Smooth::new(0.9, rate, 20.0),
            rev: Smooth::new(0.3, rate, 20.0),
            early: Smooth::new(0.25, rate, 20.0),
            fresh: true,
        };
        r.update();
        r
    }

    /// Room dimensions (width, depth, height) in metres for a volume and ratio.
    pub fn room(volume: f32, dim: f32) -> (f32, f32, f32) {
        let h = (volume.cbrt() * 0.6).clamp(2.4, 25.0);
        let d = (volume / h / dim).sqrt();
        (dim * d, d, h)
    }

    fn update(&mut self) {
        let p = self.p;
        let r = self.rate;
        let volume = p[4].clamp(5.0, 50000.0);
        let perception = p[3] * 0.01;
        let diffusion = p[2] * 0.01;
        let scale = (volume.cbrt() / 7.0).clamp(0.3, MAX_SCALE);
        self.fdn.set(scale, p[0] / 1000.0, 0.6, 0.08 + 0.4 * perception, 0.23 + 0.3 * perception);
        self.diff.set(diffusion, 0.5 + 0.5 * scale.min(1.6));
        self.pre_frames = (p[1] * r / 1000.0).round() as usize;

        // Early reflections from image sources.
        let (w, d, h) = FullReverb::room(volume, p[5].clamp(0.1, 10.0));
        let loc = (p[17] * 0.01).clamp(-1.0, 1.0);
        let src = [w * (0.5 + 0.42 * loc), 0.3 * d, (h * 0.5).min(1.6)];
        let spacing = (0.25 * w).min(0.6);
        let direct = p[18] >= 0.5;
        let mut images = [[0.0f32; 4]; 12]; // x, y, z, order
        let (sx, sy, sz) = (src[0], src[1], src[2]);
        let list = [
            [-sx, sy, sz, 1.0],
            [2.0 * w - sx, sy, sz, 1.0],
            [sx, -sy, sz, 1.0],
            [sx, 2.0 * d - sy, sz, 1.0],
            [sx, sy, -sz, 1.0],
            [sx, sy, 2.0 * h - sz, 1.0],
            [-sx, -sy, sz, 2.0],
            [2.0 * w - sx, -sy, sz, 2.0],
            [-sx, 2.0 * d - sy, sz, 2.0],
            [2.0 * w - sx, 2.0 * d - sy, sz, 2.0],
            [sx, -sy, -sz, 2.0],
            [sx, 2.0 * d - sy, 2.0 * h - sz, 2.0],
        ];
        images.copy_from_slice(&list);
        let ear_at = |c: usize| [0.5 * w + if c == 0 { -spacing } else { spacing }, 0.7 * d, sz];
        let dist_to = |e: [f32; 3], q: &[f32]| ((q[0] - e[0]).powi(2) + (q[1] - e[1]).powi(2) + (q[2] - e[2]).powi(2)).sqrt();
        // Times count from the direct sound at the nearer ear, so the far ear hears everything a little later.
        let near = dist_to(ear_at(0), &src).min(dist_to(ear_at(1), &src)).max(0.5);
        for c in 0..2 {
            let ear = ear_at(c);
            let dist = |q: &[f32]| dist_to(ear, q);
            let r0 = near;
            let er = &mut self.er[c];
            let max = er.max_frames();
            er.count = images.len();
            if direct {
                let rd = dist(&src).max(0.5);
                er.times[images.len()] = (((rd - r0) / SPEED_OF_SOUND * r) as usize).min(max);
                er.gains[images.len()] = r0 / rd;
                er.count += 1;
            }
            for (k, img) in images.iter().enumerate() {
                let ri = dist(img).max(r0);
                let jitter = 1.0 + perception * 0.2 * JITTER[(k + 5 * c) % JITTER.len()];
                let secs = (ri - r0) / SPEED_OF_SOUND * jitter + 0.0007;
                er.times[k] = ((secs * r) as usize).min(max);
                er.gains[k] = 0.78f32.powf(img[3]) * r0 / ri * if k % 4 == 3 { -1.0 } else { 1.0 };
            }
        }
        let hp = Coefs::highpass(r, p[6].clamp(5.0, 20000.0), 0.7071);
        let eq = [
            Coefs::low_shelf(r, p[7], 0.7071, p[8]),
            Coefs::peaking(r, p[9], p[11].max(0.1), p[10]),
            Coefs::high_shelf(r, p[12], 0.7071, p[13]),
        ];
        for c in 0..2 {
            self.hp[c].c = hp;
            for k in 0..3 {
                self.eq[c][k].c = eq[k];
            }
        }
    }
}

impl Effect for FullReverb {
    fn set_param(&mut self, idx: u32, v: f32) {
        let i = idx as usize;
        if i >= self.p.len() {
            return;
        }
        self.p[i] = match i {
            0 => v.clamp(20.0, 30000.0),
            1 => v.clamp(0.0, MAX_PREDELAY_MS),
            _ => v,
        };
        match i {
            14 => self.dry.target = (v * 0.01).clamp(0.0, 2.0),
            15 => self.rev.target = (v * 0.01).clamp(0.0, 5.0),
            16 => self.early.target = (v * 0.01).clamp(0.0, 2.0),
            _ => self.update(),
        }
    }

    fn process(&mut self, buf: &mut [f32], channels: usize, frames: usize) {
        if self.fresh {
            self.fresh = false;
            for s in [&mut self.dry, &mut self.rev, &mut self.early] {
                s.settle();
            }
        }
        let stereo = channels >= 2;
        let sum = self.p[19] >= 0.5;
        for i in 0..frames {
            let x = [buf[i], if stereo { buf[frames + i] } else { buf[i] }];
            // The room's input: each side, or both summed to one source.
            let m = 0.5 * (x[0] + x[1]);
            let send = if sum { [m, m] } else { x };
            let (dry, rev, early) = (self.dry.next(), self.rev.next(), self.early.next());
            let mut e = [0.0f32; 2];
            let mut d = [0.0f32; 2];
            for c in 0..2 {
                self.pre[c].push(send[c]);
                let p = self.pre[c].tap(self.pre_frames);
                e[c] = self.er[c].process(p);
                d[c] = self.diff.process(c, p) + 0.35 * e[c];
            }
            let (l, r) = self.fdn.process(d[0], d[1]);
            let mut late = [l, r];
            for c in 0..2 {
                let mut v = late[c];
                for b in &mut self.eq[c] {
                    v = b.process(v);
                }
                late[c] = self.hp[c].process(v * rev + e[c] * early);
            }
            if stereo {
                buf[i] = x[0] * dry + late[0];
                buf[frames + i] = x[1] * dry + late[1];
            } else {
                buf[i] = x[0] * dry + 0.5 * (late[0] + late[1]);
            }
        }
        self.fdn.flush();
        for b in self.hp.iter_mut().chain(self.eq.iter_mut().flatten()) {
            b.flush();
        }
    }

    fn reset(&mut self) {
        self.fdn.reset();
        self.diff.clear();
        self.er.iter_mut().for_each(|e| e.clear());
        self.pre.iter_mut().for_each(|l| l.clear());
        for b in self.hp.iter_mut().chain(self.eq.iter_mut().flatten()) {
            b.reset();
        }
    }

    fn tail(&self) -> u32 {
        reverb_tail(self.p[0], self.p[1], self.rate)
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::*;
    use super::FullReverb;
    use crate::fx::testutil::*;

    #[test]
    fn room_geometry_matches_volume() {
        let (w, d, h) = FullReverb::room(500.0, 2.0);
        assert!((w * d * h - 500.0).abs() < 1.0);
        assert!((w / d - 2.0).abs() < 1e-3);
    }

    #[test]
    fn early_reflections_spread_out_with_room_size() {
        let rate = 48000.0;
        // Energy centroid (in frames) of the early reflections alone.
        let centroid = |volume: f32| {
            let mut fx = make(82, rate, 2);
            for (i, v) in [(1, 0.0), (4, volume), (14, 0.0), (15, 0.0), (16, 100.0), (6, 10.0)] {
                fx.set_param(i, v);
            }
            let (l, _) = impulse_response(fx.as_mut(), 0.4, rate);
            let e: f32 = l.iter().map(|v| v * v).sum();
            assert!(e > 0.01);
            l.iter().enumerate().map(|(i, v)| i as f32 * v * v).sum::<f32>() / e
        };
        let small = centroid(60.0);
        let large = centroid(8000.0);
        assert!(small < 1200.0, "{small}");
        assert!(large > small * 2.0, "{small} {large}");
    }

    #[test]
    fn colouration_eq_shapes_the_reverb() {
        let rate = 48000.0;
        let hf = |gain: f32| {
            let mut fx = make(82, rate, 1);
            for (i, v) in [(13, gain), (14, 0.0), (16, 0.0), (15, 100.0)] {
                fx.set_param(i, v);
            }
            let x = noise(48000, 0.3, 4);
            let y = run_mono(fx.as_mut(), &x);
            let s = &y[24000..];
            s.windows(2).map(|w| (w[1] - w[0]).powi(2)).sum::<f32>() / s.iter().map(|v| v * v).sum::<f32>()
        };
        assert!(hf(-12.0) < hf(6.0) * 0.6);
    }

    #[test]
    fn location_and_direct_path_place_the_source() {
        let rate = 48000.0;
        // Early reflections only, direct path included, source at the left wall.
        let energy = |loc: f32| {
            let mut fx = make(82, rate, 2);
            for (i, v) in [(1, 0.0), (14, 0.0), (15, 0.0), (16, 100.0), (6, 10.0), (17, loc), (18, 1.0), (19, 1.0)] {
                fx.set_param(i, v);
            }
            let (l, r) = impulse_response(fx.as_mut(), 0.2, rate);
            // The first arrival: which ear hears the direct sound first.
            let first = |x: &[f32]| x.iter().position(|v| v.abs() > 1e-3).unwrap_or(usize::MAX);
            (first(&l), first(&r))
        };
        let (l, r) = energy(-100.0);
        assert!(l < r, "left wall: {l} {r}");
        let (l, r) = energy(100.0);
        assert!(r < l, "right wall: {l} {r}");
    }

    #[test]
    fn decay_follows_parameter() {
        let rate = 48000.0;
        let mut fx = make(82, rate, 1);
        for (i, v) in [(0, 2500.0), (1, 0.0), (13, 0.0), (14, 0.0), (16, 0.0), (15, 100.0), (6, 10.0)] {
            fx.set_param(i, v);
        }
        let (l, _) = impulse_response(fx.as_mut(), 3.0, rate);
        let est = t60(&l, rate);
        assert!(est > 1.5 && est < 2.9, "{est}");
        assert_eq!(fx.tail(), ((2500.0 + 0.0 + 250.0) * 48.0) as u32);
    }
}
