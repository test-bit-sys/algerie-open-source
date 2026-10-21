//! Pitch Shifter: realtime phase-vocoder pitch shift with phase locking, or
//! (manual splicing settings) a time-domain splicing shifter.
//! Params: 0 semitones (-24..24), 1 cents (-100..100), 2 precision (0 low,
//! 1 medium, 2 high: FFT 1024/2048/4096 at 48 kHz), 3 preserve formants (0/1),
//! 4 automatic settings (1: phase vocoder; 0: splicing), 5 splicing
//! frequency Hz (10..200), 6 overlap % (1..50).
//! Latency is one FFT frame, or for splicing half a splice plus two frames.

use super::core::{fft_size, PeakShifter};
use crate::fx::util::{DelayLine, Stft};
use crate::fx::Effect;

pub const BASE: usize = 1024;

/// STFT pitch-shifting engine shared by the Pitch Shifter and the automatic
/// pitch corrector: frames go through `PeakShifter` with a per-frame ratio.
pub struct ShiftEngine {
    pub rate: f32,
    pub channels: usize,
    pub stft: Stft,
    core: PeakShifter,
    pre: Vec<Vec<f32>>,
    pim: Vec<Vec<f32>>,
    /// Ratio applied to the current frame, glided towards `target`.
    pub ratio: f32,
    pub target: f32,
    /// Per-frame glide coefficient (0 jumps).
    pub glide: f32,
    pub formants: bool,
}

impl ShiftEngine {
    pub fn new(rate: f32, channels: usize, n: usize) -> ShiftEngine {
        let bins = n / 2 + 1;
        ShiftEngine {
            rate,
            channels,
            stft: Stft::new(n, 4, channels),
            core: PeakShifter::new(n, channels, rate),
            pre: vec![vec![0.0; bins]; channels],
            pim: vec![vec![0.0; bins]; channels],
            ratio: 1.0,
            target: 1.0,
            glide: 0.0,
            formants: false,
        }
    }

    pub fn n(&self) -> usize {
        self.stft.n
    }

    pub fn reset(&mut self) {
        self.stft.reset();
        self.core.reset();
        for c in 0..self.channels {
            self.pre[c].iter_mut().for_each(|v| *v = 0.0);
            self.pim[c].iter_mut().for_each(|v| *v = 0.0);
        }
        self.ratio = self.target;
    }

    pub fn process(&mut self, buf: &mut [f32], frames: usize) {
        let ch = self.channels.min(buf.len() / frames.max(1));
        let hop = self.stft.hop as f32;
        let core = &mut self.core;
        let pre = &mut self.pre;
        let pim = &mut self.pim;
        let ratio = &mut self.ratio;
        let (target, glide, formants) = (self.target, self.glide, self.formants);
        self.stft.process(buf, frames, |re, im| {
            *ratio = target + (*ratio - target) * glide;
            if (*ratio - target).abs() < 1e-6 {
                *ratio = target;
            }
            let bypass = core.shift(re, im, pre, pim, 0, ch, *ratio, hop, hop, formants, true);
            for c in 0..ch {
                pre[c].copy_from_slice(&re[c]);
                pim[c].copy_from_slice(&im[c]);
                if !bypass {
                    re[c].copy_from_slice(&core.ore[c]);
                    im[c].copy_from_slice(&core.oim[c]);
                }
            }
        });
    }
}

/// Time-domain splicing shifter: two read heads sweep a delay line at the
/// pitch ratio, half a splice apart. Each head jumps back (or ahead) by a
/// whole splice while it is silent, and the heads hand over with a linear
/// crossfade lasting `overlap` of each splice, so their gains always sum to
/// one. At unity the first head sits still at the reported latency.
pub struct Splicer {
    lines: Vec<DelayLine>,
    len: f32,
    overlap: f32,
    phase: f32,
    pub ratio: f32,
    pub target: f32,
    glide: f32,
}

const SPLICE_MIN_DELAY: f32 = 2.0;

impl Splicer {
    pub fn new(rate: f32, channels: usize, freq: f32, overlap: f32) -> Splicer {
        let len = (rate / freq.clamp(10.0, 200.0)).max(8.0);
        Splicer {
            lines: (0..channels).map(|_| DelayLine::new(len as usize + 8)).collect(),
            len,
            overlap: overlap.clamp(0.01, 0.5),
            phase: 0.5,
            ratio: 1.0,
            target: 1.0,
            glide: (-1.0 / (rate * 0.04)).exp(),
        }
    }

    pub fn latency(&self) -> usize {
        (SPLICE_MIN_DELAY + 0.5 * self.len).round() as usize
    }

    pub fn reset(&mut self) {
        for l in &mut self.lines {
            l.clear();
        }
        self.phase = 0.5;
        self.ratio = self.target;
    }

    /// Head gain at `phase`: silent near the jump (phase 0 / 1), crossfading around 0.25 and 0.75.
    #[inline]
    fn gain(&self, phase: f32) -> f32 {
        let e = phase.min(1.0 - phase);
        ((e - 0.25) / self.overlap + 0.5).clamp(0.0, 1.0)
    }

    pub fn process(&mut self, buf: &mut [f32], frames: usize) {
        let ch = self.lines.len().min(buf.len() / frames.max(1));
        let unity = (self.target - 1.0).abs() < 1e-6 && (self.ratio - 1.0).abs() < 1e-6;
        for i in 0..frames {
            self.ratio = self.target + (self.ratio - self.target) * self.glide;
            if !unity {
                self.phase += (1.0 - self.ratio) / self.len;
                self.phase -= self.phase.floor();
            }
            let pa = self.phase;
            let pb = if pa >= 0.5 { pa - 0.5 } else { pa + 0.5 };
            let (ga, gb) = (self.gain(pa), self.gain(pb));
            let (da, db) = (SPLICE_MIN_DELAY + pa * self.len, SPLICE_MIN_DELAY + pb * self.len);
            for c in 0..ch {
                let line = &mut self.lines[c];
                line.push(buf[c * frames + i]);
                let mut y = 0.0;
                if ga > 0.0 {
                    y += ga * line.tap_cubic(da);
                }
                if gb > 0.0 {
                    y += gb * line.tap_cubic(db);
                }
                buf[c * frames + i] = y;
            }
        }
    }
}

pub struct PitchShifter {
    engine: ShiftEngine,
    semis: f32,
    cents: f32,
    precision: u32,
    /// Manual splicing settings: the time-domain shifter replaces the phase vocoder.
    splicer: Option<Splicer>,
    auto: bool,
    splice_hz: f32,
    overlap: f32,
}

impl PitchShifter {
    pub fn new(rate: f32, channels: usize) -> PitchShifter {
        let mut p = PitchShifter { engine: ShiftEngine::new(rate, channels, fft_size(BASE, 1, rate)), semis: 0.0, cents: 0.0, precision: 1, splicer: None, auto: true, splice_hz: 48.0, overlap: 0.3 };
        p.update(true);
        p
    }

    fn update(&mut self, jump: bool) {
        let e = &mut self.engine;
        e.target = 2f32.powf((self.semis + self.cents / 100.0) / 12.0);
        // Glide over about 40 ms of frames.
        let hop = e.stft.hop as f32;
        e.glide = (-hop / (e.rate * 0.04)).exp();
        if jump {
            e.ratio = e.target;
        }
        let target = e.target;
        if let Some(sp) = &mut self.splicer {
            sp.target = target;
            if jump {
                sp.ratio = target;
            }
        }
    }

    fn rebuild_splicer(&mut self) {
        self.splicer = if self.auto { None } else { Some(Splicer::new(self.engine.rate, self.engine.channels, self.splice_hz, self.overlap)) };
        self.update(true);
    }
}

impl Effect for PitchShifter {
    fn set_param(&mut self, idx: u32, value: f32) {
        match idx {
            0 => self.semis = value.clamp(-24.0, 24.0),
            1 => self.cents = value.clamp(-100.0, 100.0),
            2 => {
                let p = (value.round().max(0.0) as u32).min(2);
                if p != self.precision {
                    self.precision = p;
                    let (rate, ch, f) = (self.engine.rate, self.engine.channels, self.engine.formants);
                    self.engine = ShiftEngine::new(rate, ch, fft_size(BASE, p, rate));
                    self.engine.formants = f;
                    self.update(true);
                    return;
                }
            }
            3 => self.engine.formants = value >= 0.5,
            4 | 5 | 6 => {
                let (auto, hz, ov) = (self.auto, self.splice_hz, self.overlap);
                match idx {
                    4 => self.auto = value >= 0.5,
                    5 => self.splice_hz = value.clamp(10.0, 200.0),
                    _ => self.overlap = (value / 100.0).clamp(0.01, 0.5),
                }
                if auto != self.auto || (!self.auto && (hz != self.splice_hz || ov != self.overlap)) {
                    self.rebuild_splicer();
                }
                return;
            }
            _ => {}
        }
        self.update(false);
    }

    fn process(&mut self, buf: &mut [f32], channels: usize, frames: usize) {
        let _ = channels;
        match &mut self.splicer {
            Some(sp) => sp.process(buf, frames),
            None => self.engine.process(buf, frames),
        }
    }

    fn reset(&mut self) {
        self.engine.reset();
        if let Some(sp) = &mut self.splicer {
            sp.reset();
        }
    }

    fn latency(&self) -> u32 {
        match &self.splicer {
            Some(sp) => sp.latency() as u32,
            None => self.engine.n() as u32,
        }
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::fx::testutil::{rms, run_mono, run_stereo, sine};

    /// Frequency of a steady tone by interpolated zero crossings.
    pub fn measure_freq(x: &[f32], rate: f32) -> f32 {
        let mut first = None;
        let mut last = 0.0;
        let mut count = 0;
        for i in 1..x.len() {
            if x[i - 1] < 0.0 && x[i] >= 0.0 {
                let t = (i - 1) as f32 + x[i - 1] / (x[i - 1] - x[i]);
                if first.is_none() {
                    first = Some(t);
                } else {
                    count += 1;
                }
                last = t;
            }
        }
        match first {
            Some(f) if count > 0 => count as f32 * rate / (last - f),
            _ => 0.0,
        }
    }

    fn shifted(semis: f32, cents: f32, precision: f32, f: f32) -> (Vec<f32>, usize) {
        let rate = 48000.0;
        let mut p = PitchShifter::new(rate, 1);
        p.set_param(2, precision);
        p.set_param(0, semis);
        p.set_param(1, cents);
        p.reset();
        let x = sine(f, rate, 48000, 0.5);
        (run_mono(&mut p, &x), p.latency() as usize)
    }

    #[test]
    fn octave_up_and_fifth_down() {
        for precision in [0.0, 1.0, 2.0] {
            let (y, lat) = shifted(12.0, 0.0, precision, 440.0);
            let f = measure_freq(&y[lat + 4096..], 48000.0);
            assert!((f / 880.0 - 1.0).abs() < 0.003, "precision {precision}: {f}");
            assert!((rms(&y[lat + 4096..]) / 0.3536 - 1.0).abs() < 0.2, "level {}", rms(&y[lat + 4096..]));
        }
        let (y, lat) = shifted(-7.0, 0.0, 1.0, 440.0);
        let f = measure_freq(&y[lat + 4096..], 48000.0);
        assert!((f / (440.0 * 2f32.powf(-7.0 / 12.0)) - 1.0).abs() < 0.003, "{f}");
        let (y, lat) = shifted(0.0, 50.0, 2.0, 1000.0);
        let f = measure_freq(&y[lat + 8192..], 48000.0);
        assert!((f / (1000.0 * 2f32.powf(0.5 / 12.0)) - 1.0).abs() < 0.002, "{f}");
    }

    #[test]
    fn formant_mode_keeps_a_lone_tone() {
        let rate = 48000.0;
        let mut p = PitchShifter::new(rate, 1);
        p.set_param(3, 1.0);
        p.set_param(0, 7.0);
        p.reset();
        let x = sine(300.0, rate, 48000, 0.5);
        let y = run_mono(&mut p, &x);
        let f = measure_freq(&y[8000..], rate);
        assert!((f / (300.0 * 2f32.powf(7.0 / 12.0)) - 1.0).abs() < 0.003, "{f}");
        assert!((rms(&y[8000..]) / 0.3536 - 1.0).abs() < 0.2, "level {}", rms(&y[8000..]));
    }

    #[test]
    fn formant_mode_keeps_the_spectral_envelope() {
        // A 150 Hz pulse train through a resonance at 1 kHz: shifted up a
        // fifth with formants preserved, the strongest harmonic stays near 1 kHz.
        let rate = 48000.0;
        let n = 48000;
        let mut x = vec![0.0f32; n];
        let period = (rate / 150.0) as usize;
        let mut i = 0;
        while i < n {
            x[i] = 1.0;
            i += period;
        }
        let mut res = crate::fx::util::Biquad::new(crate::fx::util::Coefs::bandpass(rate, 1000.0, 8.0));
        let x: Vec<f32> = x.iter().map(|&v| res.process(v)).collect();
        let peak_hz = |y: &[f32]| {
            let size = 8192;
            let seg = &y[y.len() - size..];
            let mut best = (0.0f32, 0.0f32);
            for f in (100..3000).step_by(5) {
                let w = crate::fx::util::TAU * f as f32 / rate;
                let (mut c, mut s) = (0.0f32, 0.0f32);
                for (k, v) in seg.iter().enumerate() {
                    c += v * (w * k as f32).cos();
                    s += v * (w * k as f32).sin();
                }
                let m = c * c + s * s;
                if m > best.1 {
                    best = (f as f32, m);
                }
            }
            best.0
        };
        let shift = |formants: f32| {
            let mut p = PitchShifter::new(rate, 1);
            p.set_param(3, formants);
            p.set_param(0, 7.0);
            p.reset();
            run_mono(&mut p, &x)
        };
        let with = peak_hz(&shift(1.0));
        let without = peak_hz(&shift(0.0));
        assert!((with - 1000.0).abs() < 160.0, "with formants {with}");
        assert!(without > 1300.0, "without formants {without}");
    }

    #[test]
    fn splicing_shifts_pitch_with_manual_settings() {
        let rate = 48000.0;
        for (semis, hz, overlap) in [(7.0f32, 48.0f32, 30.0f32), (-5.0, 30.0, 10.0), (12.0, 80.0, 50.0)] {
            let mut p = PitchShifter::new(rate, 1);
            p.set_param(4, 0.0);
            p.set_param(5, hz);
            p.set_param(6, overlap);
            p.set_param(0, semis);
            p.reset();
            assert_eq!(p.latency(), (2.0 + 0.5 * rate / hz).round() as u32);
            // A splice joins the tone in phase when its period divides half a
            // splice (480 Hz is an even multiple of every splicing frequency here);
            // other tones pick up sidebands spaced by splice / |1 - ratio|.
            let x = sine(480.0, rate, 48000, 0.5);
            let y = run_mono(&mut p, &x);
            let want = 480.0 * 2f32.powf(semis / 12.0);
            let seg = &y[9600..33600];
            let power = |f: f32| {
                let w = crate::fx::util::TAU * f / rate;
                let (mut c, mut s) = (0.0f64, 0.0f64);
                for (k, v) in seg.iter().enumerate() {
                    c += (*v * (w * k as f32).cos()) as f64;
                    s += (*v * (w * k as f32).sin()) as f64;
                }
                c * c + s * s
            };
            let best = (200..1100).map(|f| f as f32).fold((0.0f32, 0.0f64), |b, f| if power(f) > b.1 { (f, power(f)) } else { b });
            assert!((best.0 - want).abs() <= 1.5, "{semis} st: peak {} want {want}", best.0);
            assert!((rms(&y[4800..]) / 0.3536 - 1.0).abs() < 0.25, "level {}", rms(&y[4800..]));
        }
        // At unity the splicer is a plain delay of its latency.
        let mut p = PitchShifter::new(rate, 1);
        p.set_param(4, 0.0);
        let lat = p.latency() as usize;
        let x = sine(300.0, rate, 9600, 0.5);
        let y = run_mono(&mut p, &x);
        for i in lat + 4..9600 {
            assert!((y[i] - x[i - lat]).abs() < 1e-3, "{i}");
        }
        // Back to automatic settings: the phase vocoder and its latency.
        p.set_param(4, 1.0);
        assert_eq!(p.latency(), 2048);
    }

    #[test]
    fn unity_is_transparent() {
        let rate = 48000.0;
        let mut p = PitchShifter::new(rate, 2);
        let lat = p.latency() as usize;
        let l = sine(300.0, rate, 9600, 0.5);
        let r = sine(700.0, rate, 9600, 0.3);
        let (ol, or) = run_stereo(&mut p, &l, &r);
        for i in 2 * lat..9600 {
            assert!((ol[i] - l[i - lat]).abs() < 1e-3);
            assert!((or[i] - r[i - lat]).abs() < 1e-3);
        }
    }

    #[test]
    fn stereo_channels_keep_their_content() {
        let rate = 48000.0;
        let mut p = PitchShifter::new(rate, 2);
        p.set_param(0, 5.0);
        let l = sine(400.0, rate, 48000, 0.5);
        let r = vec![0.0; 48000];
        let (ol, or) = run_stereo(&mut p, &l, &r);
        assert!(rms(&or[8000..]) < 0.01 * rms(&ol[8000..]));
        let f = measure_freq(&ol[8000..], rate);
        assert!((f / (400.0 * 2f32.powf(5.0 / 12.0)) - 1.0).abs() < 0.003, "{f}");
    }
}
