//! Guitar Suite: compressor, oversampled distortion, amplifier and cabinet
//! voicing, a resonant filter, dry/wet mix and output gain.
//!
//! Params: 0 compressor %, 1 distortion type, 2 distortion amount %,
//! 3 amp model, 4 amp amount %, 5 filter type (0 off, 1 low pass,
//! 2 high pass, 3 band pass), 6 filter Hz, 7 resonance %, 8 mix %,
//! 9 output dB, 10..13 bypass compressor, distortion, amplifier, filter
//! (0/1; a bypassed module passes audio unchanged, keeping its settings).
//! Latency: the distortion oversampler's (dry path aligned).

use super::distortion::{PostFilter, FACTOR};
use super::shaper::{Oversampler, Shape, Shaper, DIODE, FOLD, HARD, LINEAR, SOFT, TUBE};
use crate::fx::util::{compress_db, db_to_gain, gain_to_db, Biquad, Coefs, DelayLine, Envelope};
use crate::fx::{Effect, Smooth};

struct DistType {
    pos: u32,
    neg: u32,
    max_db: f32,
    pre_hp: f32,
    post_lp: f32,
}

const DIST: [DistType; 6] = [
    DistType { pos: SOFT, neg: SOFT, max_db: 14.0, pre_hp: 40.0, post_lp: 14000.0 }, // Clean boost
    DistType { pos: TUBE, neg: SOFT, max_db: 32.0, pre_hp: 280.0, post_lp: 6500.0 }, // Overdrive
    DistType { pos: DIODE, neg: DIODE, max_db: 38.0, pre_hp: 180.0, post_lp: 6000.0 }, // Crunch
    DistType { pos: HARD, neg: HARD, max_db: 46.0, pre_hp: 90.0, post_lp: 4500.0 }, // Fuzz
    DistType { pos: HARD, neg: DIODE, max_db: 52.0, pre_hp: 450.0, post_lp: 5500.0 }, // High gain
    DistType { pos: FOLD, neg: FOLD, max_db: 30.0, pre_hp: 150.0, post_lp: 7000.0 }, // Folded
];

/// Amp and cabinet voicings: high pass, three peaks (f, gain dB, Q), and a
/// resonant cabinet low pass (f, Q).
struct Amp {
    hp: f32,
    peaks: [(f32, f32, f32); 3],
    lp: (f32, f32),
}

const AMPS: [Amp; 6] = [
    Amp { hp: 70.0, peaks: [(120.0, 2.0, 1.0), (800.0, -2.0, 0.8), (3000.0, 3.0, 1.2)], lp: (5500.0, 0.9) }, // Clean combo 1x12
    Amp { hp: 80.0, peaks: [(100.0, 4.0, 1.4), (700.0, 2.0, 0.9), (2500.0, 3.0, 1.5)], lp: (4800.0, 1.1) }, // Vintage stack 4x12
    Amp { hp: 90.0, peaks: [(110.0, 5.0, 1.2), (650.0, -5.0, 0.8), (3200.0, 4.0, 1.3)], lp: (5200.0, 1.0) }, // Modern stack 4x12
    Amp { hp: 40.0, peaks: [(70.0, 4.0, 1.0), (400.0, -3.0, 1.0), (1500.0, 2.0, 1.2)], lp: (3500.0, 0.8) }, // Bass cabinet 1x15
    Amp { hp: 180.0, peaks: [(400.0, 2.0, 0.8), (1200.0, 4.0, 1.0), (2500.0, 3.0, 2.0)], lp: (4000.0, 1.3) }, // Practice amp 1x8
    Amp { hp: 400.0, peaks: [(1000.0, 4.0, 1.0), (1800.0, 0.0, 1.0), (2500.0, 2.0, 1.0)], lp: (3200.0, 0.9) }, // Telephone box
];

pub struct GuitarSuite {
    rate: f32,
    channels: usize,
    // Compressor
    comp_pct: f32,
    thr: f32,
    ratio: f32,
    makeup: f32,
    env: Envelope,
    comp_target: f32,
    comp_gain: f32,
    comp_glide: f32,
    // Distortion
    dist_type: usize,
    dist_amt: f32,
    shape: Shape,
    drive: Smooth,
    pre: [Biquad; 2],
    post: [Biquad; 2],
    shapers: Vec<Shaper>,
    dc: [Biquad; 2],
    // Amp
    amp: usize,
    amp_mix: Smooth,
    cab: [[Biquad; 5]; 2],
    // Filter, mix, output
    filter: PostFilter,
    filter_kind: u32,
    res: f32,
    bypass: [bool; 4],
    mix: Smooth,
    out: Smooth,
    dry: Vec<DelayLine>,
}

impl GuitarSuite {
    pub fn new(rate: f32, channels: usize) -> GuitarSuite {
        let mut g = GuitarSuite {
            rate,
            channels,
            comp_pct: 20.0,
            thr: 0.0,
            ratio: 1.0,
            makeup: 1.0,
            env: Envelope::new(rate, 5.0, 150.0),
            comp_target: 1.0,
            comp_gain: 1.0,
            comp_glide: 1.0 - (-1.0 / (rate * 0.0005)).exp(),
            dist_type: 1,
            dist_amt: 0.4,
            shape: Shape::default(),
            drive: Smooth::new(1.0, rate, 20.0),
            pre: [Biquad::default(); 2],
            post: [Biquad::default(); 2],
            shapers: (0..channels).map(|_| Shaper::new(FACTOR)).collect(),
            dc: [Biquad::new(Coefs::highpass1(rate, 8.0)); 2],
            amp: 1,
            amp_mix: Smooth::new(1.0, rate, 20.0),
            cab: [[Biquad::default(); 5]; 2],
            filter: PostFilter::new(rate, 1500.0),
            filter_kind: 0,
            res: 20.0,
            bypass: [false; 4],
            mix: Smooth::new(1.0, rate, 20.0),
            out: Smooth::new(1.0, rate, 20.0),
            dry: (0..channels).map(|_| DelayLine::new(Oversampler::latency(FACTOR) + 1)).collect(),
        };
        g.update_comp();
        g.update_dist();
        g.update_amp();
        g.update_filter_q();
        g.drive.settle();
        g
    }

    fn update_comp(&mut self) {
        let a = self.comp_pct.clamp(0.0, 100.0);
        self.thr = -4.0 - 0.26 * a;
        self.ratio = 1.0 + 0.07 * a;
        // Make up most of the reduction a -6 dBFS signal would get.
        self.makeup = db_to_gain(-0.7 * compress_db(-6.0, self.thr, self.ratio, 6.0));
    }

    fn update_dist(&mut self) {
        let t = &DIST[self.dist_type.min(DIST.len() - 1)];
        let off = self.bypass[1];
        self.shape.pos = if off { LINEAR } else { t.pos };
        self.shape.neg = if off { LINEAR } else { t.neg };
        self.drive.target = if off { 1.0 } else { db_to_gain(self.dist_amt * t.max_db) };
        let pre = if off { Coefs::IDENTITY } else { Coefs::highpass1(self.rate, t.pre_hp) };
        let post = if off { Coefs::IDENTITY } else { Coefs::lowpass(self.rate, t.post_lp, 0.707) };
        for c in 0..2 {
            self.pre[c].c = pre;
            self.post[c].c = post;
        }
    }

    fn update_amp(&mut self) {
        for ch in &mut self.cab {
            for (i, b) in ch.iter_mut().enumerate() {
                b.c = if self.amp == 0 || self.bypass[2] {
                    Coefs::IDENTITY
                } else {
                    let a = &AMPS[(self.amp - 1).min(AMPS.len() - 1)];
                    match i {
                        0 => Coefs::highpass(self.rate, a.hp, 0.707),
                        1..=3 => {
                            let (f, g, q) = a.peaks[i - 1];
                            Coefs::peaking(self.rate, f, q, g)
                        }
                        _ => Coefs::lowpass(self.rate, a.lp.0, a.lp.1),
                    }
                };
            }
        }
    }

    fn update_filter(&mut self) {
        self.filter.on = self.filter_kind > 0 && !self.bypass[3];
        self.filter.kind = self.filter_kind.saturating_sub(1);
        self.filter.touch();
    }

    fn update_filter_q(&mut self) {
        self.filter.q = 0.5 + 0.15 * self.res.clamp(0.0, 100.0);
        self.filter.touch();
    }
}

impl Effect for GuitarSuite {
    fn set_param(&mut self, idx: u32, v: f32) {
        match idx {
            0 => {
                self.comp_pct = v;
                self.update_comp();
            }
            1 => {
                self.dist_type = v as usize;
                self.update_dist();
            }
            2 => {
                self.dist_amt = (v / 100.0).clamp(0.0, 1.0);
                self.update_dist();
            }
            3 => {
                self.amp = v as usize;
                self.update_amp();
            }
            4 => self.amp_mix.target = (v / 100.0).clamp(0.0, 1.0),
            5 => {
                self.filter_kind = v as u32;
                self.update_filter();
            }
            6 => self.filter.set_freq(v),
            7 => {
                self.res = v;
                self.update_filter_q();
            }
            8 => self.mix.target = (v / 100.0).clamp(0.0, 1.0),
            9 => self.out.target = db_to_gain(v),
            10..=13 => {
                self.bypass[(idx - 10) as usize] = v >= 0.5;
                match idx {
                    11 => self.update_dist(),
                    12 => self.update_amp(),
                    13 => self.update_filter(),
                    _ => {}
                }
            }
            _ => {}
        }
    }

    fn process(&mut self, buf: &mut [f32], channels: usize, frames: usize) {
        const SUB: usize = 32;
        let channels = channels.min(self.channels);
        let lat = Oversampler::latency(FACTOR);
        let comp_on = self.comp_pct > 0.0 && !self.bypass[0];
        let (mut gain, mut drives, mut amp) = ([0.0f32; SUB], [0.0f32; SUB], [0.0f32; SUB]);
        let (mut mix, mut out, mut tmp) = ([0.0f32; SUB], [0.0f32; SUB], [0.0f32; SUB]);
        let mut at = 0;
        while at < frames {
            let n = SUB.min(frames - at);
            self.filter.update();
            for k in 0..n {
                let i = at + k;
                drives[k] = self.drive.next();
                amp[k] = self.amp_mix.next();
                mix[k] = self.mix.next();
                out[k] = self.out.next();
                let mut cg = 1.0;
                if comp_on {
                    let mut p = 0.0f32;
                    for c in 0..channels {
                        p = p.max(buf[c * frames + i].abs());
                    }
                    let e = self.env.next(p);
                    // The gain curve is evaluated every 8 frames and glided
                    // between (saves the log and power per frame).
                    if i % 8 == 0 {
                        self.comp_target = db_to_gain(compress_db(gain_to_db(e), self.thr, self.ratio, 6.0)) * self.makeup;
                    }
                    self.comp_gain += (self.comp_target - self.comp_gain) * self.comp_glide;
                    cg = self.comp_gain;
                }
                gain[k] = cg;
            }
            for c in 0..channels {
                let io = &mut buf[c * frames + at..c * frames + at + n];
                for k in 0..n {
                    tmp[k] = self.pre[c].process(io[k] * gain[k]) * drives[k];
                }
                self.shapers[c].process(&mut tmp[..n], &self.shape);
                for k in 0..n {
                    self.dry[c].push(io[k]);
                    let dry = self.dry[c].tap(lat);
                    let y = self.post[c].process(self.dc[c].process(tmp[k]));
                    let mut cab = y;
                    for b in &mut self.cab[c] {
                        cab = b.process(cab);
                    }
                    let y = self.filter.process(c, y + (cab - y) * amp[k]);
                    io[k] = (dry + (y - dry) * mix[k]) * out[k];
                }
            }
            at += n;
        }
        for c in 0..2 {
            self.pre[c].flush();
            self.post[c].flush();
            self.dc[c].flush();
            for b in &mut self.cab[c] {
                b.flush();
            }
        }
        self.filter.flush();
    }

    fn reset(&mut self) {
        self.env.reset();
        self.comp_gain = 1.0;
        self.comp_target = 1.0;
        for s in &mut self.shapers {
            s.reset();
        }
        for d in &mut self.dry {
            d.clear();
        }
        for c in 0..2 {
            self.pre[c].reset();
            self.post[c].reset();
            self.dc[c].reset();
            for b in &mut self.cab[c] {
                b.reset();
            }
        }
        self.filter.reset();
        self.drive.settle();
        self.amp_mix.settle();
        self.mix.settle();
        self.out.settle();
    }

    fn latency(&self) -> u32 {
        Oversampler::latency(FACTOR) as u32
    }
}

#[cfg(test)]
mod tests {
    use crate::fx::testutil::*;

    #[test]
    fn distorts_and_stays_bounded() {
        let rate = 48000.0;
        let mut fx = make(91, rate, 2);
        fx.set_param(1, 3.0); // fuzz
        fx.set_param(2, 100.0);
        fx.reset();
        let x = sine(110.0, rate, 48000, 0.3);
        let (y, _) = run_stereo(fx.as_mut(), &x, &x);
        let p = peak(&y[4800..]);
        assert!(p < 4.0 && p > 0.1, "peak {p}");
        // Heavy fuzz squares the wave: RMS close to peak (crest factor low)
        // compared to a sine's 0.707.
        assert!(rms(&y[4800..]) / p > 0.3);
    }

    #[test]
    fn cabinet_rolls_off_highs() {
        let rate = 48000.0;
        let clean = [(0u32, 0.0f32), (1, 0.0), (2, 0.0), (3, 2.0), (4, 100.0)];
        let lo = sine_gain_db(91, &clean, 500.0, rate);
        let hi = sine_gain_db(91, &clean, 12000.0, rate);
        assert!(hi < lo - 20.0, "lo {lo} hi {hi}");
    }

    #[test]
    fn dry_mix_passes_input() {
        let rate = 48000.0;
        let db = sine_gain_db(91, &[(2, 100.0), (8, 0.0)], 1000.0, rate);
        assert!(db.abs() < 0.1, "{db}");
    }

    #[test]
    fn bypassed_modules_pass_audio() {
        let rate = 48000.0;
        // Fuzz at full drive into a cabinet, all bypassed: the sine comes through untouched.
        let all = [(0u32, 100.0f32), (1, 3.0), (2, 100.0), (3, 2.0), (5, 1.0), (6, 300.0), (10, 1.0), (11, 1.0), (12, 1.0), (13, 1.0)];
        for f in [200.0, 1000.0, 8000.0] {
            let db = sine_gain_db(91, &all, f, rate);
            assert!(db.abs() < 0.3, "{f} Hz: {db}");
        }
        // Only the distortion bypassed: the cabinet still rolls off the highs.
        let some = [(1u32, 3.0f32), (2, 100.0), (3, 2.0), (11, 1.0)];
        assert!(sine_gain_db(91, &some, 12000.0, rate) < sine_gain_db(91, &some, 500.0, rate) - 20.0);
    }

    #[test]
    fn compressor_reduces_dynamic_range() {
        let rate = 48000.0;
        let neutral = [(1u32, 0.0f32), (2, 0.0), (3, 0.0)];
        let run = |amp: f32, comp: f32| {
            let mut fx = make(91, rate, 1);
            for &(i, v) in &neutral {
                fx.set_param(i, v);
            }
            fx.set_param(0, comp);
            fx.reset();
            let x = sine(300.0, rate, 24000, amp);
            let y = run_mono(fx.as_mut(), &x);
            rms(&y[12000..])
        };
        let spread_off = run(0.5, 0.0) / run(0.05, 0.0);
        let spread_on = run(0.5, 100.0) / run(0.05, 100.0);
        assert!(spread_on < spread_off * 0.5, "off {spread_off} on {spread_on}");
    }
}
