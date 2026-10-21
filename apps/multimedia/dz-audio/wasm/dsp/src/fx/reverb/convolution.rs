//! Convolution Reverb: convolves the input with an impulse response supplied
//! by JavaScript through data slot 0, laid out as
//! `[channelCount (1 or 2), ...planar samples]` at the effect's sample rate.
//! A mono impulse feeds both channels; a stereo impulse convolves left with
//! left and right with right.
//!
//! Non-uniformly partitioned overlap-save convolution in three levels, each
//! uniformly partitioned (see LEVELS): 256-frame partitions for the start of
//! the impulse, computed as soon as a 256-frame block completes, then 1024-
//! and 8192-frame partitions further out. Each larger level starts at twice
//! its block size into the impulse, so its work can be spread evenly over the
//! following block period and no audio quantum pays for a whole large block.
//! Latency is one 256-frame block; the dry signal is delayed to match so the
//! mix stays aligned.
//!
//! Params: 0 impulse (JS side), 1 mix %, 2 room size (JS), 3 LF damping (JS),
//! 4 HF damping (JS), 5 pre-delay ms, 6 width %, 7 gain dB,
//! 8 centre send % (how much of the centre of a stereo input reaches the
//! room; 100 all), 9 centre wet % (level of the centre of the reverb, 50
//! unity), 10 balance % (-100 left .. 100 right, on the reverb), 11 unused
//! (the loaded impulse's name on the JS side), 12 LFE send %, 13 surround
//! width %, 14 front/back balance % (-100 front .. 100 back).
//! Surround Reverb uses them all; Convolution Reverb leaves 8.. at defaults.
//!
//! Surround: the room is a stereo convolution. Its rear pair is the wet
//! signal crossed (left from right) and delayed by REAR_MS, so the rear
//! reverb is decorrelated from the front. Created for six channels (5.1:
//! L, R, C, LFE, Ls, Rs) the effect feeds the room from L + Ls and R + Rs
//! plus the centre (centre send) and LFE (LFE send) on both sides, and
//! returns the front pair (front width), the rear pair (surround width), the
//! reverb's centre on C (centre wet) and nothing on LFE; front/back balance
//! trades the front against the rear. On one or two channels the rear pair
//! folds into the output as the balance moves back (none at 0 or in front).

use super::fastfft::FastRealFft as RealFft;
use crate::fx::util::{db_to_gain, DelayLine};
use crate::fx::{Effect, Smooth};

pub const B1: usize = 256;
/// (block size, first impulse frame, end frame) per level.
const LEVELS: [(usize, usize, usize); 3] = [(B1, 0, 2048), (1024, 2048, 16384), (8192, 16384, usize::MAX)];
/// Input history needed by the largest level.
const HISTORY: usize = 8192;
/// Output accumulator size: covers the furthest level's reach ahead.
const RING: usize = 32768;
pub const MAX_IR_SECONDS: f32 = 8.0;
pub const MAX_PREDELAY_MS: f32 = 500.0;
/// Extra delay of the rear reverb (decorrelation from the front pair).
pub const REAR_MS: f32 = 13.0;

/// One partition size of a uniformly partitioned convolver for all channels.
struct Level {
    b: usize,
    bins: usize,
    parts: usize,
    fft: RealFft,
    /// Impulse spectra per impulse channel: parts x bins.
    h_re: Vec<Vec<f32>>,
    h_im: Vec<Vec<f32>>,
    /// Frequency-domain delay line per channel: parts x bins.
    x_re: Vec<Vec<f32>>,
    x_im: Vec<Vec<f32>>,
    pos: usize,
    frame: Vec<Vec<f32>>,
    acc_re: Vec<Vec<f32>>,
    acc_im: Vec<Vec<f32>>,
    tmp: Vec<f32>,
    pub out: Vec<Vec<f32>>,
    /// Impulse channel used by each output channel.
    map: [usize; 2],
    step: usize,
}

impl Level {
    /// Partitions `ir[c][offset..offset + len]` into blocks of `b`.
    fn new(b: usize, ir: &[&[f32]], offset: usize, len: usize, channels: usize) -> Level {
        let bins = b + 1;
        let parts = (len + b - 1) / b;
        let mut fft = RealFft::new(2 * b);
        let mut tmp = vec![0.0; 2 * b];
        let mut h_re = Vec::with_capacity(ir.len());
        let mut h_im = Vec::with_capacity(ir.len());
        for ch in ir {
            let mut re = vec![0.0; parts * bins];
            let mut im = vec![0.0; parts * bins];
            for p in 0..parts {
                tmp.iter_mut().for_each(|v| *v = 0.0);
                let start = offset + p * b;
                let end = (start + b).min(offset + len).min(ch.len());
                if start < end {
                    tmp[..end - start].copy_from_slice(&ch[start..end]);
                }
                fft.forward(&tmp, &mut re[p * bins..(p + 1) * bins], &mut im[p * bins..(p + 1) * bins]);
            }
            h_re.push(re);
            h_im.push(im);
        }
        let per = |n: usize| (0..channels).map(|_| vec![0.0f32; n]).collect::<Vec<_>>();
        Level {
            b,
            bins,
            parts,
            fft,
            h_re,
            h_im,
            x_re: per(parts * bins),
            x_im: per(parts * bins),
            pos: 0,
            frame: per(2 * b),
            acc_re: per(bins),
            acc_im: per(bins),
            tmp,
            out: per(b),
            map: [0, if ir.len() > 1 { 1 } else { 0 }],
            step: usize::MAX,
        }
    }

    fn total_steps(&self) -> usize {
        self.parts + 2
    }

    fn clear(&mut self) {
        for v in self.x_re.iter_mut().chain(self.x_im.iter_mut()).chain(self.frame.iter_mut()).chain(self.out.iter_mut()) {
            v.iter_mut().for_each(|s| *s = 0.0);
        }
        self.step = usize::MAX;
    }

    /// Starts a job for the input block of `b` frames that begins at absolute
    /// frame `at`, read from the per-channel history rings.
    fn begin(&mut self, hist: &[Vec<f32>], at: u64) {
        let b = self.b;
        for (c, f) in self.frame.iter_mut().enumerate() {
            f.copy_within(b..2 * b, 0);
            let h = &hist[c];
            let mask = h.len() - 1;
            for (k, v) in f[b..].iter_mut().enumerate() {
                *v = h[(at as usize + k) & mask];
            }
        }
        self.step = 0;
    }

    fn done(&self) -> bool {
        self.step >= self.total_steps()
    }

    /// Runs job steps until `target` steps are complete.
    fn run_to(&mut self, target: usize) {
        let target = target.min(self.total_steps());
        while self.step < target {
            self.run_step();
            self.step += 1;
        }
    }

    fn run_step(&mut self) {
        let (bins, parts) = (self.bins, self.parts);
        let s = self.step;
        if s == 0 {
            self.pos = (self.pos + 1) % parts;
            let at = self.pos * bins;
            for c in 0..self.frame.len() {
                self.fft.forward(&self.frame[c], &mut self.x_re[c][at..at + bins], &mut self.x_im[c][at..at + bins]);
                self.acc_re[c].iter_mut().for_each(|v| *v = 0.0);
                self.acc_im[c].iter_mut().for_each(|v| *v = 0.0);
            }
        } else if s <= parts {
            let j = s - 1;
            let xp = ((self.pos + parts - j) % parts) * bins;
            let hp = j * bins;
            for c in 0..self.frame.len() {
                let hc = self.map[c.min(1)];
                let (xr, xi) = (&self.x_re[c][xp..xp + bins], &self.x_im[c][xp..xp + bins]);
                let (hr, hi) = (&self.h_re[hc][hp..hp + bins], &self.h_im[hc][hp..hp + bins]);
                cmac(&mut self.acc_re[c], &mut self.acc_im[c], xr, xi, hr, hi);
            }
        } else {
            let b = self.b;
            for c in 0..self.frame.len() {
                self.fft.inverse(&self.acc_re[c], &self.acc_im[c], &mut self.tmp);
                self.out[c].copy_from_slice(&self.tmp[b..2 * b]);
            }
        }
    }
}

/// Complex multiply-accumulate of split spectra: acc += x * h.
#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
fn cmac(ar: &mut [f32], ai: &mut [f32], xr: &[f32], xi: &[f32], hr: &[f32], hi: &[f32]) {
    use core::arch::wasm32::*;
    let n = ar.len().min(ai.len()).min(xr.len()).min(xi.len()).min(hr.len()).min(hi.len());
    let v = n & !3;
    let mut k = 0;
    // SAFETY: every index below `v` is in bounds of all six slices; v128
    // loads and stores are unaligned.
    unsafe {
        while k < v {
            let x_r = v128_load(xr.as_ptr().add(k) as *const v128);
            let x_i = v128_load(xi.as_ptr().add(k) as *const v128);
            let h_r = v128_load(hr.as_ptr().add(k) as *const v128);
            let h_i = v128_load(hi.as_ptr().add(k) as *const v128);
            let pr = ar.as_mut_ptr().add(k) as *mut v128;
            let pi = ai.as_mut_ptr().add(k) as *mut v128;
            let re = f32x4_sub(f32x4_mul(x_r, h_r), f32x4_mul(x_i, h_i));
            let im = f32x4_add(f32x4_mul(x_r, h_i), f32x4_mul(x_i, h_r));
            v128_store(pr, f32x4_add(v128_load(pr), re));
            v128_store(pi, f32x4_add(v128_load(pi), im));
            k += 4;
        }
    }
    for k in v..n {
        ar[k] += xr[k] * hr[k] - xi[k] * hi[k];
        ai[k] += xr[k] * hi[k] + xi[k] * hr[k];
    }
}

/// Complex multiply-accumulate of split spectra: acc += x * h.
#[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
fn cmac(ar: &mut [f32], ai: &mut [f32], xr: &[f32], xi: &[f32], hr: &[f32], hi: &[f32]) {
    for (((((a_r, a_i), &x_r), &x_i), &h_r), &h_i) in ar.iter_mut().zip(ai.iter_mut()).zip(xr).zip(xi).zip(hr).zip(hi) {
        *a_r += x_r * h_r - x_i * h_i;
        *a_i += x_r * h_i + x_i * h_r;
    }
}

/// A deferred level: its job for the block starting at `job_start` runs
/// spread over the next block period.
struct Stage {
    lv: Level,
    offset: usize,
    job_start: u64,
}

pub struct ConvolutionReverb {
    rate: f32,
    /// Channels of the room (1 or 2).
    channels: usize,
    /// Channels in and out: 1, 2, or 6 (5.1).
    io: usize,
    dry6: Vec<DelayLine>,
    rear: [DelayLine; 2],
    rear_frames: usize,
    lfe_send: Smooth,
    rear_width: Smooth,
    front_back: Smooth,
    head: Option<Level>,
    stages: Vec<Stage>,
    ir_len: usize,
    hist: Vec<Vec<f32>>,
    /// Absolute input frame count.
    n: u64,
    ring: Vec<Vec<f32>>,
    dry_line: Vec<DelayLine>,
    pre: Vec<DelayLine>,
    pre_frames: usize,
    predelay_ms: f32,
    mix: Smooth,
    width: Smooth,
    gain: Smooth,
    centre_send: Smooth,
    centre_wet: Smooth,
    balance: Smooth,
    fresh: bool,
}

impl ConvolutionReverb {
    pub fn new(rate: f32, io: usize) -> ConvolutionReverb {
        let io = if io >= 6 { 6 } else { io.clamp(1, 2) };
        let channels = io.min(2);
        let pre = (MAX_PREDELAY_MS * rate / 1000.0) as usize + 2;
        let rear_frames = (REAR_MS * rate / 1000.0).round() as usize;
        ConvolutionReverb {
            rate,
            channels,
            io,
            dry6: (0..if io == 6 { 6 } else { 0 }).map(|_| DelayLine::new(B1 + 1)).collect(),
            rear: [DelayLine::new(rear_frames + 2), DelayLine::new(rear_frames + 2)],
            rear_frames,
            lfe_send: Smooth::new(0.0, rate, 20.0),
            rear_width: Smooth::new(1.0, rate, 20.0),
            front_back: Smooth::new(0.0, rate, 20.0),
            head: None,
            stages: Vec::new(),
            ir_len: 0,
            hist: vec![vec![0.0; HISTORY]; channels],
            n: 0,
            ring: vec![vec![0.0; RING]; channels],
            dry_line: (0..channels).map(|_| DelayLine::new(B1 + 1)).collect(),
            pre: (0..channels).map(|_| DelayLine::new(pre)).collect(),
            pre_frames: 0,
            predelay_ms: 0.0,
            mix: Smooth::new(0.35, rate, 20.0),
            width: Smooth::new(1.0, rate, 20.0),
            gain: Smooth::new(1.0, rate, 20.0),
            centre_send: Smooth::new(1.0, rate, 20.0),
            centre_wet: Smooth::new(1.0, rate, 20.0),
            balance: Smooth::new(0.0, rate, 20.0),
            fresh: true,
        }
    }

    fn add_to_ring(ring: &mut [Vec<f32>], start: u64, out: &[Vec<f32>]) {
        for (c, o) in out.iter().enumerate() {
            let r = &mut ring[c];
            let mask = r.len() - 1;
            for (k, &v) in o.iter().enumerate() {
                r[(start as usize + k) & mask] += v;
            }
        }
    }

    fn settle(&mut self) {
        for sm in [&mut self.mix, &mut self.width, &mut self.gain, &mut self.centre_send, &mut self.centre_wet, &mut self.balance, &mut self.lfe_send, &mut self.rear_width, &mut self.front_back] {
            sm.settle();
        }
    }

    /// 5.1 in and out (planar L, R, C, LFE, Ls, Rs); see the module notes.
    fn process_surround(&mut self, buf: &mut [f32], frames: usize) {
        const H: f32 = std::f32::consts::FRAC_1_SQRT_2;
        let ch = self.channels;
        for i in 0..frames {
            let (mix, width, gain) = (self.mix.next(), self.width.next(), self.gain.next());
            let (csend, cwet, bal) = (self.centre_send.next(), self.centre_wet.next(), self.balance.next());
            let (lfe, rw, fb) = (self.lfe_send.next(), self.rear_width.next(), self.front_back.next());
            let x: [f32; 6] = std::array::from_fn(|c| buf[c * frames + i]);
            let common = (csend * x[2] + lfe * x[3]) * H;
            let send = [x[0] + x[4] + common, x[1] + x[5] + common];
            let read = (self.n.wrapping_sub(B1 as u64) as usize) & (RING - 1);
            let at = (self.n as usize) & (HISTORY - 1);
            let mut wet = [0.0f32; 2];
            for c in 0..ch {
                // A mono room hears both sides.
                let s = if ch == 1 { 0.5 * (send[0] + send[1]) } else { send[c] };
                self.pre[c].push(s);
                self.hist[c][at] = self.pre[c].tap(self.pre_frames);
                wet[c] = self.ring[c][read] * gain;
                self.ring[c][read] = 0.0;
            }
            if ch == 1 {
                wet[1] = wet[0];
            }
            let rl = self.rear[0].tap(self.rear_frames);
            let rr = self.rear[1].tap(self.rear_frames);
            self.rear[0].push(wet[1]);
            self.rear[1].push(wet[0]);
            let (lg, rg) = ((1.0 - bal).min(1.0), (1.0 + bal).min(1.0));
            let (front, back) = ((1.0 - fb).min(1.0), (1.0 + fb).min(1.0));
            let mid = 0.5 * (wet[0] + wet[1]);
            let side = 0.5 * (wet[0] - wet[1]) * width;
            let (rm, rs) = (0.5 * (rl + rr), 0.5 * (rl - rr) * rw);
            let out_wet = [(mid + side) * lg * front, (mid - side) * rg * front, mid * cwet * H * front, 0.0, (rm + rs) * lg * back, (rm - rs) * rg * back];
            for c in 0..6 {
                self.dry6[c].push(x[c]);
                let dry = self.dry6[c].tap(B1);
                buf[c * frames + i] = if c == 3 { dry } else { dry * (1.0 - mix) + out_wet[c] * mix };
            }
            self.n += 1;
            if self.n % B1 as u64 == 0 {
                self.block_done();
            }
        }
    }

    /// Called whenever a 256-frame block completes (n is a multiple of B1).
    fn block_done(&mut self) {
        let n = self.n;
        if let Some(h) = self.head.as_mut() {
            h.begin(&self.hist, n - B1 as u64);
            h.run_to(usize::MAX);
            Self::add_to_ring(&mut self.ring, n - B1 as u64, &h.out);
        }
        for st in &mut self.stages {
            let b = st.lv.b as u64;
            if n % b == 0 {
                // Finish the previous job and place it `offset` frames later.
                if st.lv.step != usize::MAX {
                    st.lv.run_to(usize::MAX);
                    Self::add_to_ring(&mut self.ring, st.job_start + st.offset as u64, &st.lv.out);
                }
                st.lv.begin(&self.hist, n - b);
                st.job_start = n - b;
            }
            if !st.lv.done() {
                // Spread the job so it completes one small block early.
                let b = b as usize;
                let elapsed = (n - (st.job_start + b as u64)) as usize;
                let total = st.lv.total_steps();
                let target = (total * (elapsed + B1) + b - B1 - 1) / (b - B1);
                st.lv.run_to(target);
            }
        }
    }
}

impl Effect for ConvolutionReverb {
    fn set_param(&mut self, idx: u32, v: f32) {
        match idx {
            1 => self.mix.target = (v * 0.01).clamp(0.0, 1.0),
            5 => {
                self.predelay_ms = v.clamp(0.0, MAX_PREDELAY_MS);
                self.pre_frames = (self.predelay_ms * self.rate / 1000.0).round() as usize;
            }
            6 => self.width.target = (v * 0.01).clamp(0.0, 3.0),
            7 => self.gain.target = db_to_gain(v.clamp(-60.0, 24.0)),
            8 => self.centre_send.target = (v * 0.01).clamp(0.0, 1.0),
            9 => self.centre_wet.target = (v * 0.02).clamp(0.0, 2.0),
            10 => self.balance.target = (v * 0.01).clamp(-1.0, 1.0),
            12 => self.lfe_send.target = (v * 0.01).clamp(0.0, 1.0),
            13 => self.rear_width.target = (v * 0.01).clamp(0.0, 3.0),
            14 => self.front_back.target = (v * 0.01).clamp(-1.0, 1.0),
            _ => {}
        }
    }

    fn set_data(&mut self, slot: u32, data: &[f32]) {
        if slot != 0 {
            return;
        }
        self.head = None;
        self.stages.clear();
        self.ir_len = 0;
        if data.len() < 2 {
            self.reset();
            return;
        }
        let k = (data[0].round() as usize).clamp(1, 2);
        let total = (data.len() - 1) / k;
        let len = total.min((MAX_IR_SECONDS * self.rate) as usize);
        let ir: Vec<&[f32]> = (0..k).map(|c| &data[1 + c * total..1 + c * total + len]).collect();
        self.ir_len = len;
        for (i, &(b, from, to)) in LEVELS.iter().enumerate() {
            if len <= from {
                break;
            }
            let lv = Level::new(b, &ir, from, len.min(to) - from, self.channels);
            if i == 0 {
                self.head = Some(lv);
            } else {
                self.stages.push(Stage { lv, offset: from, job_start: 0 });
            }
        }
        self.reset();
    }

    fn process(&mut self, buf: &mut [f32], channels: usize, frames: usize) {
        if self.fresh {
            self.fresh = false;
            self.settle();
        }
        if self.io == 6 && channels >= 6 {
            self.process_surround(buf, frames);
            return;
        }
        let ch = channels.min(self.channels);
        for i in 0..frames {
            let (mix, width, gain) = (self.mix.next(), self.width.next(), self.gain.next());
            let (csend, cwet, bal) = (self.centre_send.next(), self.centre_wet.next(), self.balance.next());
            let read = (self.n.wrapping_sub(B1 as u64) as usize) & (RING - 1);
            let at = (self.n as usize) & (HISTORY - 1);
            let mut wet = [0.0f32; 2];
            let mut dry = [0.0f32; 2];
            // The room hears the input with its centre (mid) scaled by the centre send.
            let mut send = [0.0f32; 2];
            for c in 0..ch {
                send[c] = buf[c * frames + i];
            }
            if ch == 2 && csend < 1.0 {
                let cut = (1.0 - csend) * 0.5 * (send[0] + send[1]);
                send = [send[0] - cut, send[1] - cut];
            }
            for c in 0..ch {
                let x = buf[c * frames + i];
                self.pre[c].push(send[c]);
                self.hist[c][at] = self.pre[c].tap(self.pre_frames);
                self.dry_line[c].push(x);
                dry[c] = self.dry_line[c].tap(B1);
                wet[c] = self.ring[c][read] * gain;
                self.ring[c][read] = 0.0;
            }
            let (rw, fb) = (self.rear_width.next(), self.front_back.next());
            self.lfe_send.next();
            // The rear pair: the wet signal crossed and delayed.
            let rl = self.rear[0].tap(self.rear_frames);
            let rr = self.rear[1].tap(self.rear_frames);
            self.rear[0].push(if ch == 2 { wet[1] } else { wet[0] });
            self.rear[1].push(wet[0]);
            if ch == 2 {
                let mid = 0.5 * (wet[0] + wet[1]) * cwet;
                let side = 0.5 * (wet[0] - wet[1]) * width;
                wet = [(mid + side) * (1.0 - bal).min(1.0), (mid - side) * (1.0 + bal).min(1.0)];
            }
            if fb > 0.0 {
                // Folded down: the balance moves the reverb back into the delayed, crossed rear.
                let (rm, rs) = (0.5 * (rl + rr), 0.5 * (rl - rr) * rw);
                let rear = [(rm + rs) * (1.0 - bal).min(1.0), (rm - rs) * (1.0 + bal).min(1.0)];
                for c in 0..ch {
                    wet[c] = wet[c] * (1.0 - fb) + rear[c] * fb;
                }
            }
            for c in 0..ch {
                buf[c * frames + i] = dry[c] * (1.0 - mix) + wet[c] * mix;
            }
            self.n += 1;
            if self.n % B1 as u64 == 0 {
                self.block_done();
            }
        }
    }

    fn reset(&mut self) {
        for v in self.hist.iter_mut().chain(self.ring.iter_mut()) {
            v.iter_mut().for_each(|s| *s = 0.0);
        }
        self.dry_line.iter_mut().chain(self.pre.iter_mut()).chain(self.dry6.iter_mut()).chain(self.rear.iter_mut()).for_each(|l| l.clear());
        if let Some(l) = self.head.as_mut() {
            l.clear();
        }
        for st in &mut self.stages {
            st.lv.clear();
            st.job_start = 0;
        }
        self.n = 0;
        self.settle();
    }

    fn latency(&self) -> u32 {
        B1 as u32
    }

    fn tail(&self) -> u32 {
        (self.ir_len + self.pre_frames) as u32
    }
}

#[cfg(test)]
mod tests {
    use crate::fx::testutil::*;
    use crate::fx::Effect;

    fn load(fx: &mut dyn Effect, ir: &[Vec<f32>]) {
        let mut d = vec![ir.len() as f32];
        for c in ir {
            d.extend_from_slice(c);
        }
        fx.set_data(0, &d);
    }

    fn direct(x: &[f32], h: &[f32]) -> Vec<f32> {
        let mut y = vec![0.0f32; x.len()];
        for (i, &xi) in x.iter().enumerate() {
            if xi == 0.0 {
                continue;
            }
            for (k, &hk) in h.iter().enumerate() {
                if i + k < y.len() {
                    y[i + k] += xi * hk;
                }
            }
        }
        y
    }

    fn check(len: usize) {
        let rate = 48000.0;
        let h: Vec<f32> = noise(len, 1.0, 3).iter().enumerate().map(|(i, v)| v * (-(i as f32) / 6000.0).exp()).collect();
        let mut x = vec![0.0f32; len + 15000];
        let src = noise(1000, 0.5, 4);
        x[100..1100].copy_from_slice(&src);
        x[len / 2] = 1.0;
        let mut fx = make(83, rate, 1);
        load(fx.as_mut(), &[h.clone()]);
        fx.set_param(1, 100.0);
        fx.set_param(7, 0.0);
        assert_eq!(fx.latency(), 256);
        let y = run_mono(fx.as_mut(), &x);
        let want = direct(&x, &h);
        let mut err = 0.0f32;
        let mut at = 0;
        for i in 0..x.len() - 256 {
            let e = (y[i + 256] - want[i]).abs();
            if e > err {
                err = e;
                at = i;
            }
        }
        assert!(err < 2e-3, "len {len}: max error {err} at {at}");
        assert_eq!(fx.tail(), len as u32);
    }

    #[test]
    fn matches_direct_convolution_in_level_one() {
        check(5003);
    }

    #[test]
    fn matches_direct_convolution_across_both_levels() {
        // Long enough to need all three levels, with an odd length.
        check(30011);
    }

    #[test]
    fn offline_block_sizes_match_realtime() {
        let rate = 48000.0;
        let h: Vec<f32> = noise(12000, 0.5, 8);
        let x = noise(30000, 0.5, 9);
        let mut a = make(83, rate, 2);
        let mut b = make(83, rate, 2);
        for fx in [&mut a, &mut b] {
            load(fx.as_mut(), &[h.clone(), h.iter().map(|v| -v).collect()]);
            fx.set_param(1, 50.0);
            fx.set_param(5, 10.0);
        }
        let (l1, r1) = run_stereo(a.as_mut(), &x, &x);
        let mut buf = vec![0.0; 2 * 30000];
        buf[..30000].copy_from_slice(&x);
        buf[30000..].copy_from_slice(&x);
        for chunk in 0..3 {
            let n = 10000;
            let mut blk = vec![0.0; 2 * n];
            blk[..n].copy_from_slice(&buf[chunk * n..(chunk + 1) * n]);
            blk[n..].copy_from_slice(&buf[30000 + chunk * n..30000 + (chunk + 1) * n]);
            b.process(&mut blk, 2, n);
            for i in 0..n {
                assert!((blk[i] - l1[chunk * n + i]).abs() < 1e-4);
                assert!((blk[n + i] - r1[chunk * n + i]).abs() < 1e-4);
            }
        }
        // Opposite polarity impulses on the two sides.
        let wet_corr: f32 = l1[20000..].iter().zip(&r1[20000..]).map(|(a, b)| a * b).sum();
        assert!(wet_corr < 0.0);
    }

    #[test]
    fn centre_send_and_balance_shape_the_wet_signal() {
        let rate = 48000.0;
        let run = |params: &[(u32, f32)]| {
            let mut fx = make(83, rate, 2);
            let mut ir = vec![0.0f32; 512];
            ir[0] = 1.0;
            load(fx.as_mut(), &[ir.clone(), ir]);
            fx.set_param(1, 100.0);
            for &(i, v) in params {
                fx.set_param(i, v);
            }
            fx.reset();
            let x = sine(500.0, rate, 9600, 0.5);
            let (l, r) = run_stereo(fx.as_mut(), &x, &x);
            (rms(&l[4800..]), rms(&r[4800..]))
        };
        let (l, r) = run(&[]);
        assert!((l - r).abs() < 1e-3 && l > 0.3, "{l} {r}");
        // A centred input with no centre send leaves the room silent.
        let (l, _) = run(&[(8, 0.0)]);
        assert!(l < 1e-3, "{l}");
        // Balance hard right silences the left of the reverb.
        let (l, r) = run(&[(10, 100.0)]);
        assert!(l < 1e-3 && r > 0.3, "{l} {r}");
        // Centre wet at 25 % halves a centred reverb.
        let (l, _) = run(&[(9, 25.0)]);
        assert!((l / 0.3535 - 0.5).abs() < 0.05, "{l}");
    }

    #[test]
    fn silent_without_an_impulse() {
        let mut fx = make(83, 48000.0, 2);
        fx.set_param(1, 100.0);
        let x = noise(4096, 0.5, 1);
        let (l, _) = run_stereo(fx.as_mut(), &x, &x);
        assert!(peak(&l) < 1e-6);
    }

    #[test]
    fn surround_feeds_and_returns_six_channels() {
        let rate = 48000.0;
        let ir: Vec<f32> = noise(4800, 0.5, 2).iter().enumerate().map(|(i, v)| v * (-(i as f32) / 1500.0).exp()).collect();
        let run = |params: &[(u32, f32)], input: usize| {
            let mut fx = make(83, rate, 6);
            load(fx.as_mut(), &[ir.clone(), ir.iter().rev().cloned().collect()]);
            fx.set_param(1, 100.0);
            for &(i, v) in params {
                fx.set_param(i, v);
            }
            fx.reset();
            let n = 9600;
            let mut buf = vec![0.0f32; 6 * n];
            buf[input * n + 10] = 1.0;
            fx.process(&mut buf, 6, n);
            (0..6).map(|c| rms(&buf[c * n..(c + 1) * n])).collect::<Vec<f32>>()
        };
        // The centre input reverberates in all but the LFE output.
        let all = run(&[], 2);
        assert!(all[0] > 0.0 && all[1] > 0.0 && all[2] > 0.0 && all[4] > 0.0 && all[5] > 0.0, "{all:?}");
        assert_eq!(all[3], 0.0);
        // The LFE reaches the room only with its send.
        assert_eq!(run(&[], 3)[0], 0.0);
        assert!(run(&[(12, 100.0)], 3)[0] > 0.0);
        // Front/back balance fully back silences the front, fully front the rear.
        let back = run(&[(14, 100.0)], 2);
        assert!(back[0] == 0.0 && back[4] > 0.0, "{back:?}");
        let front = run(&[(14, -100.0)], 2);
        assert!(front[4] == 0.0 && front[0] > 0.0, "{front:?}");
        // Surround width widens only the rear pair.
        let narrow = run(&[(13, 0.0)], 0);
        let wide = run(&[(13, 300.0)], 0);
        // (A left input reaches the rear crossed, on Rs only, so width spreads it to Ls.)
        assert!((narrow[0] - wide[0]).abs() < 1e-6);
        assert!(wide[4] > narrow[4] * 1.2, "{} {}", wide[4], narrow[4]);
    }

    #[test]
    fn stereo_folds_the_rear_in_only_as_the_balance_moves_back() {
        let rate = 48000.0;
        let ir: Vec<f32> = noise(2400, 0.5, 5);
        let run = |fb: f32| {
            let mut fx = make(83, rate, 2);
            load(fx.as_mut(), &[ir.clone()]);
            fx.set_param(1, 100.0);
            fx.set_param(14, fb);
            fx.reset();
            let mut x = vec![0.0f32; 4800];
            x[0] = 1.0;
            run_stereo(fx.as_mut(), &x, &x).0
        };
        let (a, b, c) = (run(0.0), run(-100.0), run(100.0));
        assert_eq!(a, b);
        // Fully back: the crossed rear arrives REAR_MS later.
        let first = |y: &[f32]| y.iter().position(|v| v.abs() > 1e-6).unwrap_or(0);
        assert!(first(&c) >= first(&a) + 600, "{} {}", first(&c), first(&a));
    }
}

#[cfg(test)]
mod debug_tests {
    use crate::fft::RealFft;

    #[test]
    fn realfft_product_is_circular_convolution() {
        let n = 16;
        let a: Vec<f32> = (0..n).map(|i| ((i * 7) % 5) as f32 - 2.0).collect();
        let b: Vec<f32> = (0..n).map(|i| if i < 3 { (i + 1) as f32 } else { 0.0 }).collect();
        let mut f = RealFft::new(n);
        let (mut ar, mut ai, mut br, mut bi) = (vec![0.0; 9], vec![0.0; 9], vec![0.0; 9], vec![0.0; 9]);
        f.forward(&a, &mut ar, &mut ai);
        f.forward(&b, &mut br, &mut bi);
        let pr: Vec<f32> = (0..9).map(|k| ar[k] * br[k] - ai[k] * bi[k]).collect();
        let pi: Vec<f32> = (0..9).map(|k| ar[k] * bi[k] + ai[k] * br[k]).collect();
        let mut y = vec![0.0; n];
        f.inverse(&pr, &pi, &mut y);
        for i in 0..n {
            let mut s = 0.0;
            for k in 0..n {
                s += a[k] * b[(i + n - k) % n];
            }
            assert!((y[i] - s).abs() < 1e-3, "{i}: {} vs {s}", y[i]);
        }
    }
}
