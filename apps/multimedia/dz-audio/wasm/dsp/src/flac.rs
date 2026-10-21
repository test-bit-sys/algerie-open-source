//! FLAC encoder: fixed and LPC predictors, adaptive stereo decorrelation,
//! partitioned Rice coding, wasted-bits detection and an MD5 signature of the
//! source audio. Written from the FLAC format specification (RFC 9639).
//!
//! JavaScript drives it block by block: `flac_new` -> repeatedly fill the
//! planar i32 buffer at `flac_input` with up to `flac_block_size` frames and
//! call `flac_encode` (returns the frame's byte length, bytes at
//! `flac_output`) -> `flac_streaminfo` returns the 34-byte STREAMINFO block
//! that belongs at the start of the file.

use crate::md5::Md5;

/// Compression settings for levels 0 to 8, modelled on the usual FLAC levels.
#[derive(Clone, Copy)]
pub struct Settings {
    pub block_size: usize,
    pub stereo: Stereo,
    pub max_lpc_order: usize,
    pub max_fixed_order: usize,
    pub max_partition_order: u32,
    pub exhaustive_order: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Stereo {
    Independent,
    Adaptive,
}

pub fn settings(level: u32) -> Settings {
    let s = |block_size, stereo, max_lpc_order, max_partition_order, exhaustive_order| Settings {
        block_size,
        stereo,
        max_lpc_order,
        max_fixed_order: 4,
        max_partition_order,
        exhaustive_order,
    };
    match level {
        0 => Settings { max_fixed_order: 2, ..s(1152, Stereo::Independent, 0, 3, false) },
        1 => s(1152, Stereo::Adaptive, 0, 3, false),
        2 => s(1152, Stereo::Adaptive, 0, 4, false),
        3 => s(4096, Stereo::Independent, 6, 4, false),
        4 => s(4096, Stereo::Adaptive, 8, 4, false),
        5 => s(4096, Stereo::Adaptive, 8, 5, false),
        6 => s(4096, Stereo::Adaptive, 8, 6, false),
        7 => s(4096, Stereo::Adaptive, 12, 6, false),
        _ => s(4096, Stereo::Adaptive, 12, 6, true),
    }
}

// ------------------------------------------------------------------ bit writer

pub struct BitWriter {
    pub buf: Vec<u8>,
    acc: u64,
    nbits: u32,
}

impl BitWriter {
    pub fn new() -> Self {
        BitWriter { buf: Vec::with_capacity(1 << 16), acc: 0, nbits: 0 }
    }

    /// Writes the low `n` bits of `v` (n <= 32), most significant first.
    #[inline]
    pub fn write(&mut self, v: u64, n: u32) {
        if n == 0 {
            return;
        }
        self.acc = (self.acc << n) | (v & ((1u64 << n) - 1));
        self.nbits += n;
        while self.nbits >= 8 {
            self.nbits -= 8;
            self.buf.push((self.acc >> self.nbits) as u8);
        }
        self.acc &= (1u64 << self.nbits) - 1;
    }

    #[inline]
    pub fn write_signed(&mut self, v: i64, n: u32) {
        self.write(v as u64, n);
    }

    /// `q` zero bits followed by a one.
    #[inline]
    pub fn write_unary(&mut self, mut q: u64) {
        while q >= 32 {
            self.write(0, 32);
            q -= 32;
        }
        self.write(1, q as u32 + 1);
    }

    pub fn align(&mut self) {
        if self.nbits > 0 {
            self.write(0, 8 - self.nbits);
        }
    }

    pub fn clear(&mut self) {
        self.buf.clear();
        self.acc = 0;
        self.nbits = 0;
    }
}

// ----------------------------------------------------------------------- CRCs

pub fn crc8(data: &[u8]) -> u8 {
    let mut crc = 0u8;
    for &b in data {
        crc ^= b;
        for _ in 0..8 {
            crc = if crc & 0x80 != 0 { (crc << 1) ^ 0x07 } else { crc << 1 };
        }
    }
    crc
}

pub fn crc16(data: &[u8]) -> u16 {
    let mut crc = 0u16;
    for &b in data {
        crc ^= (b as u16) << 8;
        for _ in 0..8 {
            crc = if crc & 0x8000 != 0 { (crc << 1) ^ 0x8005 } else { crc << 1 };
        }
    }
    crc
}

// ----------------------------------------------------------------- Rice coding

#[inline]
fn zigzag(r: i64) -> u64 {
    ((r << 1) ^ (r >> 63)) as u64
}

/// Estimated bits for one partition of `n` residuals with zigzag sum `sum` at parameter k.
#[inline]
fn rice_bits(sum: u64, n: u64, k: u32) -> u64 {
    n * (k as u64 + 1) + (sum >> k)
}

fn best_k(sum: u64, n: u64) -> (u32, u64) {
    if n == 0 {
        return (0, 0);
    }
    let mean = sum / n;
    let guess = if mean == 0 { 0 } else { 63 - mean.leading_zeros() };
    let mut best = (guess.min(30), rice_bits(sum, n, guess.min(30)));
    for k in [guess.saturating_sub(1), guess + 1] {
        let k = k.min(30);
        let b = rice_bits(sum, n, k);
        if b < best.1 {
            best = (k, b);
        }
    }
    best
}

#[derive(Clone, Default)]
pub struct RicePlan {
    pub order: u32,
    pub params: Vec<u32>,
    pub bits: u64,
    pub wide: bool,
}

/// Chooses the partition order and parameters for `res` (residual of samples
/// `order..block`). Returns the estimated size including the 6-bit header.
fn plan_rice(res: &[i64], pred_order: usize, block: usize, max_porder: u32, sums: &mut Vec<u64>) -> RicePlan {
    // Highest partition order allowed for this block size and predictor order.
    let mut top = 0u32;
    while top < max_porder && block % (1 << (top + 1)) == 0 && (block >> (top + 1)) > pred_order {
        top += 1;
    }
    let parts = 1usize << top;
    let plen = block >> top;
    sums.clear();
    sums.resize(parts, 0);
    let mut i = 0usize;
    for (p, s) in sums.iter_mut().enumerate() {
        let n = if p == 0 { plen - pred_order } else { plen };
        let mut acc = 0u64;
        for &r in &res[i..i + n] {
            acc += zigzag(r);
        }
        *s = acc;
        i += n;
    }
    let mut best = RicePlan { bits: u64::MAX, ..Default::default() };
    let mut level = sums.clone();
    let mut porder = top as i32;
    loop {
        let parts = level.len();
        let plen = block >> porder;
        let mut bits = 6u64;
        let mut params = Vec::with_capacity(parts);
        let mut wide = false;
        for (p, &s) in level.iter().enumerate() {
            let n = if p == 0 { plen - pred_order } else { plen } as u64;
            let (k, b) = best_k(s, n);
            if k > 14 {
                wide = true;
            }
            params.push(k);
            bits += b;
        }
        bits += parts as u64 * if wide { 5 } else { 4 };
        if bits < best.bits {
            best = RicePlan { order: porder as u32, params, bits, wide };
        }
        if porder == 0 {
            break;
        }
        level = level.chunks(2).map(|c| c[0] + c[1]).collect();
        porder -= 1;
    }
    best
}

fn write_residual(w: &mut BitWriter, res: &[i64], pred_order: usize, block: usize, plan: &RicePlan) {
    w.write(if plan.wide { 1 } else { 0 }, 2);
    w.write(plan.order as u64, 4);
    let plen = block >> plan.order;
    let pbits = if plan.wide { 5 } else { 4 };
    let mut i = 0usize;
    for (p, &k) in plan.params.iter().enumerate() {
        let n = if p == 0 { plen - pred_order } else { plen };
        w.write(k as u64, pbits);
        let mask = (1u64 << k) - 1;
        for &r in &res[i..i + n] {
            let u = zigzag(r);
            let q = u >> k;
            if q + 1 + (k as u64) <= 32 {
                w.write((1u64 << k) | (u & mask), q as u32 + 1 + k);
            } else {
                w.write_unary(q);
                w.write(u & mask, k);
            }
        }
        i += n;
    }
}

// ----------------------------------------------------------------- predictors

fn fixed_residual(x: &[i64], order: usize, out: &mut Vec<i64>) {
    out.clear();
    for i in order..x.len() {
        let r = match order {
            0 => x[i],
            1 => x[i] - x[i - 1],
            2 => x[i] - 2 * x[i - 1] + x[i - 2],
            3 => x[i] - 3 * x[i - 1] + 3 * x[i - 2] - x[i - 3],
            _ => x[i] - 4 * x[i - 1] + 6 * x[i - 2] - 4 * x[i - 3] + x[i - 4],
        };
        out.push(r);
    }
}

fn fits_i32(res: &[i64]) -> bool {
    res.iter().all(|&r| r >= i32::MIN as i64 && r <= i32::MAX as i64)
}

/// Tukey(0.5) window.
fn tukey(n: usize, p: f64) -> Vec<f64> {
    let mut w = vec![1.0; n];
    let np = ((p / 2.0) * n as f64) as usize;
    if np > 0 && n > 1 {
        for i in 0..np {
            let v = 0.5 - 0.5 * (std::f64::consts::PI * i as f64 / np as f64).cos();
            w[i] = v;
            w[n - 1 - i] = v;
        }
    }
    w
}

fn welch(n: usize) -> Vec<f64> {
    let half = (n as f64 - 1.0) / 2.0;
    (0..n)
        .map(|i| {
            let t = (i as f64 - half) / (half + 1.0);
            1.0 - t * t
        })
        .collect()
}

fn autocorrelation(x: &[i64], window: &[f64], max_lag: usize) -> Vec<f64> {
    let d: Vec<f64> = x.iter().zip(window).map(|(&v, &w)| v as f64 * w).collect();
    let mut ac = vec![0.0; max_lag + 1];
    for (lag, a) in ac.iter_mut().enumerate() {
        let mut s = 0.0;
        for i in lag..d.len() {
            s += d[i] * d[i - lag];
        }
        *a = s;
    }
    ac
}

/// Levinson-Durbin recursion. Returns coefficient sets for orders 1..=max
/// (index order-1) and the prediction error for each order.
fn levinson(ac: &[f64], max: usize) -> (Vec<Vec<f64>>, Vec<f64>) {
    let mut sets = Vec::with_capacity(max);
    let mut errs = Vec::with_capacity(max);
    let mut lpc = vec![0.0; max];
    let mut err = ac[0];
    for i in 0..max {
        if err <= 0.0 {
            break;
        }
        let mut r = -ac[i + 1];
        for j in 0..i {
            r -= lpc[j] * ac[i - j];
        }
        r /= err;
        lpc[i] = r;
        for j in 0..i / 2 {
            let tmp = lpc[j];
            lpc[j] += r * lpc[i - 1 - j];
            lpc[i - 1 - j] += r * tmp;
        }
        if i % 2 == 1 {
            lpc[i / 2] += lpc[i / 2] * r;
        }
        err *= 1.0 - r * r;
        // FLAC predicts x[n] = sum c[j] x[n-1-j], the negated LPC polynomial.
        sets.push(lpc[..=i].iter().map(|&c| -c).collect());
        errs.push(err);
    }
    (sets, errs)
}

fn qlp_precision(bps: u32, block: usize) -> u32 {
    let p = if block <= 192 {
        7
    } else if block <= 384 {
        8
    } else if block <= 576 {
        9
    } else if block <= 1152 {
        10
    } else if block <= 2304 {
        11
    } else if block <= 4608 {
        12
    } else {
        13
    };
    // Keep sample bits + coefficient bits + log2(order) within 32 so the
    // simple 32-bit decoder path stays exact for 16-bit audio.
    if bps <= 16 {
        p
    } else {
        p.min(15)
    }
}

/// Quantizes coefficients to `precision` bits with error feedback. Returns (coeffs, shift).
fn quantize(coeffs: &[f64], precision: u32) -> Option<(Vec<i32>, i32)> {
    let cmax = coeffs.iter().fold(0.0f64, |m, c| m.max(c.abs()));
    if cmax <= 0.0 || !cmax.is_finite() {
        return None;
    }
    let qmax = (1i64 << (precision - 1)) - 1;
    let qmin = -(1i64 << (precision - 1));
    let log2cmax = cmax.log2().floor() as i32 + 1;
    let shift = (precision as i32 - 1 - log2cmax).clamp(0, 15);
    let scale = (1i64 << shift) as f64;
    let mut err = 0.0;
    let mut out = Vec::with_capacity(coeffs.len());
    for &c in coeffs {
        err += c * scale;
        let q = (err.round() as i64).clamp(qmin, qmax);
        err -= q as f64;
        out.push(q as i32);
    }
    Some((out, shift))
}

fn lpc_residual(x: &[i64], q: &[i32], shift: i32, out: &mut Vec<i64>) {
    out.clear();
    let order = q.len();
    for i in order..x.len() {
        let mut sum = 0i64;
        for (j, &c) in q.iter().enumerate() {
            sum += c as i64 * x[i - 1 - j];
        }
        out.push(x[i] - (sum >> shift));
    }
}

// ------------------------------------------------------------------ subframes

#[derive(Clone)]
enum Kind {
    Constant,
    Verbatim,
    Fixed(usize),
    Lpc { coeffs: Vec<i32>, shift: i32, precision: u32 },
}

#[derive(Clone)]
struct Subframe {
    kind: Kind,
    wasted: u32,
    bps: u32,
    residual: Vec<i64>,
    rice: RicePlan,
    bits: u64,
}

struct Scratch {
    res: Vec<i64>,
    sums: Vec<u64>,
    shifted: Vec<i64>,
    windows: Vec<(usize, Vec<f64>)>,
}

impl Scratch {
    fn window(&mut self, n: usize, which: usize) -> Vec<f64> {
        let key = n * 2 + which;
        if let Some((_, w)) = self.windows.iter().find(|(k, _)| *k == key) {
            return w.clone();
        }
        let w = if which == 0 { tukey(n, 0.5) } else { welch(n) };
        self.windows.push((key, w.clone()));
        w
    }
}

fn best_subframe(x: &[i64], bps: u32, cfg: &Settings, s: &mut Scratch) -> Subframe {
    let n = x.len();
    // Constant block.
    if x.iter().all(|&v| v == x[0]) {
        return Subframe { kind: Kind::Constant, wasted: 0, bps, residual: Vec::new(), rice: RicePlan::default(), bits: 8 + bps as u64 };
    }
    // Wasted bits: trailing zeros shared by every sample.
    let or = x.iter().fold(0i64, |a, &v| a | v);
    let wasted = if or == 0 { 0 } else { or.trailing_zeros().min(bps - 1) };
    let ebps = bps - wasted;
    let xs: &[i64] = if wasted > 0 {
        s.shifted.clear();
        s.shifted.extend(x.iter().map(|&v| v >> wasted));
        &s.shifted
    } else {
        x
    };
    let xs = xs.to_vec();
    let head = 8 + wasted as u64;
    let mut best = Subframe { kind: Kind::Verbatim, wasted, bps: ebps, residual: Vec::new(), rice: RicePlan::default(), bits: head + n as u64 * ebps as u64 };

    // Fixed predictors: pick the order with the smallest residual magnitude.
    let max_fixed = cfg.max_fixed_order.min(n.saturating_sub(1)).min(4);
    let mut best_order = 0;
    let mut best_sum = u64::MAX;
    for order in 0..=max_fixed {
        fixed_residual(&xs, order, &mut s.res);
        let sum: u64 = s.res.iter().map(|&r| r.unsigned_abs()).sum();
        if sum < best_sum && fits_i32(&s.res) {
            best_sum = sum;
            best_order = order;
        }
    }
    if best_sum != u64::MAX {
        fixed_residual(&xs, best_order, &mut s.res);
        let plan = plan_rice(&s.res, best_order, n, cfg.max_partition_order, &mut s.sums);
        let bits = head + best_order as u64 * ebps as u64 + plan.bits;
        if bits < best.bits {
            best = Subframe { kind: Kind::Fixed(best_order), wasted, bps: ebps, residual: s.res.clone(), rice: plan, bits };
        }
    }

    // Linear prediction.
    let max_lpc = cfg.max_lpc_order.min(n.saturating_sub(1)).min(32);
    if max_lpc > 0 && n > 16 {
        let precision = qlp_precision(ebps, n);
        let window_count = if cfg.exhaustive_order { 2 } else { 1 };
        for which in 0..window_count {
            let window = s.window(n, which);
            let ac = autocorrelation(&xs, &window, max_lpc);
            if ac[0] <= 0.0 {
                continue;
            }
            let (sets, errs) = levinson(&ac, max_lpc);
            if sets.is_empty() {
                continue;
            }
            let orders: Vec<usize> = if cfg.exhaustive_order {
                (1..=sets.len()).collect()
            } else {
                // Estimate bits per residual sample from each order's error.
                let scale = 0.5 / n as f64;
                let mut pick = 1;
                let mut pick_bits = f64::MAX;
                for (i, &e) in errs.iter().enumerate() {
                    let order = i + 1;
                    let bps_est = if e > 0.0 { (0.5 * (scale * e).log2()).max(0.0) } else { 0.0 };
                    let total = bps_est * (n - order) as f64 + (order as f64) * (ebps + precision) as f64;
                    if total < pick_bits {
                        pick_bits = total;
                        pick = order;
                    }
                }
                vec![pick]
            };
            for order in orders {
                let Some((q, shift)) = quantize(&sets[order - 1], precision) else { continue };
                lpc_residual(&xs, &q, shift, &mut s.res);
                if !fits_i32(&s.res) {
                    continue;
                }
                let plan = plan_rice(&s.res, order, n, cfg.max_partition_order, &mut s.sums);
                let bits = head + order as u64 * ebps as u64 + 4 + 5 + order as u64 * precision as u64 + plan.bits;
                if bits < best.bits {
                    best = Subframe { kind: Kind::Lpc { coeffs: q, shift, precision }, wasted, bps: ebps, residual: s.res.clone(), rice: plan, bits };
                }
            }
        }
    }
    if matches!(best.kind, Kind::Verbatim) {
        best.residual = xs;
    }
    best
}

fn write_subframe(w: &mut BitWriter, x: &[i64], sf: &Subframe, bps: u32) {
    let n = x.len();
    let wasted_flag = if sf.wasted > 0 { 1 } else { 0 };
    let ebps = sf.bps;
    match &sf.kind {
        Kind::Constant => {
            w.write(0, 1);
            w.write(0, 6);
            w.write(0, 1);
            w.write_signed(x[0], bps);
            return;
        }
        Kind::Verbatim => w.write(0b00000010 | wasted_flag, 8),
        Kind::Fixed(order) => w.write(((0b001000 | *order as u64) << 1) | wasted_flag, 8),
        Kind::Lpc { coeffs, .. } => w.write(((0b100000 | (coeffs.len() as u64 - 1)) << 1) | wasted_flag, 8),
    }
    if sf.wasted > 0 {
        w.write_unary(sf.wasted as u64 - 1);
    }
    let shifted = |i: usize| x[i] >> sf.wasted;
    match &sf.kind {
        Kind::Verbatim => {
            for i in 0..n {
                w.write_signed(shifted(i), ebps);
            }
        }
        Kind::Fixed(order) => {
            for i in 0..*order {
                w.write_signed(shifted(i), ebps);
            }
            write_residual(w, &sf.residual, *order, n, &sf.rice);
        }
        Kind::Lpc { coeffs, shift, precision } => {
            let order = coeffs.len();
            for i in 0..order {
                w.write_signed(shifted(i), ebps);
            }
            w.write(*precision as u64 - 1, 4);
            w.write_signed(*shift as i64, 5);
            for &c in coeffs {
                w.write_signed(c as i64, *precision);
            }
            write_residual(w, &sf.residual, order, n, &sf.rice);
        }
        Kind::Constant => {}
    }
}

// --------------------------------------------------------------------- frames

fn write_utf8(w: &mut BitWriter, v: u64) {
    if v < 0x80 {
        w.write(v, 8);
        return;
    }
    let bytes = if v < 0x800 {
        2
    } else if v < 0x10000 {
        3
    } else if v < 0x200000 {
        4
    } else if v < 0x4000000 {
        5
    } else if v < 0x80000000 {
        6
    } else {
        7
    };
    let lead_mask: u64 = if bytes == 7 { 0xfe } else { (0xff00u64 >> bytes) & 0xff };
    let first_bits = if bytes == 7 { 0 } else { 7 - bytes };
    w.write(lead_mask | (v >> (6 * (bytes - 1))) & ((1 << first_bits) - 1), 8);
    for i in (0..bytes - 1).rev() {
        w.write(0x80 | ((v >> (6 * i)) & 0x3f), 8);
    }
}

fn rate_code(rate: u32) -> (u64, u32, u64) {
    // (code, extra bits, extra value)
    match rate {
        88200 => (1, 0, 0),
        176400 => (2, 0, 0),
        192000 => (3, 0, 0),
        8000 => (4, 0, 0),
        16000 => (5, 0, 0),
        22050 => (6, 0, 0),
        24000 => (7, 0, 0),
        32000 => (8, 0, 0),
        44100 => (9, 0, 0),
        48000 => (10, 0, 0),
        96000 => (11, 0, 0),
        r if r % 1000 == 0 && r / 1000 <= 255 => (12, 8, (r / 1000) as u64),
        r if r <= 65535 => (13, 16, r as u64),
        r if r % 10 == 0 && r / 10 <= 65535 => (14, 16, (r / 10) as u64),
        _ => (0, 0, 0),
    }
}

fn block_code(n: usize) -> (u64, u32, u64) {
    match n {
        192 => (1, 0, 0),
        576 => (2, 0, 0),
        1152 => (3, 0, 0),
        2304 => (4, 0, 0),
        4608 => (5, 0, 0),
        256 => (8, 0, 0),
        512 => (9, 0, 0),
        1024 => (10, 0, 0),
        2048 => (11, 0, 0),
        4096 => (12, 0, 0),
        8192 => (13, 0, 0),
        16384 => (14, 0, 0),
        32768 => (15, 0, 0),
        n if n <= 256 => (6, 8, n as u64 - 1),
        n => (7, 16, n as u64 - 1),
    }
}

fn size_code(bps: u32) -> u64 {
    match bps {
        8 => 1,
        12 => 2,
        16 => 4,
        20 => 5,
        24 => 6,
        32 => 7,
        _ => 0,
    }
}

pub struct Encoder {
    pub rate: u32,
    pub channels: usize,
    pub bps: u32,
    pub cfg: Settings,
    /// Planar input: channel c occupies [c * block_size, (c + 1) * block_size).
    pub input: Vec<i32>,
    pub out: BitWriter,
    frame: u64,
    total: u64,
    min_frame: u32,
    max_frame: u32,
    min_block: usize,
    max_block: usize,
    md5: Md5,
    md5_bytes: Vec<u8>,
    scratch: Scratch,
    streaminfo: [u8; 34],
}

impl Encoder {
    pub fn new(rate: u32, channels: usize, bps: u32, level: u32) -> Encoder {
        let cfg = settings(level);
        Encoder {
            rate,
            channels,
            bps,
            cfg,
            input: vec![0; cfg.block_size * channels],
            out: BitWriter::new(),
            frame: 0,
            total: 0,
            min_frame: u32::MAX,
            max_frame: 0,
            min_block: usize::MAX,
            max_block: 0,
            md5: Md5::new(),
            md5_bytes: Vec::new(),
            scratch: Scratch { res: Vec::new(), sums: Vec::new(), shifted: Vec::new(), windows: Vec::new() },
            streaminfo: [0; 34],
        }
    }

    /// Encodes the first `n` frames of `input` as one FLAC frame into `out`.
    pub fn encode(&mut self, n: usize) -> usize {
        self.out.clear();
        if n == 0 {
            return 0;
        }
        let bs = self.cfg.block_size;
        let nch = self.channels;
        let bps = self.bps;
        // MD5 of the interleaved little-endian source samples.
        let width = ((bps + 7) / 8) as usize;
        self.md5_bytes.clear();
        for i in 0..n {
            for c in 0..nch {
                let v = self.input[c * bs + i];
                self.md5_bytes.extend_from_slice(&v.to_le_bytes()[..width]);
            }
        }
        self.md5.update(&self.md5_bytes);

        let chans: Vec<Vec<i64>> = (0..nch).map(|c| self.input[c * bs..c * bs + n].iter().map(|&v| v as i64).collect()).collect();
        let cfg = self.cfg;
        // Channel assignment and subframes.
        let (assign, frames): (u64, Vec<(Vec<i64>, Subframe, u32)>) = if nch == 2 && cfg.stereo == Stereo::Adaptive {
            let l = &chans[0];
            let r = &chans[1];
            let side: Vec<i64> = l.iter().zip(r).map(|(a, b)| a - b).collect();
            let mid: Vec<i64> = l.iter().zip(r).map(|(a, b)| (a + b) >> 1).collect();
            let sl = best_subframe(l, bps, &cfg, &mut self.scratch);
            let sr = best_subframe(r, bps, &cfg, &mut self.scratch);
            let ss = best_subframe(&side, bps + 1, &cfg, &mut self.scratch);
            let sm = best_subframe(&mid, bps, &cfg, &mut self.scratch);
            let options = [
                (0b0001u64, sl.bits + sr.bits),
                (0b1000, sl.bits + ss.bits),
                (0b1001, ss.bits + sr.bits),
                (0b1010, sm.bits + ss.bits),
            ];
            let pick = options.iter().min_by_key(|o| o.1).unwrap().0;
            match pick {
                0b1000 => (pick, vec![(l.clone(), sl, bps), (side, ss, bps + 1)]),
                0b1001 => (pick, vec![(side, ss, bps + 1), (r.clone(), sr, bps)]),
                0b1010 => (pick, vec![(mid, sm, bps), (side, ss, bps + 1)]),
                _ => (pick, vec![(l.clone(), sl, bps), (r.clone(), sr, bps)]),
            }
        } else {
            let list = chans
                .into_iter()
                .map(|x| {
                    let sf = best_subframe(&x, bps, &cfg, &mut self.scratch);
                    (x, sf, bps)
                })
                .collect();
            (nch as u64 - 1, list)
        };

        // Frame header.
        let w = &mut self.out;
        w.write(0b11111111111110, 14);
        w.write(0, 1);
        w.write(0, 1); // fixed block size stream
        let (bcode, bextra_bits, bextra) = block_code(n);
        let (rcode, rextra_bits, rextra) = rate_code(self.rate);
        w.write(bcode, 4);
        w.write(rcode, 4);
        w.write(assign, 4);
        w.write(size_code(bps), 3);
        w.write(0, 1);
        write_utf8(w, self.frame);
        w.write(bextra, bextra_bits);
        w.write(rextra, rextra_bits);
        let crc = crc8(&w.buf);
        w.write(crc as u64, 8);
        for (x, sf, b) in &frames {
            write_subframe(w, x, sf, *b);
        }
        w.align();
        let crc = crc16(&w.buf);
        w.write(crc as u64, 16);

        let size = w.buf.len();
        self.frame += 1;
        self.total += n as u64;
        self.min_frame = self.min_frame.min(size as u32);
        self.max_frame = self.max_frame.max(size as u32);
        self.min_block = self.min_block.min(n);
        self.max_block = self.max_block.max(n);
        size
    }

    /// The STREAMINFO metadata block body (34 bytes) for everything encoded so far.
    pub fn streaminfo(&mut self) -> &[u8; 34] {
        let mut w = BitWriter::new();
        let bs = self.cfg.block_size as u64;
        // In a fixed-size stream every block but the last has the nominal size.
        let min_block = if self.frame <= 1 { self.min_block.min(self.cfg.block_size) as u64 } else { bs };
        w.write(min_block.max(16).min(bs), 16);
        w.write(bs, 16);
        w.write(if self.min_frame == u32::MAX { 0 } else { self.min_frame as u64 }, 24);
        w.write(self.max_frame as u64, 24);
        w.write(self.rate as u64, 20);
        w.write(self.channels as u64 - 1, 3);
        w.write(self.bps as u64 - 1, 5);
        w.write(self.total >> 32, 4);
        w.write(self.total & 0xffff_ffff, 32);
        let digest = self.md5.clone().finish();
        for b in digest {
            w.write(b as u64, 8);
        }
        self.streaminfo.copy_from_slice(&w.buf[..34]);
        &self.streaminfo
    }
}

// ---------------------------------------------------------------------- C ABI

#[no_mangle]
pub extern "C" fn flac_new(rate: u32, channels: u32, bps: u32, level: u32) -> u32 {
    if channels == 0 || channels > 8 || !(4..=24).contains(&bps) || rate == 0 || rate > 655350 {
        return 0;
    }
    Box::into_raw(Box::new(Encoder::new(rate, channels as usize, bps, level.min(8)))) as u32
}

#[no_mangle]
pub extern "C" fn flac_block_size(h: u32) -> u32 {
    unsafe { (*(h as *mut Encoder)).cfg.block_size as u32 }
}

#[no_mangle]
pub extern "C" fn flac_input(h: u32) -> u32 {
    unsafe { (*(h as *mut Encoder)).input.as_mut_ptr() as u32 }
}

#[no_mangle]
pub extern "C" fn flac_encode(h: u32, frames: u32) -> u32 {
    let e = unsafe { &mut *(h as *mut Encoder) };
    let n = (frames as usize).min(e.cfg.block_size);
    e.encode(n) as u32
}

#[no_mangle]
pub extern "C" fn flac_output(h: u32) -> u32 {
    unsafe { (*(h as *mut Encoder)).out.buf.as_ptr() as u32 }
}

#[no_mangle]
pub extern "C" fn flac_streaminfo(h: u32) -> u32 {
    let e = unsafe { &mut *(h as *mut Encoder) };
    e.streaminfo().as_ptr() as u32
}

#[no_mangle]
pub extern "C" fn flac_free(h: u32) {
    if h != 0 {
        unsafe { drop(Box::from_raw(h as *mut Encoder)) }
    }
}

// ---------------------------------------------------------------------- tests

#[cfg(test)]
mod tests {
    use super::*;

    /// A small, independent FLAC decoder used only to check the encoder.
    struct BitReader<'a> {
        data: &'a [u8],
        pos: usize, // bit position
    }

    impl<'a> BitReader<'a> {
        fn read(&mut self, n: u32) -> u64 {
            let mut v = 0u64;
            for _ in 0..n {
                let byte = self.data[self.pos / 8];
                let bit = (byte >> (7 - (self.pos % 8))) & 1;
                v = (v << 1) | bit as u64;
                self.pos += 1;
            }
            v
        }
        fn read_signed(&mut self, n: u32) -> i64 {
            if n == 0 {
                return 0;
            }
            let v = self.read(n);
            ((v << (64 - n)) as i64) >> (64 - n)
        }
        fn unary(&mut self) -> u64 {
            let mut q = 0;
            while self.read(1) == 0 {
                q += 1;
            }
            q
        }
        fn align(&mut self) {
            self.pos = (self.pos + 7) / 8 * 8;
        }
    }

    fn read_residual(r: &mut BitReader, block: usize, order: usize, out: &mut Vec<i64>) {
        let method = r.read(2);
        assert!(method <= 1);
        let pbits = if method == 1 { 5 } else { 4 };
        let porder = r.read(4) as u32;
        let parts = 1usize << porder;
        for p in 0..parts {
            let n = (block >> porder) - if p == 0 { order } else { 0 };
            let k = r.read(pbits) as u32;
            assert!(k < (1 << pbits) - 1, "escape codes are not produced");
            for _ in 0..n {
                let q = r.unary();
                let u = (q << k) | r.read(k);
                out.push(((u >> 1) as i64) ^ -((u & 1) as i64));
            }
        }
    }

    fn decode_subframe(r: &mut BitReader, block: usize, bps: u32) -> Vec<i64> {
        assert_eq!(r.read(1), 0);
        let t = r.read(6);
        let mut wasted = 0;
        if r.read(1) == 1 {
            wasted = r.unary() as u32 + 1;
        }
        let ebps = bps - wasted;
        let mut out = Vec::with_capacity(block);
        if t == 0 {
            let v = r.read_signed(ebps);
            out.resize(block, v);
        } else if t == 1 {
            for _ in 0..block {
                out.push(r.read_signed(ebps));
            }
        } else if (8..=12).contains(&t) {
            let order = (t - 8) as usize;
            for _ in 0..order {
                out.push(r.read_signed(ebps));
            }
            let mut res = Vec::new();
            read_residual(r, block, order, &mut res);
            for (i, &e) in res.iter().enumerate() {
                let n = i + order;
                let p = match order {
                    0 => 0,
                    1 => out[n - 1],
                    2 => 2 * out[n - 1] - out[n - 2],
                    3 => 3 * out[n - 1] - 3 * out[n - 2] + out[n - 3],
                    _ => 4 * out[n - 1] - 6 * out[n - 2] + 4 * out[n - 3] - out[n - 4],
                };
                out.push(p + e);
            }
        } else if t >= 32 {
            let order = (t - 31) as usize;
            for _ in 0..order {
                out.push(r.read_signed(ebps));
            }
            let precision = r.read(4) as u32 + 1;
            let shift = r.read_signed(5);
            assert!(shift >= 0);
            let coeffs: Vec<i64> = (0..order).map(|_| r.read_signed(precision)).collect();
            let mut res = Vec::new();
            read_residual(r, block, order, &mut res);
            for (i, &e) in res.iter().enumerate() {
                let n = i + order;
                let mut sum = 0i64;
                for (j, &c) in coeffs.iter().enumerate() {
                    sum += c * out[n - 1 - j];
                }
                out.push((sum >> shift) + e);
            }
        } else {
            panic!("reserved subframe type {t}");
        }
        if wasted > 0 {
            for v in out.iter_mut() {
                *v <<= wasted;
            }
        }
        out
    }

    fn read_utf8(r: &mut BitReader) -> u64 {
        let first = r.read(8);
        let extra = if first < 0x80 { 0 } else if first >= 0xfe { 6 } else { (first as u8).leading_ones() as u64 - 1 };
        let mut v = if extra == 0 { first } else if first >= 0xfe { 0 } else { first & (0x7f >> (extra + 1)) };
        for _ in 0..extra {
            let b = r.read(8);
            assert_eq!(b & 0xc0, 0x80);
            v = (v << 6) | (b & 0x3f);
        }
        v
    }

    /// Decodes a whole FLAC file, checking every CRC. Returns (rate, channels, bps, planar samples, md5).
    fn decode(file: &[u8]) -> (u32, usize, u32, Vec<Vec<i64>>, [u8; 16]) {
        assert_eq!(&file[..4], b"fLaC");
        let mut pos = 4;
        let (mut rate, mut nch, mut bps, mut total, mut md5) = (0u32, 0usize, 0u32, 0u64, [0u8; 16]);
        loop {
            let last = file[pos] & 0x80 != 0;
            let kind = file[pos] & 0x7f;
            let len = ((file[pos + 1] as usize) << 16) | ((file[pos + 2] as usize) << 8) | file[pos + 3] as usize;
            if kind == 0 {
                let mut r = BitReader { data: &file[pos + 4..pos + 4 + len], pos: 0 };
                r.read(16);
                r.read(16);
                r.read(24);
                r.read(24);
                rate = r.read(20) as u32;
                nch = r.read(3) as usize + 1;
                bps = r.read(5) as u32 + 1;
                total = r.read(36);
                for b in md5.iter_mut() {
                    *b = r.read(8) as u8;
                }
            }
            pos += 4 + len;
            if last {
                break;
            }
        }
        let mut out: Vec<Vec<i64>> = vec![Vec::new(); nch];
        let mut frame_no = 0u64;
        while pos < file.len() {
            let mut r = BitReader { data: &file[pos..], pos: 0 };
            assert_eq!(r.read(14), 0b11111111111110, "sync");
            r.read(2);
            let bcode = r.read(4);
            let rcode = r.read(4);
            let assign = r.read(4);
            let scode = r.read(3);
            r.read(1);
            assert_eq!(read_utf8(&mut r), frame_no);
            let block = match bcode {
                1 => 192,
                2..=5 => 576 << (bcode - 2),
                6 => r.read(8) as usize + 1,
                7 => r.read(16) as usize + 1,
                8..=15 => 256 << (bcode - 8),
                _ => panic!("block code"),
            };
            match rcode {
                12 => assert_eq!(r.read(8) as u32 * 1000, rate),
                13 => assert_eq!(r.read(16) as u32, rate),
                14 => assert_eq!(r.read(16) as u32 * 10, rate),
                _ => {}
            }
            let fbps = match scode {
                0 => bps,
                1 => 8,
                2 => 12,
                4 => 16,
                5 => 20,
                6 => 24,
                7 => 32,
                _ => panic!("size code"),
            };
            assert_eq!(fbps, bps);
            let hlen = r.pos / 8;
            assert_eq!(r.read(8) as u8, crc8(&file[pos..pos + hlen]), "header crc");
            let mut chans = Vec::new();
            for c in 0..nch {
                let extra = match assign {
                    8 if c == 1 => 1,
                    9 if c == 0 => 1,
                    10 if c == 1 => 1,
                    _ => 0,
                };
                chans.push(decode_subframe(&mut r, block, bps + extra));
            }
            r.align();
            let flen = r.pos / 8;
            assert_eq!(r.read(16) as u16, crc16(&file[pos..pos + flen]), "frame crc");
            match assign {
                8 => {
                    for i in 0..block {
                        chans[1][i] = chans[0][i] - chans[1][i];
                    }
                }
                9 => {
                    for i in 0..block {
                        chans[0][i] += chans[1][i];
                    }
                }
                10 => {
                    for i in 0..block {
                        let side = chans[1][i];
                        let mid = (chans[0][i] << 1) | (side & 1);
                        chans[0][i] = (mid + side) >> 1;
                        chans[1][i] = (mid - side) >> 1;
                    }
                }
                _ => {}
            }
            for (o, c) in out.iter_mut().zip(chans) {
                o.extend(c);
            }
            pos += flen + 2;
            frame_no += 1;
        }
        assert_eq!(out[0].len() as u64, total);
        (rate, nch, bps, out, md5)
    }

    fn encode_file(chans: &[Vec<i32>], rate: u32, bps: u32, level: u32) -> Vec<u8> {
        let nch = chans.len();
        let mut e = Encoder::new(rate, nch, bps, level);
        let bs = e.cfg.block_size;
        let mut frames = Vec::new();
        let len = chans[0].len();
        let mut at = 0;
        while at < len {
            let n = bs.min(len - at);
            for c in 0..nch {
                e.input[c * bs..c * bs + n].copy_from_slice(&chans[c][at..at + n]);
            }
            e.encode(n);
            frames.extend_from_slice(&e.out.buf);
            at += n;
        }
        let mut file = b"fLaC".to_vec();
        file.extend_from_slice(&[0x80, 0, 0, 34]);
        file.extend_from_slice(e.streaminfo());
        file.extend(frames);
        file
    }

    fn signal(len: usize, bps: u32, seed: u32, phase: f64) -> Vec<i32> {
        let amp = ((1i64 << (bps - 1)) - 1) as f64 * 0.6;
        let mut s = seed;
        (0..len)
            .map(|i| {
                s = s.wrapping_mul(1664525).wrapping_add(1013904223);
                let noise = ((s >> 8) as f64 / (1u32 << 24) as f64 - 0.5) * 0.02;
                let t = i as f64 / 44100.0;
                let v = (2.0 * std::f64::consts::PI * 440.0 * t + phase).sin() * 0.7 + (2.0 * std::f64::consts::PI * 3150.0 * t).sin() * 0.2 + noise;
                (v * amp).round() as i32
            })
            .collect()
    }

    fn check_round_trip(chans: Vec<Vec<i32>>, rate: u32, bps: u32, level: u32) -> usize {
        let file = encode_file(&chans, rate, bps, level);
        let (r, n, b, out, md5) = decode(&file);
        assert_eq!((r, n, b), (rate, chans.len(), bps));
        for (c, ch) in chans.iter().enumerate() {
            assert_eq!(out[c].len(), ch.len());
            for (i, &v) in ch.iter().enumerate() {
                assert_eq!(out[c][i], v as i64, "level {level} bps {bps} channel {c} sample {i}");
            }
        }
        // MD5 over interleaved little-endian samples.
        let mut m = Md5::new();
        let width = ((bps + 7) / 8) as usize;
        let mut bytes = Vec::new();
        for i in 0..chans[0].len() {
            for ch in &chans {
                bytes.extend_from_slice(&ch[i].to_le_bytes()[..width]);
            }
        }
        m.update(&bytes);
        assert_eq!(m.finish(), md5);
        file.len()
    }

    #[test]
    fn round_trips_every_level_16_bit_stereo() {
        let len = 4096 * 3 + 777;
        let mut sizes = Vec::new();
        for level in 0..=8 {
            let l = signal(len, 16, 1, 0.0);
            let r = signal(len, 16, 2, 0.3);
            let size = check_round_trip(vec![l, r], 44100, 16, level);
            sizes.push(size);
            assert!(size < len * 4 * 8 / 10, "level {level} compressed to {size}");
        }
        // Linear prediction beats the fixed predictors on tonal material.
        assert!(sizes[5] < sizes[0], "{sizes:?}");
        assert!(sizes[8] <= sizes[5] + 64, "{sizes:?}");
    }

    #[test]
    fn round_trips_24_bit_mono_and_odd_rates() {
        for level in [0, 5, 8] {
            check_round_trip(vec![signal(10000, 24, 3, 0.1)], 96000, 24, level);
            check_round_trip(vec![signal(3000, 24, 4, 0.2)], 22222, 24, level);
            check_round_trip(vec![signal(3000, 16, 5, 0.2)], 11000, 16, level);
        }
    }

    #[test]
    fn handles_silence_constants_wasted_bits_and_extremes() {
        let len = 5000;
        let silence = vec![0i32; len];
        let constant = vec![1234i32; len];
        let wasted: Vec<i32> = signal(len, 16, 9, 0.0).iter().map(|v| v & !0xff).collect();
        let extremes: Vec<i32> = (0..len).map(|i| if i % 2 == 0 { 32767 } else { -32768 }).collect();
        let steps: Vec<i32> = (0..len).map(|i| if (i / 7) % 2 == 0 { 32767 } else { -32768 }).collect();
        for level in [0, 3, 5, 8] {
            check_round_trip(vec![silence.clone(), constant.clone()], 48000, 16, level);
            check_round_trip(vec![wasted.clone(), extremes.clone()], 48000, 16, level);
            check_round_trip(vec![steps.clone(), silence.clone()], 48000, 16, level);
        }
        let x24: Vec<i32> = (0..len).map(|i| if i % 3 == 0 { 8388607 } else { -8388608 }).collect();
        check_round_trip(vec![x24.clone(), x24.iter().map(|v| -(v + 1)).collect()], 48000, 24, 8);
    }

    #[test]
    fn handles_tiny_files_and_many_channels() {
        check_round_trip(vec![vec![5]], 44100, 16, 5);
        check_round_trip(vec![vec![1, -1, 3]], 44100, 16, 5);
        let chans: Vec<Vec<i32>> = (0..6).map(|c| signal(2000, 16, c, c as f64)).collect();
        check_round_trip(chans, 48000, 16, 5);
        check_round_trip(vec![signal(4096 * 2, 8, 7, 0.0)], 8000, 8, 5);
    }

    #[test]
    fn utf8_frame_numbers() {
        for v in [0u64, 0x7f, 0x80, 0x7ff, 0x800, 0xffff, 0x10000, 0x1fffff, 0x200000, 0x3ffffff, 0x4000000, 0x7fffffff, 0x80000000, 0xfffffffff] {
            let mut w = BitWriter::new();
            write_utf8(&mut w, v);
            let mut r = BitReader { data: &w.buf, pos: 0 };
            assert_eq!(read_utf8(&mut r), v);
        }
    }
}
