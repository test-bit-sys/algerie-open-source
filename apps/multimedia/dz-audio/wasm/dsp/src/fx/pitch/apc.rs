//! Automatic Pitch Correction: YIN tracks the pitch of a reference channel and
//! a phase-vocoder shifter glides the signal towards the nearest note of the
//! chosen scale.
//! Params: 0 scale (0 major, 1 minor, 2 chromatic), 1 key (0 C .. 11 B),
//! 2 attack (1 slow .. 10 fast), 3 sensitivity (1..200), 4 reference channel
//! (0 left, 1 right), 5 FFT size (0 1024, 1 2048, 2 4096 at 48 kHz),
//! 6 calibration A4 in Hz (410..470).
//! Readout: [correction cents now, detected Hz (0 unvoiced), target note
//! (MIDI number, 0 unvoiced)].

use super::core::{fft_size, Yin};
use super::shifter::ShiftEngine;
use crate::fx::util::{Biquad, Coefs};
use crate::fx::Effect;

const SUB: usize = 64;
const MAJOR: [bool; 12] = [true, false, true, false, true, true, false, true, false, true, false, true];
const MINOR: [bool; 12] = [true, false, true, true, false, true, false, true, true, false, true, false];

pub struct AutoPitch {
    rate: f32,
    channels: usize,
    engine: ShiftEngine,
    yin: Yin,
    ring: Vec<f32>,
    ring_pos: usize,
    /// Detection runs on the reference channel low passed and decimated to
    /// about 24 kHz, which is plenty for voice fundamentals and halves its cost.
    decim: usize,
    decim_phase: usize,
    aa: [Biquad; 2],
    frame: Vec<f32>,
    since: usize,
    detect_hop: usize,
    scratch: Vec<f32>,
    scale: u32,
    key: i32,
    attack: f32,
    sensitivity: f32,
    reference: usize,
    size: u32,
    a4: f32,
    /// Last detected frequency (0 when unvoiced), for tests and metering.
    pub detected: f32,
    /// Note the detected pitch is pulled to (MIDI number, 0 when unvoiced).
    note: f32,
}

impl AutoPitch {
    pub fn new(rate: f32, channels: usize) -> AutoPitch {
        let decim = ((rate / 24000.0).round() as usize).max(1);
        let drate = rate / decim as f32;
        let yn = 1024;
        let aa = Biquad::new(Coefs::lowpass(rate, 4000.0f32.min(drate * 0.4), 0.7071));
        let mut a = AutoPitch {
            rate,
            channels,
            engine: ShiftEngine::new(rate, channels, fft_size(1024, 1, rate)),
            yin: Yin::new(yn, drate),
            ring: vec![0.0; yn],
            ring_pos: 0,
            decim,
            decim_phase: 0,
            aa: [aa, aa],
            frame: vec![0.0; yn],
            since: 0,
            detect_hop: yn / 4,
            scratch: vec![0.0; 2 * SUB],
            scale: 0,
            key: 0,
            attack: 7.0,
            sensitivity: 50.0,
            reference: 0,
            size: 1,
            a4: 440.0,
            detected: 0.0,
            note: 0.0,
        };
        a.update_glide();
        a
    }

    fn update_glide(&mut self) {
        // Attack 1 corrects over about 400 ms, 10 over about 2 ms.
        let tau = 0.4 * 0.55f32.powf(self.attack - 1.0);
        let hop = self.engine.stft.hop as f32;
        self.engine.glide = (-hop / (self.rate * tau)).exp();
    }

    /// The nearest allowed note (in fractional MIDI numbers) to `midi`.
    pub fn target_note(&self, midi: f32) -> f32 {
        let scale = match self.scale {
            0 => &MAJOR,
            1 => &MINOR,
            _ => return midi.round(),
        };
        let base = midi.floor() as i32;
        let mut best = midi.round();
        let mut dist = f32::MAX;
        for n in base - 2..=base + 3 {
            if scale[(n - self.key).rem_euclid(12) as usize] {
                let d = (n as f32 - midi).abs();
                if d < dist {
                    dist = d;
                    best = n as f32;
                }
            }
        }
        best
    }

    fn detect(&mut self) {
        let n = self.ring.len();
        let p = self.ring_pos;
        self.frame[..n - p].copy_from_slice(&self.ring[p..]);
        self.frame[n - p..].copy_from_slice(&self.ring[..p]);
        // Sensitivity 1..100 maps to an aperiodicity threshold of 0.05..0.45.
        let threshold = 0.05 + 0.4 * (self.sensitivity / 100.0);
        let pitch = self.yin.detect(&self.frame, 60.0, 1400.0, threshold);
        let voiced = pitch.freq > 0.0 && pitch.aperiodicity < threshold && pitch.power > 1e-6;
        if voiced {
            self.detected = pitch.freq;
            let midi = 69.0 + 12.0 * (pitch.freq / self.a4).log2();
            let target = self.target_note(midi);
            self.note = target;
            self.engine.target = 2f32.powf((target - midi) / 12.0);
        } else {
            self.detected = 0.0;
            self.note = 0.0;
            self.engine.target = 1.0;
        }
    }
}

impl Effect for AutoPitch {
    fn set_param(&mut self, idx: u32, value: f32) {
        match idx {
            0 => self.scale = (value.round().max(0.0) as u32).min(2),
            1 => self.key = (value.round() as i32).clamp(0, 11),
            2 => {
                self.attack = value.clamp(1.0, 10.0);
                self.update_glide();
            }
            3 => self.sensitivity = value.clamp(1.0, 200.0),
            4 => self.reference = if value >= 0.5 { 1 } else { 0 },
            5 => {
                let s = (value.round().max(0.0) as u32).min(2);
                if s != self.size {
                    self.size = s;
                    self.engine = ShiftEngine::new(self.rate, self.channels, fft_size(1024, s, self.rate));
                    self.update_glide();
                }
            }
            6 => self.a4 = value.clamp(400.0, 480.0),
            _ => {}
        }
    }

    fn process(&mut self, buf: &mut [f32], channels: usize, frames: usize) {
        let ch = channels.min(self.channels);
        let rc = self.reference.min(ch - 1);
        let mut at = 0;
        while at < frames {
            let m = SUB.min(frames - at);
            for c in 0..ch {
                self.scratch[c * m..(c + 1) * m].copy_from_slice(&buf[c * frames + at..c * frames + at + m]);
            }
            let n = self.ring.len();
            for i in 0..m {
                let y0 = self.aa[0].process(self.scratch[rc * m + i]);
                let y = self.aa[1].process(y0);
                self.decim_phase += 1;
                if self.decim_phase >= self.decim {
                    self.decim_phase = 0;
                    self.ring[self.ring_pos] = y;
                    self.ring_pos = (self.ring_pos + 1) % n;
                    self.since += 1;
                }
            }
            for b in &mut self.aa {
                b.flush();
            }
            if self.since >= self.detect_hop {
                self.since -= self.detect_hop;
                self.detect();
            }
            self.engine.process(&mut self.scratch[..ch * m], m);
            for c in 0..ch {
                buf[c * frames + at..c * frames + at + m].copy_from_slice(&self.scratch[c * m..(c + 1) * m]);
            }
            at += m;
        }
    }

    fn readout(&mut self, out: &mut [f32]) -> usize {
        if out.len() < 3 {
            return 0;
        }
        out[0] = 1200.0 * self.engine.ratio.max(1e-6).log2();
        out[1] = self.detected;
        out[2] = self.note;
        3
    }

    fn reset(&mut self) {
        self.ring.iter_mut().for_each(|v| *v = 0.0);
        self.since = 0;
        self.decim_phase = 0;
        for b in &mut self.aa {
            b.reset();
        }
        self.engine.target = 1.0;
        self.engine.reset();
        self.detected = 0.0;
        self.note = 0.0;
    }

    fn latency(&self) -> u32 {
        self.engine.n() as u32
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fx::pitch::shifter::tests::measure_freq;
    use crate::fx::testutil::{run_mono, sine};

    fn corrected(f: f32, scale: f32, key: f32) -> f32 {
        let rate = 48000.0;
        let mut a = AutoPitch::new(rate, 1);
        a.set_param(0, scale);
        a.set_param(1, key);
        a.set_param(2, 9.0);
        let x = sine(f, rate, 48000, 0.5);
        let y = run_mono(&mut a, &x);
        measure_freq(&y[24000..], rate)
    }

    #[test]
    fn snaps_to_the_nearest_note() {
        // Chromatic: 452 Hz is A4 plus 47 cents.
        let f = corrected(452.0, 2.0, 0.0);
        assert!((f / 440.0 - 1.0).abs() < 0.003, "{f}");
        let f = corrected(428.0, 2.0, 0.0);
        assert!((f / 440.0 - 1.0).abs() < 0.003, "{f}");
        // C major has no A#: 455 Hz goes to A, not A#.
        let f = corrected(455.0, 0.0, 0.0);
        assert!((f / 440.0 - 1.0).abs() < 0.003, "{f}");
        // D major has C#: 270 Hz (between C4 and C#4, nearer C#) goes to C#4.
        let f = corrected(272.0, 0.0, 2.0);
        assert!((f / 277.18 - 1.0).abs() < 0.004, "{f}");
    }

    #[test]
    fn reports_the_correction() {
        let rate = 48000.0;
        let mut a = AutoPitch::new(rate, 1);
        a.set_param(0, 2.0);
        a.set_param(2, 9.0);
        // 452 Hz is A4 plus 47 cents: the correction pulls it down by about that.
        let x = sine(452.0, rate, 24000, 0.5);
        run_mono(&mut a, &x);
        let mut out = [0.0f32; 4];
        assert_eq!(a.readout(&mut out), 3);
        assert!((out[0] + 47.0).abs() < 4.0, "{}", out[0]);
        assert!((out[1] - 452.0).abs() < 3.0, "{}", out[1]);
        assert_eq!(out[2], 69.0);
    }

    #[test]
    fn scale_targets() {
        let mut a = AutoPitch::new(48000.0, 1);
        a.set_param(0, 1.0); // A minor via key 9
        a.set_param(1, 9.0);
        assert_eq!(a.target_note(60.8), 60.0); // no C# in A minor
        assert_eq!(a.target_note(61.3), 62.0);
        assert_eq!(a.target_note(69.4), 69.0);
        a.set_param(0, 2.0);
        assert_eq!(a.target_note(61.4), 61.0);
    }

    #[test]
    fn noise_is_left_alone() {
        let rate = 48000.0;
        let mut a = AutoPitch::new(rate, 1);
        let x = crate::fx::testutil::noise(24000, 0.3, 3);
        run_mono(&mut a, &x);
        assert_eq!(a.detected, 0.0);
    }
}
