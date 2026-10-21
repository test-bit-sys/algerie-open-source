//! Shared reverb building blocks: an 8-line feedback delay network with
//! Hadamard mixing and frequency-dependent decay, Schroeder all-pass
//! diffusers and an early reflection tap line.

use crate::fx::modulation::fsin;
use crate::fx::util::{sanitize, DelayLine};
use crate::fx::Smooth;

pub const N: usize = 8;
/// Line lengths at scale 1 (ms), mutually prime in frames at common rates.
const BASE_MS: [f32; N] = [29.71, 37.11, 41.13, 43.73, 53.03, 59.91, 67.73, 73.37];
const INJECT: [f32; N] = [1.0, 1.0, -1.0, -1.0, 1.0, -1.0, 1.0, -1.0];
const OUT_L: [f32; N] = [1.0, 1.0, -1.0, -1.0, 1.0, 1.0, -1.0, -1.0];
const OUT_R: [f32; N] = [1.0, -1.0, 1.0, -1.0, 1.0, -1.0, 1.0, -1.0];

/// In-place 8-point fast Walsh-Hadamard transform (unnormalised).
#[inline]
fn fwht8(v: &mut [f32; N]) {
    let mut h = 1;
    while h < N {
        let mut i = 0;
        while i < N {
            for j in i..i + h {
                let (a, b) = (v[j], v[j + h]);
                v[j] = a + b;
                v[j + h] = a - b;
            }
            i += 2 * h;
        }
        h *= 2;
    }
}

pub struct Fdn {
    rate: f32,
    lines: Vec<DelayLine>,
    len: [Smooth; N],
    g: [f32; N],
    p: [f32; N],
    lp: [f32; N],
    in_gain: f32,
    max_scale: f32,
    mod_phase: f32,
    mod_inc: f32,
    mod_depth: f32,
    fresh: bool,
}

impl Fdn {
    pub fn new(rate: f32, max_scale: f32) -> Fdn {
        let max = ((BASE_MS[N - 1] * max_scale + 3.0) * rate / 1000.0) as usize + 8;
        let mut f = Fdn {
            rate,
            lines: (0..N).map(|_| DelayLine::new(max)).collect(),
            len: core::array::from_fn(|i| Smooth::new(BASE_MS[i] * rate / 1000.0, rate, 200.0)),
            g: [0.0; N],
            p: [0.0; N],
            lp: [0.0; N],
            in_gain: 0.5,
            max_scale,
            mod_phase: 0.0,
            mod_inc: 0.0,
            mod_depth: 0.0,
            fresh: true,
        };
        f.set(1.0, 1.5, 0.5, 0.0, 0.5);
        f
    }

    /// `scale` multiplies the line lengths (room size), `t60` is the decay in
    /// seconds at low frequencies, `hf_ratio` the high frequency decay relative
    /// to it (0..1), `mod_ms`/`mod_hz` a slow modulation of half the lines.
    pub fn set(&mut self, scale: f32, t60: f32, hf_ratio: f32, mod_ms: f32, mod_hz: f32) {
        let scale = scale.clamp(0.05, self.max_scale);
        let t60 = t60.max(0.05);
        let t60_hf = t60 * hf_ratio.clamp(0.05, 1.0);
        let mut gsum = 0.0;
        for i in 0..N {
            let len = BASE_MS[i] * scale * self.rate / 1000.0;
            self.len[i].target = len;
            let g = 10f32.powf(-3.0 * len / (t60 * self.rate));
            let ghf = 10f32.powf(-3.0 * len / (t60_hf * self.rate));
            let r = (ghf / g).min(1.0);
            self.g[i] = g;
            self.p[i] = (1.0 - r) / (1.0 + r);
            gsum += g * g;
        }
        // Keep the reverb level roughly independent of the decay time.
        self.in_gain = (1.0 - gsum / N as f32).max(0.0).sqrt() * 1.2;
        self.mod_depth = mod_ms * self.rate / 1000.0;
        self.mod_inc = mod_hz / self.rate;
    }

    pub fn reset(&mut self) {
        self.lines.iter_mut().for_each(|l| l.clear());
        self.lp = [0.0; N];
        self.len.iter_mut().for_each(|s| s.settle());
    }

    /// One stereo frame in, one stereo frame of late reverb out.
    #[inline]
    pub fn process(&mut self, l: f32, r: f32) -> (f32, f32) {
        if self.fresh {
            self.fresh = false;
            self.len.iter_mut().for_each(|s| s.settle());
        }
        self.mod_phase += self.mod_inc;
        if self.mod_phase >= 1.0 {
            self.mod_phase -= 1.0;
        }
        let mut o = [0.0f32; N];
        for i in 0..N {
            let mut d = self.len[i].next();
            if i % 2 == 1 {
                d += self.mod_depth * fsin(self.mod_phase + i as f32 * 0.137);
            }
            o[i] = self.lines[i].tap_linear((d - 1.0).max(1.0));
        }
        let mut v = [0.0f32; N];
        for i in 0..N {
            self.lp[i] = o[i] + (self.lp[i] - o[i]) * self.p[i];
            v[i] = self.lp[i] * self.g[i];
        }
        fwht8(&mut v);
        let k = 0.353_553_4; // 1 / sqrt(8)
        let (il, ir) = (l * self.in_gain, r * self.in_gain);
        let (mut yl, mut yr) = (0.0, 0.0);
        for i in 0..N {
            let inj = if i % 2 == 0 { il } else { ir } * INJECT[i];
            self.lines[i].push(v[i] * k + inj);
            yl += o[i] * OUT_L[i];
            yr += o[i] * OUT_R[i];
        }
        (yl * k, yr * k)
    }

    /// Flushes denormals; call once per block.
    pub fn flush(&mut self) {
        for v in &mut self.lp {
            *v = sanitize(*v);
        }
    }
}

/// Schroeder all-pass diffuser.
pub struct Allpass {
    line: DelayLine,
    len: usize,
    pub g: f32,
}

impl Allpass {
    pub fn new(max: usize) -> Allpass {
        Allpass { line: DelayLine::new(max + 1), len: max.max(1), g: 0.5 }
    }
    pub fn set_len(&mut self, len: usize) {
        self.len = len.clamp(1, self.line.capacity());
    }
    #[inline]
    pub fn process(&mut self, x: f32) -> f32 {
        let z = self.line.tap(self.len - 1);
        let w = x + self.g * z;
        self.line.push(w);
        z - self.g * w
    }
    pub fn clear(&mut self) {
        self.line.clear();
    }
}

/// Base diffuser lengths (ms) for the four input all-passes of each channel.
pub const DIFFUSER_MS: [[f32; 4]; 2] = [[4.771, 3.595, 12.73, 9.307], [4.937, 3.371, 13.11, 8.873]];

/// Four series all-passes per channel ahead of the FDN.
pub struct Diffuser {
    stages: Vec<Allpass>,
    rate: f32,
}

impl Diffuser {
    pub fn new(rate: f32, max_scale: f32) -> Diffuser {
        let mut stages = Vec::with_capacity(8);
        for c in 0..2 {
            for k in 0..4 {
                stages.push(Allpass::new((DIFFUSER_MS[c][k] * max_scale * rate / 1000.0) as usize + 2));
            }
        }
        Diffuser { stages, rate }
    }
    /// `amount` 0..1 sets the all-pass gain; `scale` stretches the lengths.
    pub fn set(&mut self, amount: f32, scale: f32) {
        for c in 0..2 {
            for k in 0..4 {
                let a = &mut self.stages[c * 4 + k];
                a.g = 0.75 * amount.clamp(0.0, 1.0);
                a.set_len((DIFFUSER_MS[c][k] * scale * self.rate / 1000.0) as usize);
            }
        }
    }
    #[inline]
    pub fn process(&mut self, c: usize, mut x: f32) -> f32 {
        for k in 0..4 {
            x = self.stages[c * 4 + k].process(x);
        }
        x
    }
    pub fn clear(&mut self) {
        self.stages.iter_mut().for_each(|a| a.clear());
    }
}

pub const MAX_TAPS: usize = 16;

/// A tapped delay line producing early reflections for one channel.
pub struct EarlyTaps {
    line: DelayLine,
    pub times: [usize; MAX_TAPS],
    pub gains: [f32; MAX_TAPS],
    pub count: usize,
}

impl EarlyTaps {
    pub fn new(max_frames: usize) -> EarlyTaps {
        EarlyTaps { line: DelayLine::new(max_frames + 1), times: [0; MAX_TAPS], gains: [0.0; MAX_TAPS], count: 0 }
    }
    pub fn max_frames(&self) -> usize {
        self.line.capacity() - 1
    }
    #[inline]
    pub fn process(&mut self, x: f32) -> f32 {
        self.line.push(x);
        let mut y = 0.0;
        for k in 0..self.count {
            y += self.line.tap(self.times[k]) * self.gains[k];
        }
        y
    }
    pub fn clear(&mut self) {
        self.line.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hadamard_is_orthogonal() {
        let mut v = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0];
        let e0: f32 = v.iter().map(|x| x * x).sum();
        fwht8(&mut v);
        let e1: f32 = v.iter().map(|x| x * x).sum::<f32>() / 8.0;
        assert!((e0 - e1).abs() < 1e-3);
    }

    #[test]
    fn fdn_decays_at_the_requested_rate() {
        let rate = 48000.0;
        for t in [0.5f32, 2.0] {
            let mut f = Fdn::new(rate, 1.6);
            f.set(1.0, t, 1.0, 0.0, 0.0);
            let n = (rate * t * 1.2) as usize;
            let mut ir = Vec::with_capacity(n);
            for i in 0..n {
                let x = if i == 0 { 1.0 } else { 0.0 };
                ir.push(f.process(x, x).0);
            }
            let est = super::super::tests::t60(&ir, rate);
            assert!((est - t).abs() < t * 0.15, "t60 {t}: estimated {est}");
        }
    }

    #[test]
    fn allpass_preserves_energy() {
        let mut a = Allpass::new(100);
        a.g = 0.7;
        let mut e = 0.0;
        for i in 0..20000 {
            let y = a.process(if i == 0 { 1.0 } else { 0.0 });
            e += y * y;
        }
        assert!((e - 1.0).abs() < 1e-3);
    }
}
