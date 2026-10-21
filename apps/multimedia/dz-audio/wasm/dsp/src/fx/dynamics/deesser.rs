//! DeEsser (kind 35): detects energy in a sibilance band and reduces it,
//! either across the whole signal (broadband) or only inside the band
//! (multiband split: the signal is divided into the band and its exact
//! complement, so with no reduction the output equals the input).
//!
//! Params: 0 mode (0 broadband, 1 multiband), 1 centre frequency Hz,
//!   2 bandwidth Hz, 3 threshold dB, 4 maximum reduction dB,
//!   5 output sibilance only (outputs just what is being removed).
//! Readout: [deepest reduction dB since the last read].

use super::common::{db_lin, lin_db, Detector, GainSmoother};
use crate::fx::util::{Biquad, Coefs};
use crate::fx::Effect;
use super::common::Ramp;

const SUB: usize = 32;
/// Reduction per dB over the threshold (a 1:5 ratio).
const SLOPE: f32 = 0.8;

pub struct DeEsser {
    rate: f32,
    multiband: bool,
    listen: bool,
    threshold: f32,
    max_red: f32,
    freq: Ramp,
    bw: Ramp,
    band: [Biquad; 2],
    det: Detector,
    gr: GainSmoother,
    /// Last reduction in dB (for tests and metering).
    pub reduction: f32,
    /// Deepest reduction since the last readout.
    meter: f32,
}

impl DeEsser {
    pub fn new(rate: f32, _channels: usize) -> DeEsser {
        let mut d = DeEsser {
            rate,
            multiband: true,
            listen: false,
            threshold: -30.0,
            max_red: 12.0,
            freq: Ramp::new(6500.0, rate / SUB as f32, 30.0),
            bw: Ramp::new(3000.0, rate / SUB as f32, 30.0),
            band: [Biquad::default(); 2],
            det: Detector::default(),
            gr: GainSmoother::default(),
            reduction: 0.0,
            meter: 0.0,
        };
        d.det.set(rate, 0.1, 20.0, false);
        d.gr.set(rate, 0.5, 60.0);
        d.coefs();
        d
    }
    fn coefs(&mut self) {
        let f = self.freq.value.clamp(500.0, self.rate * 0.45);
        let q = (f / self.bw.value.max(50.0)).clamp(0.3, 20.0);
        let c = Coefs::bandpass(self.rate, f, q);
        for b in &mut self.band {
            b.c = c;
        }
    }
}

impl Effect for DeEsser {
    fn set_param(&mut self, idx: u32, v: f32) {
        match idx {
            0 => self.multiband = v >= 0.5,
            1 => self.freq.target = v.clamp(500.0, 20000.0),
            2 => self.bw.target = v.clamp(50.0, 16000.0),
            3 => self.threshold = v.clamp(-80.0, 0.0),
            4 => self.max_red = v.clamp(0.0, 60.0),
            5 => self.listen = v >= 0.5,
            _ => {}
        }
    }
    fn process(&mut self, buf: &mut [f32], channels: usize, frames: usize) {
        let channels = channels.min(2);
        let mut at = 0;
        while at < frames {
            let n = SUB.min(frames - at);
            if !self.freq.settled() || !self.bw.settled() {
                self.freq.next();
                self.bw.next();
                self.coefs();
            }
            for i in at..at + n {
                let mut band = [0.0f32; 2];
                for c in 0..channels {
                    band[c] = self.band[c].process(buf[c * frames + i]);
                }
                let level = lin_db(self.det.next(band[0].abs().max(band[1].abs())) + 1e-10);
                let over = level - self.threshold;
                let target = if over > 0.0 { -(over * SLOPE).min(self.max_red) } else { 0.0 };
                let red = self.gr.next(target);
                self.meter = self.meter.min(red);
                let g = db_lin(red);
                for c in 0..channels {
                    let x = &mut buf[c * frames + i];
                    *x = match (self.multiband, self.listen) {
                        (true, false) => *x - band[c] + band[c] * g,
                        (true, true) => band[c] * (1.0 - g),
                        (false, false) => *x * g,
                        (false, true) => *x * (1.0 - g),
                    };
                }
            }
            at += n;
        }
        self.reduction = self.gr.db;
        for b in &mut self.band {
            b.flush();
        }
    }
    fn reset(&mut self) {
        self.freq.settle();
        self.bw.settle();
        self.coefs();
        for b in &mut self.band {
            b.reset();
        }
        self.det.reset();
        self.gr.reset();
        self.meter = 0.0;
    }
    fn readout(&mut self, out: &mut [f32]) -> usize {
        if out.is_empty() {
            return 0;
        }
        out[0] = self.meter;
        self.meter = 0.0;
        1
    }
}

#[cfg(test)]
mod tests {
    use crate::fx::testutil::*;

    fn run(mode: f32, f: f32, amp: f32) -> f32 {
        let r = 48000.0;
        let mut fx = make(35, r, 1);
        fx.set_param(0, mode);
        fx.set_param(1, 7000.0);
        fx.set_param(2, 3000.0);
        fx.set_param(3, -30.0);
        fx.set_param(4, 15.0);
        fx.reset();
        let x = sine(f, r, 24000, amp);
        let y = run_mono(fx.as_mut(), &x);
        rms(&y[12000..]) / rms(&x[12000..])
    }

    #[test]
    fn reduces_loud_sibilance_but_not_lows() {
        assert!(run(1.0, 7000.0, 0.5) < 0.3); // capped at 15 dB
        assert!(run(1.0, 7000.0, 0.5) > 0.15);
        assert!((run(1.0, 300.0, 0.5) - 1.0).abs() < 0.02);
        assert!((run(1.0, 7000.0, 0.005) - 1.0).abs() < 0.02, "quiet sibilance passes");
    }

    #[test]
    fn broadband_mode_ducks_everything_together() {
        let r = 48000.0;
        let mut fx = make(35, r, 2);
        fx.set_param(0, 0.0);
        fx.set_param(1, 7000.0);
        fx.set_param(3, -30.0);
        fx.reset();
        let s = sine(7000.0, r, 24000, 0.5);
        let low: Vec<f32> = sine(200.0, r, 24000, 0.3).iter().zip(&s).map(|(a, b)| a + b).collect();
        let (l, _) = run_stereo(fx.as_mut(), &low, &low);
        assert!(rms(&l[12000..]) < rms(&low[12000..]) * 0.5);
    }

    #[test]
    fn listen_outputs_only_the_removed_part() {
        let r = 48000.0;
        let mut fx = make(35, r, 1);
        fx.set_param(5, 1.0);
        fx.reset();
        let x = sine(300.0, r, 24000, 0.5);
        let y = run_mono(fx.as_mut(), &x);
        assert!(peak(&y[12000..]) < 1e-4);
    }
}
