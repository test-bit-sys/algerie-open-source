//! Waveshaping with oversampling, shared by Distortion, Guitar Suite and the
//! Mastering exciter.
//!
//! The oversampler cascades linear-phase Kaiser half-band stages (2x or 4x).
//! Half-band filters have every other tap zero, so each stage runs as a
//! two-branch polyphase filter, block by block so the FIR windows are
//! contiguous and vectorise. The round trip delay is a whole number of frames
//! at the base rate (see `Oversampler::latency`).

use crate::fx::util::PI as PI32;

fn bessel_i0(x: f64) -> f64 {
    let y = x * x / 4.0;
    let mut sum = 1.0;
    let mut term = 1.0;
    for k in 1..60 {
        term *= y / (k * k) as f64;
        sum += term;
        if term < 1e-14 * sum {
            break;
        }
    }
    sum
}

/// Dot product in four independent lanes (vectorises to SIMD); the slices
/// have equal lengths that are multiples of 4.
#[inline]
fn dot(a: &[f32], b: &[f32]) -> f32 {
    let mut acc = [0.0f32; 4];
    for (x, y) in a.chunks_exact(4).zip(b.chunks_exact(4)) {
        acc[0] += x[0] * y[0];
        acc[1] += x[1] * y[1];
        acc[2] += x[2] * y[2];
        acc[3] += x[3] * y[3];
    }
    (acc[0] + acc[1]) + (acc[2] + acc[3])
}

/// Largest block (base-rate frames) processed in one pass.
pub const MAX_BLOCK: usize = 64;

/// A sample history followed by the current block, so FIR windows are
/// contiguous: `buf[keep + j]` is block sample j, `buf[keep - k]` the sample
/// k before the block.
struct Line {
    buf: Vec<f32>,
    keep: usize,
}

impl Line {
    fn new(keep: usize, max: usize) -> Line {
        Line { buf: vec![0.0; keep + max], keep }
    }
    /// Moves the last `keep` samples of a block of `n` to the front.
    fn advance(&mut self, n: usize) {
        self.buf.copy_within(n..n + self.keep, 0);
    }
    fn clear(&mut self) {
        self.buf.iter_mut().for_each(|v| *v = 0.0);
    }
}

/// One 2x half-band stage (interpolator and decimator state for one channel).
struct Halfband {
    /// Taps at even offsets from the start of the full filter (odd offsets
    /// from the centre), reversed so windows read forwards.
    taps: Vec<f32>,
    /// Centre tap.
    hc: f32,
    /// Centre index; odd, with c + 1 a multiple of 4.
    c: usize,
    up: Line,
    dn_even: Line,
    dn_odd: Line,
}

impl Halfband {
    /// `c` is the half length (the filter has 2c + 1 taps); `max` is the
    /// largest input block for `up_block` and output block for `down_block`.
    fn new(c: usize, beta: f64, max: usize) -> Halfband {
        assert!(c % 2 == 1 && (c + 1) % 4 == 0);
        let n = 2 * c + 1;
        let mut h = vec![0.0f64; n];
        let i0b = bessel_i0(beta);
        for (i, v) in h.iter_mut().enumerate() {
            let k = i as f64 - c as f64;
            let s = if k == 0.0 { 0.5 } else { (std::f64::consts::PI * k / 2.0).sin() / (std::f64::consts::PI * k) };
            let r = k / c as f64;
            let w = bessel_i0(beta * (1.0 - r * r).max(0.0).sqrt()) / i0b;
            *v = s * w;
        }
        let sum: f64 = h.iter().sum();
        // e[q] = h[2q] weights the sample q steps back; reversed for forward windows.
        let taps: Vec<f32> = (0..=c).rev().map(|q| (h[2 * q] / sum) as f32).collect();
        Halfband { taps, hc: (h[c] / sum) as f32, c, up: Line::new(c, max), dn_even: Line::new(c, max), dn_odd: Line::new((c + 1) / 2, max) }
    }

    /// Interpolates `x` (n samples) into `out` (2n samples).
    fn up_block(&mut self, x: &[f32], out: &mut [f32]) {
        let (c, n) = (self.c, x.len());
        let b = &mut self.up.buf;
        b[c..c + n].copy_from_slice(x);
        let mid = (c - 1) / 2;
        for m in 0..n {
            out[2 * m] = 2.0 * dot(&self.taps, &b[m..m + c + 1]);
            out[2 * m + 1] = 2.0 * self.hc * b[c + m - mid];
        }
        self.up.advance(n);
    }

    /// Decimates `y` (2n samples) into `out` (n samples).
    fn down_block(&mut self, y: &[f32], out: &mut [f32]) {
        let (c, n) = (self.c, out.len());
        let h = (c + 1) / 2;
        for m in 0..n {
            self.dn_even.buf[c + m] = y[2 * m];
            self.dn_odd.buf[h + m] = y[2 * m + 1];
        }
        for m in 0..n {
            // The odd sample h steps back sits at index m of the odd line.
            out[m] = dot(&self.taps, &self.dn_even.buf[m..m + c + 1]) + self.hc * self.dn_odd.buf[m];
        }
        self.dn_even.advance(n);
        self.dn_odd.advance(n);
    }

    fn clear(&mut self) {
        self.up.clear();
        self.dn_even.clear();
        self.dn_odd.clear();
    }
}

/// 2x or 4x oversampler for one channel, working on blocks.
pub struct Oversampler {
    a: Halfband,
    b: Option<Halfband>,
    prev: f32,
    s2: Vec<f32>,
    s4: Vec<f32>,
}

const A_HALF: usize = 23; // 47 taps, Kaiser beta 8 (about 80 dB stopband)
const B_HALF: usize = 7; // 15 taps, a wide transition is enough at 4x

impl Oversampler {
    pub fn new(factor: usize) -> Oversampler {
        Oversampler {
            a: Halfband::new(A_HALF, 8.0, MAX_BLOCK),
            b: if factor >= 4 { Some(Halfband::new(B_HALF, 6.0, 2 * MAX_BLOCK)) } else { None },
            prev: 0.0,
            s2: vec![0.0; 2 * MAX_BLOCK],
            s4: vec![0.0; 4 * MAX_BLOCK],
        }
    }

    /// Round trip delay in base-rate frames.
    pub fn latency(factor: usize) -> usize {
        if factor >= 4 {
            A_HALF + (B_HALF + 1) / 2
        } else {
            A_HALF
        }
    }

    /// Upsamples `io` (any length), runs `f` on each oversampled block and
    /// writes the band limited result back, delayed by `latency` frames.
    pub fn process<F: FnMut(&mut [f32])>(&mut self, io: &mut [f32], mut f: F) {
        for blk in io.chunks_mut(MAX_BLOCK) {
            let n = blk.len();
            let s2 = &mut self.s2[..2 * n];
            self.a.up_block(blk, s2);
            match &mut self.b {
                None => f(s2),
                Some(b) => {
                    let s4 = &mut self.s4[..4 * n];
                    b.up_block(s2, s4);
                    f(s4);
                    b.down_block(s4, s2);
                    // One extra sample of delay keeps the total delay a whole
                    // number of base-rate frames.
                    let last = s2[2 * n - 1];
                    s2.copy_within(0..2 * n - 1, 1);
                    s2[0] = self.prev;
                    self.prev = last;
                }
            }
            self.a.down_block(s2, blk);
        }
    }

    pub fn reset(&mut self) {
        self.a.clear();
        if let Some(b) = &mut self.b {
            b.clear();
        }
        self.prev = 0.0;
    }
}

/// Curve shapes for one polarity. Each maps a >= 0 to the output magnitude
/// with unit slope at zero (except `CUT`).
pub const LINEAR: u32 = 0;
pub const SOFT: u32 = 1;
pub const HARD: u32 = 2;
pub const TUBE: u32 = 3;
pub const DIODE: u32 = 4;
pub const FOLD: u32 = 5;
pub const CUT: u32 = 6;
/// Drawn curves: output magnitude looked up in `Shape::tables[0]` (positive)
/// or `[1]` (negative). A table covers TABLE_OCTAVES octaves below full
/// scale with TABLE_STEPS samples per octave, spaced evenly in magnitude
/// within each octave: entry j holds the output for input magnitude
/// 2^(j / STEPS - OCTAVES) rounded down to the octave, times
/// (1 + (j % STEPS) / STEPS), so quiet levels get as fine a grid as loud
/// ones. Below the table the gain of its first entry holds; inputs at or
/// above full scale hold the last entry.
pub const TABLE_POS: u32 = 7;
pub const TABLE_NEG: u32 = 8;
pub const TABLE_OCTAVES: i32 = 20;
pub const TABLE_STEPS: usize = 128;

/// Interpolated lookup in an octave table (identity when empty).
#[inline]
fn lookup(table: &[f32], a: f32) -> f32 {
    let n = table.len();
    if n < 2 {
        return a;
    }
    if a <= 0.0 {
        return 0.0;
    }
    let bits = a.to_bits();
    let e = ((bits >> 23) & 0xff) as i32 - 127;
    if e < -TABLE_OCTAVES {
        // Constant gain below the table (its first entry is at 2^-OCTAVES).
        return a * table[0] * (1u64 << TABLE_OCTAVES) as f32;
    }
    let m = (bits & 0x7f_ffff) as f32 * (1.0 / 8_388_608.0);
    let t = ((e + TABLE_OCTAVES) as usize * TABLE_STEPS) as f32 + m * TABLE_STEPS as f32;
    if t >= (n - 1) as f32 {
        return table[n - 1];
    }
    let i = t as usize;
    let f = t - i as f32;
    table[i] + (table[i + 1] - table[i]) * f
}

/// Rational tanh approximation (exact at 0, saturates to 1 at |x| >= 3).
#[inline]
pub fn fast_tanh(x: f32) -> f32 {
    if x >= 3.0 {
        1.0
    } else if x <= -3.0 {
        -1.0
    } else {
        let x2 = x * x;
        x * (27.0 + x2) / (27.0 + 9.0 * x2)
    }
}

/// sin(a * pi / 2) / (pi / 2) for a >= 0 by range reduction and an odd
/// polynomial (error below 1e-3), a wave folder with unit slope at zero.
#[inline]
fn fold(a: f32) -> f32 {
    let t = a - 4.0 * (a * 0.25).floor();
    let x = if t < 1.0 {
        t
    } else if t < 3.0 {
        2.0 - t
    } else {
        t - 4.0
    };
    let x2 = x * x;
    x * (1.570_796_3 - x2 * (0.645_964 - x2 * (0.079_692_6 - x2 * 0.004_681_8))) * (2.0 / PI32)
}

#[inline]
pub fn curve(kind: u32, a: f32) -> f32 {
    match kind {
        SOFT => fast_tanh(a),
        HARD => a.min(1.0),
        // 1 - 1 / (third order Taylor of e^a): tracks 1 - e^-a closely
        // without a transcendental call.
        TUBE => 1.0 - 1.0 / (1.0 + a * (1.0 + a * (0.5 + a * (1.0 / 6.0)))),
        DIODE => {
            let a2 = a * a;
            a / (1.0 + a2 * a2).sqrt().sqrt()
        }
        FOLD => fold(a),
        CUT => 0.0,
        _ => a,
    }
}

/// Static and dynamic waveshaper settings shared by every channel.
#[derive(Clone)]
pub struct Shape {
    pub pos: u32,
    pub neg: u32,
    /// 0..1: blends the curve toward a smooth saturation.
    pub smooth: f32,
    /// One-pole coefficient for gain smoothing at the oversampled rate (0 = off).
    pub time_coef: f32,
    /// Drawn curve tables for TABLE_POS and TABLE_NEG.
    pub tables: [Vec<f32>; 2],
}

impl Default for Shape {
    fn default() -> Self {
        Shape { pos: SOFT, neg: SOFT, smooth: 0.0, time_coef: 0.0, tables: [Vec::new(), Vec::new()] }
    }
}

impl Shape {
    #[inline]
    pub fn eval(&self, x: f32) -> f32 {
        let (kind, a, sign) = if x >= 0.0 { (self.pos, x, 1.0) } else { (self.neg, -x, -1.0) };
        let mut y = match kind {
            TABLE_POS => lookup(&self.tables[0], a),
            TABLE_NEG => lookup(&self.tables[1], a),
            _ => curve(kind, a),
        };
        if self.smooth > 0.0 {
            y += (fast_tanh(a) - y) * self.smooth;
        }
        sign * y
    }
}

/// Oversampled waveshaper for one channel, with optional time smoothing of
/// the gain the curve applies (slow smoothing turns the shaper into a
/// saturating leveller rather than an instantaneous clipper).
pub struct Shaper {
    os: Oversampler,
    g: f32,
}

impl Shaper {
    pub fn new(factor: usize) -> Shaper {
        Shaper { os: Oversampler::new(factor), g: 1.0 }
    }

    /// Shapes `io` in place (delayed by the oversampler latency).
    pub fn process(&mut self, io: &mut [f32], s: &Shape) {
        let g = &mut self.g;
        self.os.process(io, |v| {
            if s.time_coef <= 0.0 {
                for x in v.iter_mut() {
                    *x = s.eval(*x);
                }
            } else {
                for x in v.iter_mut() {
                    let target = if x.abs() > 1e-9 { s.eval(*x) / *x } else { 1.0 };
                    *g = target + (*g - target) * s.time_coef;
                    *x *= *g;
                }
            }
        });
    }

    pub fn reset(&mut self) {
        self.os.reset();
        self.g = 1.0;
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::fx::testutil::*;

    /// Magnitude of the `f` Hz component of x (Hann windowed single-bin DFT).
    fn bin(x: &[f32], f: f32, rate: f32) -> f32 {
        let (mut re, mut im) = (0.0f64, 0.0f64);
        let n = x.len();
        for (i, &v) in x.iter().enumerate() {
            let w = 0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / n as f64).cos();
            let a = 2.0 * std::f64::consts::PI * f as f64 * i as f64 / rate as f64;
            re += v as f64 * w * a.cos();
            im -= v as f64 * w * a.sin();
        }
        ((re * re + im * im).sqrt() / n as f64) as f32
    }

    #[test]
    fn oversampler_is_transparent_with_whole_frame_latency() {
        for factor in [2, 4] {
            let rate = 48000.0;
            let x = sine(1000.0, rate, 4000, 0.5);
            let mut os = Oversampler::new(factor);
            let mut y = x.clone();
            // Uneven block sizes exercise the block boundaries.
            for blk in y.chunks_mut(100) {
                os.process(blk, |_| {});
            }
            let lat = Oversampler::latency(factor);
            for i in 200..4000 {
                assert!((y[i] - x[i - lat]).abs() < 2e-3, "factor {factor} at {i}: {} vs {}", y[i], x[i - lat]);
            }
            // The passband stays flat up to 16 kHz.
            let x = sine(16000.0, rate, 8000, 0.5);
            let mut os = Oversampler::new(factor);
            let mut y = x.clone();
            for blk in y.chunks_mut(37) {
                os.process(blk, |_| {});
            }
            let g = rms(&y[2000..]) / rms(&x[2000..]);
            assert!((g - 1.0).abs() < 0.02, "factor {factor} gain {g}");
        }
    }

    #[test]
    fn oversampling_reduces_aliasing() {
        let rate = 48000.0;
        let n = 16384;
        let x = sine(5000.0, rate, n, 0.9);
        let s = Shape { pos: SOFT, neg: SOFT, ..Shape::default() };
        let naive: Vec<f32> = x.iter().map(|&v| s.eval(v * 4.0)).collect();
        let mut sh = Shaper::new(4);
        let mut over: Vec<f32> = x.iter().map(|&v| v * 4.0).collect();
        for blk in over.chunks_mut(128) {
            sh.process(blk, &s);
        }
        // The 7th harmonic (35 kHz) folds to 13 kHz without oversampling.
        let fund_n = bin(&naive[..], 5000.0, rate);
        let fund_o = bin(&over[1000..], 5000.0, rate);
        let alias_n = bin(&naive[..], 13000.0, rate) / fund_n;
        let alias_o = bin(&over[1000..], 13000.0, rate) / fund_o;
        assert!(alias_n > 1e-3, "naive alias {alias_n}");
        assert!(alias_o < alias_n * 0.01, "naive {alias_n} oversampled {alias_o}");
    }

    #[test]
    fn curves_have_unit_slope_and_bounds() {
        for k in [SOFT, HARD, TUBE, DIODE, FOLD, LINEAR] {
            let d = curve(k, 1e-3) / 1e-3;
            assert!((d - 1.0).abs() < 0.01, "curve {k} slope {d}");
        }
        for k in [SOFT, HARD, TUBE, DIODE, FOLD] {
            for i in 0..100 {
                let y = curve(k, i as f32 * 0.3);
                assert!(y.abs() <= 1.0 + 1e-5, "curve {k} {y}");
            }
        }
        assert_eq!(curve(CUT, 0.7), 0.0);
        for i in 0..200 {
            let a = i as f32 * 0.05;
            assert!((fold(a) - (a * PI32 * 0.5).sin() / (PI32 * 0.5)).abs() < 1e-3, "fold {a}");
            assert!((curve(TUBE, a) - (1.0 - (-a).exp())).abs() < 0.08, "tube {a}");
        }
        let s = Shape { pos: HARD, neg: CUT, ..Shape::default() };
        assert_eq!(s.eval(-0.5), 0.0);
        assert_eq!(s.eval(2.0), 1.0);
    }

    /// An octave table of `f(input magnitude)`.
    pub fn octave_table(f: impl Fn(f32) -> f32) -> Vec<f32> {
        (0..=TABLE_OCTAVES as usize * TABLE_STEPS)
            .map(|j| {
                let base = 2f32.powi((j / TABLE_STEPS) as i32 - TABLE_OCTAVES);
                f(base * (1.0 + (j % TABLE_STEPS) as f32 / TABLE_STEPS as f32))
            })
            .collect()
    }

    #[test]
    fn drawn_tables_interpolate_and_hold() {
        // Positive: a curve that halves everything; negative: identity (empty table).
        let half = octave_table(|a| a * 0.5);
        let s = Shape { pos: TABLE_POS, neg: TABLE_NEG, tables: [half, Vec::new()], ..Shape::default() };
        assert!((s.eval(0.3) - 0.15).abs() < 1e-6);
        assert!((s.eval(3.0) - 0.5).abs() < 1e-6);
        assert!((s.eval(-0.3) + 0.3).abs() < 1e-6);
        // Quiet levels keep their resolution, even below the table.
        assert!((s.eval(1e-5) / 0.5e-5 - 1.0).abs() < 1e-4);
        assert!((s.eval(1e-8) / 0.5e-8 - 1.0).abs() < 1e-4);
        // A gate at -80 dB: shapes this quiet survive the lookup.
        let gate = octave_table(|a| if a < 1e-4 { 0.0 } else { a });
        let s = Shape { pos: TABLE_POS, tables: [gate, Vec::new()], ..Shape::default() };
        assert_eq!(s.eval(0.5e-4), 0.0);
        assert!((s.eval(2e-4) - 2e-4).abs() < 1e-9);
    }

    #[test]
    fn time_smoothing_lets_short_bursts_through() {
        // With slow gain smoothing a short burst passes the curve's limit
        // briefly instead of being clipped flat.
        let fast = Shape { pos: HARD, neg: HARD, ..Shape::default() };
        let slow = Shape { time_coef: 0.9999, ..fast.clone() };
        let mut x = vec![0.2f32; 2000];
        for v in &mut x[1000..1100] {
            *v = 3.0;
        }
        let mut a = x.clone();
        let mut b = x.clone();
        let (mut sa, mut sb) = (Shaper::new(4), Shaper::new(4));
        sa.process(&mut a, &fast);
        sb.process(&mut b, &slow);
        // Band limiting adds a little overshoot at the clipped edges.
        assert!(peak(&a) < 1.25);
        assert!(peak(&b) > 2.0);
    }

    #[test]
    fn bench_oversampled_shaper() {
        let mut sh = Shaper::new(4);
        let s = Shape::default();
        let mut x: Vec<f32> = (0..96000).map(|i| (i as f32 * 0.05).sin() * 0.5).collect();
        let t = std::time::Instant::now();
        for blk in x.chunks_mut(128) {
            sh.process(blk, &s);
        }
        eprintln!("4x shaper, 96000 samples: {:?}", t.elapsed());
    }
}
