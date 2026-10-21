//! DeHummer: cascaded constant-Q notches on a mains fundamental and its
//! harmonics.
//! Params: 0 frequency Hz, 1 Q, 2 gain dB (notch depth, <= 0),
//! 3 harmonics (count including the fundamental), 4 harmonic slope % (depth
//! of each harmonic relative to the previous one), 5 output hum only (0/1).

use super::super::{Effect, Smooth};

/// f64 biquad: notches a few hertz wide at mains frequencies need more
/// coefficient precision than f32 offers.
#[derive(Clone, Copy, Default)]
pub struct Notch {
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
    z1: f64,
    z2: f64,
}

impl Notch {
    #[inline]
    fn process(&mut self, x: f32) -> f32 {
        let x = x as f64;
        let y = x + self.z1;
        self.z1 = self.b1 * x - self.a1 * y + self.z2;
        self.z2 = self.b2 * x - self.a2 * y;
        y as f32
    }
    fn reset(&mut self) {
        self.z1 = 0.0;
        self.z2 = 0.0;
    }
    fn flush(&mut self) {
        if !(self.z1.abs() > 1e-30) {
            self.z1 = 0.0;
        }
        if !(self.z2.abs() > 1e-30) {
            self.z2 = 0.0;
        }
    }
}

/// A notch of finite depth: zeros just inside the unit circle under poles
/// whose radius sets the -3 dB bandwidth (f / q). Unlike a peaking cut, the
/// skirts stay flat however deep the notch, so music between harmonics is
/// untouched.
pub fn hum_notch(rate: f32, f: f32, q: f32, depth_db: f32) -> Notch {
    let (rate, f) = (rate as f64, f as f64);
    let w = std::f64::consts::TAU * f / rate;
    let bw = f / q.max(0.5) as f64;
    let rp = (-std::f64::consts::PI * bw / rate).exp();
    let g = 10f64.powf(depth_db.min(0.0) as f64 / 20.0);
    let rz = 1.0 - g * (1.0 - rp);
    let c = w.cos();
    Notch { b1: -2.0 * rz * c, b2: rz * rz, a1: -2.0 * rp * c, a2: rp * rp, z1: 0.0, z2: 0.0 }
}

pub const MAX_HARMONICS: usize = 20;

pub struct DeHummer {
    rate: f32,
    freq: f32,
    q: f32,
    gain: f32,
    harmonics: usize,
    slope: f32,
    filters: Vec<[Notch; MAX_HARMONICS]>,
    active: usize,
    hum_only: Smooth,
}

impl DeHummer {
    pub fn new(rate: f32, channels: usize) -> DeHummer {
        let mut d = DeHummer {
            rate,
            freq: 60.0,
            q: 30.0,
            gain: -40.0,
            harmonics: 6,
            slope: 75.0,
            filters: vec![[Notch::default(); MAX_HARMONICS]; channels],
            active: 0,
            hum_only: Smooth::new(0.0, rate, 20.0),
        };
        d.design();
        d
    }

    fn design(&mut self) {
        let mut active = 0;
        for h in 0..self.harmonics.min(MAX_HARMONICS) {
            let f = self.freq * (h + 1) as f32;
            if f >= self.rate * 0.45 {
                break;
            }
            let depth = self.gain * (self.slope * 0.01).powi(h as i32);
            let c = hum_notch(self.rate, f, self.q, depth);
            for ch in &mut self.filters {
                let (z1, z2) = (ch[h].z1, ch[h].z2);
                ch[h] = Notch { z1, z2, ..c };
            }
            active = h + 1;
        }
        self.active = active;
    }
}

impl Effect for DeHummer {
    fn set_param(&mut self, idx: u32, v: f32) {
        match idx {
            0 => self.freq = v.clamp(10.0, 1000.0),
            1 => self.q = v.clamp(1.0, 200.0),
            2 => self.gain = v.clamp(-100.0, 0.0),
            3 => self.harmonics = (v.round() as usize).clamp(1, MAX_HARMONICS),
            4 => self.slope = v.clamp(0.0, 100.0),
            5 => self.hum_only.target = if v >= 0.5 { 1.0 } else { 0.0 },
            _ => return,
        }
        self.design();
    }

    fn process(&mut self, buf: &mut [f32], channels: usize, frames: usize) {
        let channels = channels.min(self.filters.len());
        let n = self.active;
        let start = self.hum_only.value;
        let mut mix = start;
        for c in 0..channels {
            let f = &mut self.filters[c];
            let mut sm = Smooth { ..self.hum_only };
            sm.value = start;
            for x in &mut buf[c * frames..(c + 1) * frames] {
                let dry = *x;
                let mut y = dry;
                for b in f[..n].iter_mut() {
                    y = b.process(y);
                }
                let m = sm.next();
                *x = y + m * (dry - 2.0 * y);
                mix = m;
            }
            for b in f.iter_mut() {
                b.flush();
            }
        }
        self.hum_only.value = mix;
    }

    fn reset(&mut self) {
        for ch in &mut self.filters {
            for b in ch.iter_mut() {
                b.reset();
            }
        }
        self.hum_only.settle();
    }
}

#[cfg(test)]
mod tests {
    use crate::fx::testutil::*;

    /// Steady-state gain: narrow notches need a second or so to settle.
    fn sine_gain_db(kind: u32, params: &[(u32, f32)], f: f32, rate: f32) -> f32 {
        let mut fx = make(kind, rate, 1);
        for &(i, v) in params {
            fx.set_param(i, v);
        }
        let n = (rate * 2.0) as usize;
        let x = sine(f, rate, n, 0.25);
        let y = run_mono(fx.as_mut(), &x);
        crate::fx::util::gain_to_db(rms(&y[3 * n / 4..]) / rms(&x[3 * n / 4..]))
    }

    #[test]
    fn removes_hum_and_harmonics_but_keeps_music() {
        let r = 48000.0;
        let p = [(0, 60.0), (1, 30.0), (2, -40.0), (3, 6.0), (4, 100.0), (5, 0.0)];
        assert!(sine_gain_db(130, &p, 60.0, r) < -35.0);
        assert!(sine_gain_db(130, &p, 180.0, r) < -35.0);
        assert!(sine_gain_db(130, &p, 360.0, r) < -35.0);
        assert!(sine_gain_db(130, &p, 1000.0, r).abs() < 0.5);
        assert!(sine_gain_db(130, &p, 90.0, r).abs() < 1.5);
        // Slope lightens the upper harmonics.
        let p2 = [(0, 50.0), (1, 30.0), (2, -40.0), (3, 4.0), (4, 50.0), (5, 0.0)];
        let h4 = sine_gain_db(130, &p2, 200.0, r);
        assert!(h4 > -6.0 && h4 < -4.0, "{h4}");
    }

    #[test]
    fn hum_only_outputs_the_removed_part() {
        let r = 48000.0;
        let p = [(0, 60.0), (1, 30.0), (2, -60.0), (3, 6.0), (4, 100.0), (5, 1.0)];
        assert!(sine_gain_db(130, &p, 60.0, r).abs() < 0.5);
        let leak = sine_gain_db(130, &p, 1000.0, r);
        assert!(leak < -24.0, "{leak}");
    }
}
