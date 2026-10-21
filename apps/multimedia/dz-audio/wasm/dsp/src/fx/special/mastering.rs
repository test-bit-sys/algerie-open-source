//! Mastering: a one-window finishing chain.
//!   EQ (low shelf, peak, high shelf) -> exciter (2x oversampled saturation of
//!   the highs, added back) -> reverb (compact four-line feedback delay
//!   network) -> stereo widener (mid/side) -> loudness maximizer (input boost
//!   into a brickwall lookahead limiter) -> output gain.
//!
//! Params: 0 low shelf on, 1 low shelf Hz, 2 low shelf dB, 3 peak on,
//! 4 peak Hz, 5 peak dB, 6 peak Q, 7 high shelf on, 8 high shelf Hz,
//! 9 high shelf dB, 10 reverb %, 11 exciter mode (0 retro, 1 tape, 2 tube),
//! 12 exciter %, 13 width (-100 narrow .. 100 wide), 14 loudness %,
//! 15 output dB, 16 low shelf Q, 17 high shelf Q.
//! Latency: exciter oversampler + limiter lookahead (see `latency_frames`).
//! Tail: 2 s while the reverb is in use.

use super::shaper::{Oversampler, Shape, Shaper, DIODE, SOFT, TUBE};
use crate::fx::util::{db_to_gain, Biquad, Coefs, DelayLine, Limiter};
use crate::fx::{Effect, Smooth};

const SUB: usize = 32;
const OS: usize = 2;

/// Lookahead of the maximizer in frames: 5 ms, rounded.
pub fn lookahead_frames(rate: f32) -> usize {
    ((rate as f64) / 200.0).round().max(1.0) as usize
}

pub fn latency_frames(rate: f32) -> usize {
    Oversampler::latency(OS) + lookahead_frames(rate) - 1
}

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    LowShelf,
    Peak,
    HighShelf,
}

/// An EQ band whose frequency and gain glide (coefficients refreshed per
/// sub-block). Switching a band off glides its gain to 0 dB.
struct Band {
    kind: Kind,
    on: bool,
    gain_db: f32,
    q: f32,
    freq: Smooth,
    gain: Smooth,
    dirty: bool,
    filters: [Biquad; 2],
}

impl Band {
    fn new(kind: Kind, rate: f32, f: f32, q: f32) -> Band {
        let r = rate / SUB as f32;
        Band { kind, on: true, gain_db: 0.0, q, freq: Smooth::new(f.ln(), r, 30.0), gain: Smooth::new(0.0, r, 30.0), dirty: true, filters: [Biquad::default(); 2] }
    }
    fn retarget(&mut self) {
        self.gain.target = if self.on { self.gain_db } else { 0.0 };
        self.dirty = true;
    }
    fn update(&mut self, rate: f32) {
        if !self.dirty && self.freq.settled() && self.gain.settled() {
            return;
        }
        let settled = self.freq.settled() && self.gain.settled();
        let f = self.freq.next().exp();
        let g = self.gain.next();
        let c = match self.kind {
            Kind::LowShelf => Coefs::low_shelf(rate, f, self.q, g),
            Kind::Peak => Coefs::peaking(rate, f, self.q, g),
            Kind::HighShelf => Coefs::high_shelf(rate, f, self.q, g),
        };
        for b in &mut self.filters {
            b.c = c;
        }
        self.dirty = !settled;
    }
    fn settle(&mut self) {
        self.freq.settle();
        self.gain.settle();
        self.dirty = true;
    }
}

/// Four-line feedback delay network with Hadamard mixing, input diffusion,
/// pre-delay and damping.
struct Fdn {
    pre: DelayLine,
    pre_len: usize,
    diff: [DelayLine; 2],
    diff_len: [usize; 2],
    lines: [DelayLine; 4],
    lens: [usize; 4],
    fb: [f32; 4],
    damp: [f32; 4],
}

impl Fdn {
    fn new(rate: f32) -> Fdn {
        let ms = |m: f32| ((m * 0.001 * rate).round() as usize).max(1);
        let lens = [ms(31.7), ms(37.3), ms(41.9), ms(47.3)];
        let rt60 = 1.8;
        let mut fb = [0.0; 4];
        for i in 0..4 {
            fb[i] = 10f32.powf(-3.0 * lens[i] as f32 / (rt60 * rate));
        }
        Fdn {
            pre: DelayLine::new(ms(12.0) + 1),
            pre_len: ms(12.0),
            diff: [DelayLine::new(ms(4.7) + 1), DelayLine::new(ms(1.7) + 1)],
            diff_len: [ms(4.7), ms(1.7)],
            lines: [DelayLine::new(lens[0] + 1), DelayLine::new(lens[1] + 1), DelayLine::new(lens[2] + 1), DelayLine::new(lens[3] + 1)],
            lens,
            fb,
            damp: [0.0; 4],
        }
    }

    #[inline]
    fn process(&mut self, x: f32) -> (f32, f32) {
        self.pre.push(x);
        let mut v = self.pre.tap(self.pre_len);
        // Schroeder all-pass diffusers.
        for k in 0..2 {
            let d = self.diff[k].tap(self.diff_len[k] - 1);
            let w = v + 0.6 * d;
            self.diff[k].push(w);
            v = d - 0.6 * w;
        }
        let mut o = [0.0f32; 4];
        for i in 0..4 {
            // Push happens after the read, so the effective delay is lens[i].
            let y = self.lines[i].tap(self.lens[i] - 1);
            self.damp[i] = y + (self.damp[i] - y) * 0.35;
            o[i] = self.damp[i];
        }
        let h = [
            0.5 * (o[0] + o[1] + o[2] + o[3]),
            0.5 * (o[0] - o[1] + o[2] - o[3]),
            0.5 * (o[0] + o[1] - o[2] - o[3]),
            0.5 * (o[0] - o[1] - o[2] + o[3]),
        ];
        let signs = [1.0, -1.0, 1.0, -1.0];
        for i in 0..4 {
            self.lines[i].push(h[i] * self.fb[i] + v * signs[i] * 0.5);
        }
        (o[0] + 0.6 * o[2], o[1] + 0.6 * o[3])
    }

    fn flush(&mut self) {
        for d in &mut self.damp {
            if d.abs() < 1e-20 {
                *d = 0.0;
            }
        }
    }

    fn reset(&mut self) {
        self.pre.clear();
        for d in &mut self.diff {
            d.clear();
        }
        for l in &mut self.lines {
            l.clear();
        }
        self.damp = [0.0; 4];
    }
}

pub struct Mastering {
    rate: f32,
    channels: usize,
    bands: [Band; 3],
    // Exciter
    ex_mode: usize,
    ex_hp_in: [Biquad; 2],
    ex_hp_out: [Biquad; 2],
    ex_shapers: Vec<Shaper>,
    ex_shape: Shape,
    ex_amt: Smooth,
    main_delay: Vec<DelayLine>,
    // Reverb
    reverb: Fdn,
    rev_on: bool,
    /// The reverb ran on the previous frame; its state is cleared once it
    /// goes idle so re-enabling it does not replay an old tail.
    rev_live: bool,
    rev_amt: Smooth,
    // Widener and maximizer
    width: Smooth,
    boost: Smooth,
    limiter: Limiter,
    out: Smooth,
}

impl Mastering {
    pub fn new(rate: f32, channels: usize) -> Mastering {
        let mut m = Mastering {
            rate,
            channels,
            bands: [Band::new(Kind::LowShelf, rate, 100.0, 0.707), Band::new(Kind::Peak, rate, 1000.0, 1.0), Band::new(Kind::HighShelf, rate, 8000.0, 0.707)],
            ex_mode: 0,
            ex_hp_in: [Biquad::default(); 2],
            ex_hp_out: [Biquad::default(); 2],
            ex_shapers: (0..channels).map(|_| Shaper::new(OS)).collect(),
            ex_shape: Shape::default(),
            ex_amt: Smooth::new(0.0, rate, 20.0),
            main_delay: (0..channels).map(|_| DelayLine::new(Oversampler::latency(OS) + 1)).collect(),
            reverb: Fdn::new(rate),
            rev_on: false,
            rev_live: false,
            rev_amt: Smooth::new(0.0, rate, 20.0),
            width: Smooth::new(1.0, rate, 20.0),
            boost: Smooth::new(1.0, rate, 20.0),
            limiter: Limiter::new(rate, 6.0),
            out: Smooth::new(1.0, rate, 20.0),
        };
        m.update_exciter();
        m.update_limiter(0.0);
        m
    }

    fn update_exciter(&mut self) {
        let (f, pos, neg) = match self.ex_mode {
            1 => (2000.0, SOFT, SOFT),
            2 => (1500.0, TUBE, SOFT),
            _ => (3000.0, DIODE, DIODE),
        };
        let c = Coefs::highpass(self.rate, f, 0.707);
        for i in 0..2 {
            self.ex_hp_in[i].c = c;
            self.ex_hp_out[i].c = c;
        }
        self.ex_shape.pos = pos;
        self.ex_shape.neg = neg;
    }

    fn update_limiter(&mut self, loudness_pct: f32) {
        let look = lookahead_frames(self.rate);
        let ms = look as f32 * 1000.0 / self.rate;
        let ceiling = if loudness_pct > 0.0 { db_to_gain(-0.3) } else { 1.0 };
        self.limiter.set(self.rate, ms, 120.0, ceiling);
        self.boost.target = db_to_gain(0.12 * loudness_pct.clamp(0.0, 100.0));
    }
}

impl Effect for Mastering {
    fn set_param(&mut self, idx: u32, v: f32) {
        let b = &mut self.bands;
        match idx {
            0 => b[0].on = v >= 0.5,
            1 => b[0].freq.target = v.clamp(10.0, self.rate * 0.45).ln(),
            2 => b[0].gain_db = v,
            3 => b[1].on = v >= 0.5,
            4 => b[1].freq.target = v.clamp(10.0, self.rate * 0.45).ln(),
            5 => b[1].gain_db = v,
            6 => b[1].q = v.clamp(0.05, 30.0),
            7 => b[2].on = v >= 0.5,
            8 => b[2].freq.target = v.clamp(10.0, self.rate * 0.45).ln(),
            9 => b[2].gain_db = v,
            10 => {
                self.rev_amt.target = (v / 100.0).clamp(0.0, 1.0) * 0.5;
                self.rev_on = v > 0.0;
            }
            11 => {
                self.ex_mode = (v as usize).min(2);
                self.update_exciter();
            }
            12 => self.ex_amt.target = (v / 100.0).clamp(0.0, 1.0),
            13 => self.width.target = 1.0 + (v / 100.0).clamp(-1.0, 1.0),
            14 => self.update_limiter(v),
            15 => self.out.target = db_to_gain(v),
            16 => b[0].q = v.clamp(0.1, 10.0),
            17 => b[2].q = v.clamp(0.1, 10.0),
            _ => {}
        }
        for band in &mut self.bands {
            band.retarget();
        }
    }

    fn process(&mut self, buf: &mut [f32], channels: usize, frames: usize) {
        let channels = channels.min(self.channels);
        let os_lat = Oversampler::latency(OS);
        let mut ex = [0.0f32; SUB];
        let mut st = [[0.0f32; SUB]; 2];
        let mut tmp = [0.0f32; SUB];
        let mut at = 0;
        while at < frames {
            let n = SUB.min(frames - at);
            for band in &mut self.bands {
                band.update(self.rate);
            }
            // The exciter is skipped while it is fully off.
            let excite = self.ex_amt.target > 0.0 || !self.ex_amt.settled();
            for e in ex.iter_mut().take(n) {
                *e = self.ex_amt.next() * 0.35;
            }
            for c in 0..channels {
                let io = &buf[c * frames + at..c * frames + at + n];
                for k in 0..n {
                    let mut x = io[k];
                    for band in &mut self.bands {
                        x = band.filters[c].process(x);
                    }
                    st[c][k] = x;
                }
                if excite {
                    // Saturate the highs (2x oversampled) and add them back.
                    for k in 0..n {
                        tmp[k] = self.ex_hp_in[c].process(st[c][k]) * 6.0;
                    }
                    self.ex_shapers[c].process(&mut tmp[..n], &self.ex_shape);
                }
                for k in 0..n {
                    self.main_delay[c].push(st[c][k]);
                    let added = if excite { self.ex_hp_out[c].process(tmp[k]) * ex[k] } else { 0.0 };
                    st[c][k] = self.main_delay[c].tap(os_lat) + added;
                }
            }
            for k in 0..n {
                let i = at + k;
                let rev_amt = self.rev_amt.next();
                let width = self.width.next();
                let boost = self.boost.next();
                let out = self.out.next();
                let mut s = [st[0][k], if channels == 2 { st[1][k] } else { st[0][k] }];
                if self.rev_on || rev_amt > 1e-6 {
                    let (wl, wr) = self.reverb.process(0.5 * (s[0] + s[1]));
                    s[0] += wl * rev_amt;
                    s[1] += wr * rev_amt;
                    self.rev_live = true;
                } else if self.rev_live {
                    self.reverb.reset();
                    self.rev_live = false;
                }
                if channels == 2 {
                    let m = 0.5 * (s[0] + s[1]);
                    let d = 0.5 * (s[0] - s[1]) * width;
                    s[0] = m + d;
                    s[1] = m - d;
                } else {
                    s[0] = 0.5 * (s[0] + s[1]);
                    s[1] = s[0];
                }
                let (l, r) = self.limiter.process(s[0] * boost, s[1] * boost);
                buf[i] = l * out;
                if channels == 2 {
                    buf[frames + i] = r * out;
                }
            }
            at += n;
        }
        for band in &mut self.bands {
            for b in &mut band.filters {
                b.flush();
            }
        }
        for c in 0..2 {
            self.ex_hp_in[c].flush();
            self.ex_hp_out[c].flush();
        }
        self.reverb.flush();
    }

    fn reset(&mut self) {
        for band in &mut self.bands {
            band.settle();
            for b in &mut band.filters {
                b.reset();
            }
        }
        for c in 0..2 {
            self.ex_hp_in[c].reset();
            self.ex_hp_out[c].reset();
        }
        for s in &mut self.ex_shapers {
            s.reset();
        }
        for d in &mut self.main_delay {
            d.clear();
        }
        self.reverb.reset();
        self.limiter.reset();
        self.ex_amt.settle();
        self.rev_amt.settle();
        self.width.settle();
        self.boost.settle();
        self.out.settle();
    }

    fn latency(&self) -> u32 {
        latency_frames(self.rate) as u32
    }

    fn tail(&self) -> u32 {
        if self.rev_on {
            (self.rate * 2.0).round() as u32
        } else {
            0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fx::testutil::*;
    use crate::fx::util::gain_to_db;

    #[test]
    fn neutral_settings_are_transparent_after_latency() {
        let rate = 48000.0;
        let mut fx = make(93, rate, 2);
        fx.reset();
        let x = sine(700.0, rate, 9600, 0.5);
        let (y, _) = run_stereo(fx.as_mut(), &x, &x);
        let lat = fx.latency() as usize;
        assert_eq!(lat, latency_frames(rate));
        for i in 2000..9600 {
            assert!((y[i] - x[i - lat]).abs() < 3e-3, "{i}: {} vs {}", y[i], x[i - lat]);
        }
    }

    #[test]
    fn eq_bands_apply_gain() {
        let rate = 48000.0;
        let lo = sine_gain_db(93, &[(2, 6.0)], 40.0, rate);
        assert!((lo - 6.0).abs() < 0.5, "{lo}");
        let pk = sine_gain_db(93, &[(4, 2000.0), (5, -8.0)], 2000.0, rate);
        assert!((pk + 8.0).abs() < 0.5, "{pk}");
        // A band switched off has no effect.
        let off = sine_gain_db(93, &[(3, 0.0), (4, 2000.0), (5, -8.0)], 2000.0, rate);
        assert!(off.abs() < 0.3, "{off}");
    }

    #[test]
    fn maximizer_raises_loudness_under_the_ceiling() {
        let rate = 48000.0;
        let mut fx = make(93, rate, 2);
        fx.set_param(14, 100.0);
        fx.reset();
        let x = noise(48000, 0.5, 7);
        let (y, z) = run_stereo(fx.as_mut(), &x, &x);
        let p = peak(&y).max(peak(&z));
        assert!(p <= db_to_gain(-0.3) + 1e-5, "peak {p}");
        assert!(gain_to_db(rms(&y[4800..]) / rms(&x[4800..])) > 3.0);
    }

    #[test]
    fn widener_and_reverb() {
        let rate = 48000.0;
        // Width -100 collapses to mono.
        let mut fx = make(93, rate, 2);
        fx.set_param(13, -100.0);
        fx.reset();
        let l = sine(500.0, rate, 9600, 0.3);
        let r = noise(9600, 0.3, 3);
        let (a, b) = run_stereo(fx.as_mut(), &l, &r);
        for i in 0..9600 {
            assert!((a[i] - b[i]).abs() < 1e-6);
        }
        // Reverb rings on after the input stops and reports a tail.
        let mut fx = make(93, rate, 2);
        fx.set_param(10, 80.0);
        fx.reset();
        assert_eq!(fx.tail(), 96000);
        let mut x = noise(4800, 0.5, 5);
        x.extend(std::iter::repeat(0.0).take(24000));
        let (y, _) = run_stereo(fx.as_mut(), &x, &x);
        let lat = fx.latency() as usize;
        assert!(rms(&y[4800 + lat + 4800..4800 + lat + 9600]) > 1e-3);
    }

    #[test]
    fn exciter_adds_high_harmonics() {
        let rate = 48000.0;
        let x = sine(2500.0, rate, 24000, 0.5);
        let run = |amt: f32| {
            let mut fx = make(93, rate, 1);
            fx.set_param(12, amt);
            fx.reset();
            let y = run_mono(fx.as_mut(), &x);
            // Energy that is not the fundamental: subtract the delayed input.
            let lat = fx.latency() as usize;
            let resid: Vec<f32> = (12000..24000).map(|i| y[i] - x[i - lat]).collect();
            rms(&resid)
        };
        assert!(run(100.0) > 10.0 * run(0.0).max(1e-5));
    }
}
