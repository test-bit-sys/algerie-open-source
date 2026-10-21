//! Dynamics (kind 32): auto gate, compressor, expander and limiter sections
//! sharing one detector, in the spirit of a channel-strip dynamics processor.
//!
//! Params:  0 gate on, 1 gate threshold dB, 2 gate attack ms, 3 gate release ms, 4 gate hold ms,
//!          5 compressor on, 6 compressor threshold dB, 7 compressor ratio, 8 compressor knee dB,
//!          9 expander on, 10 expander threshold dB, 11 expander ratio,
//!          12 limiter on, 13 limiter threshold dB,
//!          14 attack ms, 15 release ms, 16 detection (0 peak, 1 RMS), 17 link channels,
//!          18 make-up gain dB, 19 limiter release ms.
//! Readout: [lowest gate gain 0..1, deepest compressor, expander and limiter
//!          gain changes in dB] since the last read.

use super::common::{db_lin, frame_peak, lin_db, Detector, GainSmoother};
use crate::fx::util::{compress_db, expand_db, ms_coef, ms_frames, sanitize};
use crate::fx::Effect;
use super::common::Ramp;

const GATE_HYSTERESIS_DB: f32 = 3.0;
const EXP_KNEE_DB: f32 = 3.0;
const RMS_MS: f32 = 10.0;

#[derive(Clone, Copy, Default)]
struct Side {
    det: Detector,
    gain: GainSmoother,
    lim: GainSmoother,
    gate: f32,
    open: bool,
    hold_left: usize,
    m_gate: f32,
    m_comp: f32,
    m_exp: f32,
    m_lim: f32,
}

#[derive(Clone, Copy)]
struct Settings {
    gate_on: bool,
    gate_thr: f32,
    hold: usize,
    gate_att: f32,
    gate_rel: f32,
    comp_on: bool,
    comp_thr: f32,
    comp_ratio: f32,
    comp_knee: f32,
    exp_on: bool,
    exp_thr: f32,
    exp_ratio: f32,
    lim_on: bool,
    lim_thr: f32,
}

pub struct Dynamics {
    rate: f32,
    p: [f32; 20],
    s: Settings,
    rms: bool,
    link: bool,
    makeup: Ramp,
    side: [Side; 2],
}

impl Dynamics {
    pub fn new(rate: f32, _channels: usize) -> Dynamics {
        let p = [
            0.0, -50.0, 2.0, 200.0, 50.0, // gate
            1.0, -20.0, 3.0, 6.0, // compressor
            0.0, -45.0, 2.0, // expander
            0.0, -1.0, // limiter
            5.0, 150.0, 0.0, 1.0, 0.0, // detection, make-up
            60.0, // limiter release
        ];
        let mut d = Dynamics {
            rate,
            p,
            s: Settings {
                gate_on: false,
                gate_thr: 0.0,
                hold: 0,
                gate_att: 0.0,
                gate_rel: 0.0,
                comp_on: true,
                comp_thr: 0.0,
                comp_ratio: 1.0,
                comp_knee: 0.0,
                exp_on: false,
                exp_thr: 0.0,
                exp_ratio: 1.0,
                lim_on: false,
                lim_thr: 0.0,
            },
            rms: false,
            link: true,
            makeup: Ramp::new(1.0, rate, 20.0),
            side: [Side { gate: 1.0, open: true, m_gate: 1.0, ..Side::default() }; 2],
        };
        d.update();
        d.makeup.settle();
        d
    }

    fn update(&mut self) {
        let p = &self.p;
        let r = self.rate;
        self.s = Settings {
            gate_on: p[0] >= 0.5,
            gate_thr: p[1],
            gate_att: ms_coef(p[2].max(0.01), r),
            gate_rel: ms_coef(p[3].max(0.1), r),
            hold: ms_frames(p[4], r),
            comp_on: p[5] >= 0.5,
            comp_thr: p[6],
            comp_ratio: p[7].max(1.0),
            comp_knee: p[8].max(0.0),
            exp_on: p[9] >= 0.5,
            exp_thr: p[10],
            exp_ratio: p[11].max(1.0),
            lim_on: p[12] >= 0.5,
            lim_thr: p[13],
        };
        self.rms = p[16] >= 0.5;
        self.link = p[17] >= 0.5;
        self.makeup.target = db_lin(p[18]);
        for s in &mut self.side {
            if self.rms {
                s.det.set(r, RMS_MS, RMS_MS, true);
            } else {
                s.det.set(r, 0.0, 10.0, false);
            }
            s.gain.set(r, p[14], p[15].max(1.0));
            s.lim.set(r, 0.0, p[19].max(1.0));
        }
    }

    /// Gain (linear, without make-up) for one detector input.
    #[inline]
    fn gain(s: &Settings, side: &mut Side, x: f32, makeup_db: f32) -> f32 {
        let level = lin_db(side.det.next(x) + 1e-10);
        let comp = if s.comp_on { compress_db(level, s.comp_thr, s.comp_ratio, s.comp_knee) } else { 0.0 };
        let exp = if s.exp_on { expand_db(level, s.exp_thr, s.exp_ratio, EXP_KNEE_DB) } else { 0.0 };
        let g = side.gain.next(comp + exp);
        let mut lim = 0.0;
        if s.lim_on {
            lim = side.lim.next((s.lim_thr - (level + g + makeup_db)).min(0.0));
        }
        side.m_comp = side.m_comp.min(comp);
        side.m_exp = side.m_exp.min(exp);
        side.m_lim = side.m_lim.min(lim);
        let mut gate = 1.0;
        if s.gate_on {
            if level > s.gate_thr {
                side.open = true;
                side.hold_left = s.hold;
            } else if level < s.gate_thr - GATE_HYSTERESIS_DB {
                if side.hold_left > 0 {
                    side.hold_left -= 1;
                } else {
                    side.open = false;
                }
            }
            let t = if side.open { 1.0 } else { 0.0 };
            let c = if t > side.gate { s.gate_att } else { s.gate_rel };
            side.gate = t + (side.gate - t) * c;
            gate = side.gate;
            side.m_gate = side.m_gate.min(gate);
        }
        gate * db_lin(g + lim)
    }
}

impl Effect for Dynamics {
    fn set_param(&mut self, idx: u32, v: f32) {
        if (idx as usize) < self.p.len() {
            self.p[idx as usize] = v;
            self.update();
        }
    }
    fn process(&mut self, buf: &mut [f32], channels: usize, frames: usize) {
        let s = self.s;
        let makeup_db = self.p[18];
        if self.link || channels == 1 {
            for i in 0..frames {
                let x = frame_peak(buf, channels, frames, i);
                let g = Self::gain(&s, &mut self.side[0], x, makeup_db) * self.makeup.next();
                for c in 0..channels {
                    buf[c * frames + i] *= g;
                }
            }
        } else {
            for i in 0..frames {
                let m = self.makeup.next();
                for c in 0..2 {
                    let x = buf[c * frames + i];
                    buf[c * frames + i] = x * Self::gain(&s, &mut self.side[c], x.abs(), makeup_db) * m;
                }
            }
        }
        for side in &mut self.side {
            side.gate = sanitize(side.gate);
        }
    }
    fn reset(&mut self) {
        self.makeup.settle();
        for side in &mut self.side {
            *side = Side { det: side.det, gain: side.gain, lim: side.lim, gate: 1.0, open: true, hold_left: 0, m_gate: 1.0, m_comp: 0.0, m_exp: 0.0, m_lim: 0.0 };
            side.det.reset();
            side.gain.reset();
            side.lim.reset();
        }
    }
    fn readout(&mut self, out: &mut [f32]) -> usize {
        if out.len() < 4 {
            return 0;
        }
        let [a, b] = &mut self.side;
        out[0] = a.m_gate.min(b.m_gate);
        out[1] = a.m_comp.min(b.m_comp);
        out[2] = a.m_exp.min(b.m_exp);
        out[3] = a.m_lim.min(b.m_lim);
        for side in [a, b] {
            side.m_gate = 1.0;
            side.m_comp = 0.0;
            side.m_exp = 0.0;
            side.m_lim = 0.0;
        }
        4
    }
}

#[cfg(test)]
mod tests {
    use crate::fx::testutil::*;
    use crate::fx::util::{db_to_gain, gain_to_db};

    fn run(params: &[(u32, f32)], x: &[f32]) -> Vec<f32> {
        let mut fx = make(32, 48000.0, 1);
        for &(i, v) in params {
            fx.set_param(i, v);
        }
        fx.reset();
        run_mono(fx.as_mut(), x)
    }

    #[test]
    fn compressor_section_reduces_loud_levels() {
        let x = sine(1000.0, 48000.0, 24000, 0.9);
        let y = run(&[(6, -20.0), (7, 4.0), (8, 0.0)], &x);
        let g = gain_to_db(peak(&y[20000..]) / 0.9);
        // Peak 0.9 is -0.9 dBFS: 19.1 dB over, 4:1 removes about 14.3 dB.
        assert!((g + 14.3).abs() < 0.7, "{g}");
        let q = sine(1000.0, 48000.0, 24000, 0.01);
        let y = run(&[(6, -20.0)], &q);
        assert!((peak(&y[20000..]) - 0.01).abs() < 1e-4);
    }

    #[test]
    fn gate_closes_on_quiet_input_and_holds() {
        let r = 48000.0;
        let mut x = sine(800.0, r, 48000, 0.5);
        for v in &mut x[24000..] {
            *v *= 0.001; // -66 dBFS
        }
        let y = run(&[(0, 1.0), (1, -40.0), (3, 20.0), (4, 100.0), (5, 0.0)], &x);
        assert!((peak(&y[10000..24000]) - 0.5).abs() < 0.01, "open while loud");
        // Still open during the hold time just after the drop.
        assert!(peak(&y[24100..24800]) > 0.0004);
        // Closed well after hold + release.
        assert!(peak(&y[40000..]) < 1e-6);
    }

    #[test]
    fn expander_pushes_down_low_levels() {
        let x = sine(800.0, 48000.0, 24000, 0.003); // about -50 dBFS
        let y = run(&[(5, 0.0), (9, 1.0), (10, -40.0), (11, 3.0)], &x);
        let g = gain_to_db(peak(&y[20000..]) / 0.003);
        // 10 dB under a 1:3 expander threshold -> about 20 dB more reduction.
        assert!((g + 20.0).abs() < 1.5, "{g}");
    }

    #[test]
    fn limiter_section_caps_peaks_with_makeup() {
        let x = sine(800.0, 48000.0, 24000, 0.5);
        let y = run(&[(5, 0.0), (12, 1.0), (13, -10.0), (18, 6.0)], &x);
        assert!(peak(&y[12000..]) <= db_to_gain(-10.0) * 1.02, "{}", peak(&y[12000..]));
    }
}
