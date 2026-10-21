//! Dynamics Processing (kind 39): a gain computer that follows a drawn input
//! to output level curve, so one processor covers compression, limiting,
//! expansion, gating and upward compression (any mix of them, at any level).
//!
//! The detector measures the (optionally band-limited) input as peak or RMS,
//! follows that level with the attack time while it rises and the release
//! time while it falls (attack and release describe the level, so a gate
//! opens with the attack and closes with the release), looks the level up in
//! the curve and applies the gain change to the input delayed by the
//! look-ahead time.
//!
//! Params: 0 curve (data slot 0), 1 detection (0 peak, 1 RMS), 2 attack ms,
//!         3 release ms, 4 look-ahead ms, 5 link channels, 6 band limit on,
//!         7 detector low cut Hz, 8 detector high cut Hz, 9 make-up gain dB.
//! Data slot 0: curve points [in0, out0, in1, out1, ...] in dBFS, sorted by
//!         input. Below the first point the gain stays that of the first
//!         point; above the last the last segment's slope continues.
//! Readout: [detector level dBFS, gain change dB, make-up dB]: the highest
//!         level and the deepest gain change since the previous read.

use super::common::{db_lin, lin_db, Ramp};
use crate::fx::util::{ms_coef, ms_frames, sanitize, Biquad, Coefs, DelayLine};
use crate::fx::Effect;

const TABLE_LO: f32 = -120.0;
const TABLE_HI: f32 = 24.0;
const TABLE_STEP: f32 = 0.25;
const TABLE_LEN: usize = ((TABLE_HI - TABLE_LO) / TABLE_STEP) as usize + 1;
const MAX_LOOKAHEAD_MS: f32 = 20.0;
const RMS_MS: f32 = 5.0;
const FLOOR_DB: f32 = -120.0;

/// Gain change (dB) for an input level on a piecewise linear curve.
pub fn curve_gain(points: &[(f32, f32)], x: f32) -> f32 {
    match points.len() {
        0 => 0.0,
        1 => points[0].1 - points[0].0,
        n => {
            if x <= points[0].0 {
                return points[0].1 - points[0].0;
            }
            for k in 1..n {
                let (x1, y1) = points[k];
                if x <= x1 || k == n - 1 {
                    let (x0, y0) = points[k - 1];
                    let w = x1 - x0;
                    let y = if w > 1e-6 { y0 + (y1 - y0) * (x - x0) / w } else { y1 };
                    return y - x;
                }
            }
            0.0
        }
    }
}

#[derive(Clone, Copy, Default)]
struct Side {
    hp: Biquad,
    lp: Biquad,
    ms: f32,
}

pub struct CurveDynamics {
    rate: f32,
    p: [f32; 10],
    table: Vec<f32>,
    side: [Side; 2],
    delay: [DelayLine; 2],
    look: usize,
    att: f32,
    rel: f32,
    rms_coef: f32,
    env: [f32; 2],
    makeup: Ramp,
    // Readout accumulators.
    peak_level: f32,
    min_gain: f32,
}

impl CurveDynamics {
    pub fn new(rate: f32, _channels: usize) -> CurveDynamics {
        let max = ms_frames(MAX_LOOKAHEAD_MS, rate) + 1;
        let mut d = CurveDynamics {
            rate,
            p: [0.0, 0.0, 2.0, 120.0, 2.0, 1.0, 0.0, 100.0, 10000.0, 0.0],
            table: vec![0.0; TABLE_LEN],
            side: [Side::default(); 2],
            delay: [DelayLine::new(max), DelayLine::new(max)],
            look: 0,
            att: 0.0,
            rel: 0.0,
            rms_coef: ms_coef(RMS_MS, rate),
            env: [0.0; 2],
            makeup: Ramp::new(1.0, rate, 20.0),
            peak_level: FLOOR_DB,
            min_gain: 0.0,
        };
        d.set_curve(&[(-100.0, -100.0), (0.0, 0.0)]);
        d.update();
        d.makeup.settle();
        d
    }

    fn set_curve(&mut self, points: &[(f32, f32)]) {
        for (i, g) in self.table.iter_mut().enumerate() {
            *g = curve_gain(points, TABLE_LO + i as f32 * TABLE_STEP);
        }
    }

    fn update(&mut self) {
        let p = self.p;
        let r = self.rate;
        self.att = ms_coef(p[2].max(0.0), r);
        self.rel = ms_coef(p[3].max(1.0), r);
        self.look = ms_frames(p[4].clamp(0.0, MAX_LOOKAHEAD_MS), r);
        let nyq = r * 0.49;
        let lo = p[7].clamp(10.0, nyq);
        let hi = p[8].clamp(lo, nyq);
        for s in &mut self.side {
            s.hp.c = Coefs::highpass(r, lo, 0.7071);
            s.lp.c = Coefs::lowpass(r, hi, 0.7071);
        }
        self.makeup.target = db_lin(p[9]);
    }

    /// Gain change (dB) from the curve table at a level (dB).
    #[inline]
    fn lookup(&self, level: f32) -> f32 {
        let f = ((level - TABLE_LO) / TABLE_STEP).clamp(0.0, (TABLE_LEN - 1) as f32);
        let i = f as usize;
        if i + 1 >= TABLE_LEN {
            return self.table[TABLE_LEN - 1];
        }
        let w = f - i as f32;
        self.table[i] + (self.table[i + 1] - self.table[i]) * w
    }

    /// Detector input (absolute peak or RMS) for one sample.
    #[inline]
    fn detect(side: &mut Side, x: f32, band: bool, rms: bool, rms_coef: f32) -> f32 {
        let y = if band { side.lp.process(side.hp.process(x)) } else { x };
        if rms {
            let p = y * y;
            side.ms = p + (side.ms - p) * rms_coef;
            side.ms.sqrt()
        } else {
            y.abs()
        }
    }

    /// Follows a linear level (attack while it rises, release while it falls)
    /// and returns it in dB.
    #[inline]
    fn follow(env: &mut f32, x: f32, att: f32, rel: f32) -> f32 {
        let c = if x > *env { att } else { rel };
        *env = x + (*env - x) * c;
        lin_db(*env + 1e-10).max(FLOOR_DB)
    }
}

impl Effect for CurveDynamics {
    fn set_param(&mut self, idx: u32, v: f32) {
        if (idx as usize) < self.p.len() {
            self.p[idx as usize] = v;
            self.update();
        }
    }

    fn set_data(&mut self, slot: u32, data: &[f32]) {
        if slot != 0 {
            return;
        }
        let mut pts: Vec<(f32, f32)> = data
            .chunks_exact(2)
            .filter(|c| c[0].is_finite() && c[1].is_finite())
            .map(|c| (c[0], c[1]))
            .collect();
        pts.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        if pts.is_empty() {
            pts.push((0.0, 0.0));
        }
        self.set_curve(&pts);
    }

    fn process(&mut self, buf: &mut [f32], channels: usize, frames: usize) {
        let ch = channels.min(2);
        let rms = self.p[1] >= 0.5;
        let link = self.p[5] >= 0.5 || ch == 1;
        let band = self.p[6] >= 0.5;
        let (att, rel, rc, look) = (self.att, self.rel, self.rms_coef, self.look);
        let mut peak_level = self.peak_level;
        let mut min_gain = self.min_gain;
        for i in 0..frames {
            let m = self.makeup.next();
            let mut det = [0.0f32; 2];
            for c in 0..ch {
                let x = buf[c * frames + i];
                det[c] = Self::detect(&mut self.side[c], x, band, rms, rc);
                self.delay[c].push(x);
            }
            if link {
                let lvl = Self::follow(&mut self.env[0], det[0].max(det[1]), att, rel);
                let g = self.lookup(lvl);
                let gain = db_lin(g) * m;
                for c in 0..ch {
                    buf[c * frames + i] = self.delay[c].tap(look) * gain;
                }
                peak_level = peak_level.max(lvl);
                min_gain = min_gain.min(g);
            } else {
                for c in 0..ch {
                    let lvl = Self::follow(&mut self.env[c], det[c], att, rel);
                    let g = self.lookup(lvl);
                    buf[c * frames + i] = self.delay[c].tap(look) * db_lin(g) * m;
                    peak_level = peak_level.max(lvl);
                    min_gain = min_gain.min(g);
                }
            }
        }
        self.peak_level = peak_level;
        self.min_gain = min_gain;
        for s in &mut self.side {
            s.hp.flush();
            s.lp.flush();
            s.ms = sanitize(s.ms);
        }
        for e in &mut self.env {
            *e = sanitize(*e);
        }
    }

    fn reset(&mut self) {
        self.makeup.settle();
        self.env = [0.0; 2];
        for s in &mut self.side {
            s.hp.reset();
            s.lp.reset();
            s.ms = 0.0;
        }
        for d in &mut self.delay {
            d.clear();
        }
        self.peak_level = FLOOR_DB;
        self.min_gain = 0.0;
    }

    fn latency(&self) -> u32 {
        self.look as u32
    }

    fn readout(&mut self, out: &mut [f32]) -> usize {
        if out.len() < 3 {
            return 0;
        }
        out[0] = self.peak_level;
        out[1] = self.min_gain;
        out[2] = self.p[9];
        // The next read reports the span from now on; the current state seeds it.
        self.peak_level = lin_db(self.env[0].max(self.env[1]) + 1e-10).max(FLOOR_DB);
        self.min_gain = 0.0;
        3
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fx::testutil::*;
    use crate::fx::util::gain_to_db;

    fn make_curve(points: &[(f32, f32)], params: &[(u32, f32)]) -> Box<dyn Effect> {
        let mut fx = make(39, 48000.0, 1);
        let flat: Vec<f32> = points.iter().flat_map(|&(x, y)| [x, y]).collect();
        fx.set_data(0, &flat);
        for &(i, v) in params {
            fx.set_param(i, v);
        }
        fx.reset();
        fx
    }

    #[test]
    fn curve_gain_interpolates_and_extrapolates() {
        let pts = [(-100.0, -100.0), (-20.0, -20.0), (0.0, -13.333)];
        assert!(curve_gain(&pts, -50.0).abs() < 1e-4);
        assert!((curve_gain(&pts, -10.0) + 6.667).abs() < 0.01);
        // Below the first point: the first point's gain; above the last: its slope.
        assert!(curve_gain(&pts, -110.0).abs() < 1e-4);
        assert!((curve_gain(&pts, 6.0) - (-13.333 + 2.0 - 6.0)).abs() < 0.01);
    }

    #[test]
    fn identity_curve_passes_audio_unchanged() {
        let x = sine(440.0, 48000.0, 9600, 0.5);
        let mut fx = make_curve(&[(-100.0, -100.0), (0.0, 0.0)], &[(4, 0.0)]);
        let y = run_mono(fx.as_mut(), &x);
        for i in 0..x.len() {
            assert!((y[i] - x[i]).abs() < 1e-4, "{i}");
        }
    }

    #[test]
    fn compressor_curve_reduces_loud_levels() {
        // 3:1 above -20 dBFS, peak detection: a -6 dBFS sine comes out near -15.3.
        let x = sine(1000.0, 48000.0, 24000, 0.5);
        let mut fx = make_curve(&[(-100.0, -100.0), (-20.0, -20.0), (0.0, -13.333)], &[(4, 0.0), (3, 50.0)]);
        let y = run_mono(fx.as_mut(), &x);
        let out = gain_to_db(peak(&y[20000..]));
        assert!((out + 15.33).abs() < 0.6, "{out}");
    }

    #[test]
    fn gate_curve_silences_quiet_input() {
        let mut x = sine(800.0, 48000.0, 48000, 0.5);
        for v in &mut x[24000..] {
            *v *= 0.0005; // about -72 dBFS
        }
        let pts = [(-100.0, -100.0), (-51.0, -100.0), (-50.0, -50.0), (0.0, 0.0)];
        let mut fx = make_curve(&pts, &[(2, 1.0), (3, 30.0), (4, 0.0)]);
        let y = run_mono(fx.as_mut(), &x);
        assert!((peak(&y[12000..24000]) - 0.5).abs() < 0.01);
        // -72 dBFS in, -100 dBFS out (the curve's floor).
        assert!(peak(&y[40000..]) < 1.2e-5, "{}", peak(&y[40000..]));
    }

    #[test]
    fn lookahead_limiter_catches_the_attack_and_reports_latency() {
        let mut x = sine(500.0, 48000.0, 24000, 0.1);
        for v in &mut x[12000..] {
            *v *= 9.0;
        }
        let pts = [(-100.0, -100.0), (-6.0, -6.0), (0.0, -6.0)];
        let mut fx = make_curve(&pts, &[(2, 0.0), (3, 100.0), (4, 5.0)]);
        assert_eq!(fx.latency(), 240);
        let y = run_mono(fx.as_mut(), &x);
        let ceiling = db_to_gain_f(-6.0);
        assert!(peak(&y[240..]) <= ceiling * 1.02, "{}", peak(&y));
    }

    fn db_to_gain_f(db: f32) -> f32 {
        10f32.powf(db / 20.0)
    }

    #[test]
    fn band_limited_detector_ignores_out_of_band_energy() {
        // A loud 100 Hz tone with the detector limited to 4..10 kHz is left alone.
        let x = sine(100.0, 48000.0, 24000, 0.5);
        let pts = [(-100.0, -100.0), (-30.0, -30.0), (0.0, -22.5)];
        let mut fx = make_curve(&pts, &[(4, 0.0), (6, 1.0), (7, 4000.0), (8, 10000.0)]);
        let y = run_mono(fx.as_mut(), &x);
        assert!((peak(&y[20000..]) - 0.5).abs() < 0.01, "{}", peak(&y[20000..]));
        let mut fx = make_curve(&pts, &[(4, 0.0)]);
        let y = run_mono(fx.as_mut(), &x);
        assert!(peak(&y[20000..]) < 0.3);
    }

    #[test]
    fn readout_reports_level_and_gain() {
        let x = sine(1000.0, 48000.0, 12000, 0.5);
        let mut fx = make_curve(&[(-100.0, -100.0), (-20.0, -20.0), (0.0, -13.333)], &[(4, 0.0), (9, 3.0)]);
        run_mono(fx.as_mut(), &x);
        let mut out = [0.0f32; 4];
        assert_eq!(fx.readout(&mut out), 3);
        assert!((out[0] + 6.0).abs() < 0.5, "{}", out[0]);
        assert!((out[1] + 9.3).abs() < 0.6, "{}", out[1]);
        assert_eq!(out[2], 3.0);
    }

    #[test]
    fn unlinked_stereo_treats_channels_separately() {
        let l = sine(700.0, 48000.0, 24000, 0.5);
        let r = sine(700.0, 48000.0, 24000, 0.01);
        let pts = [(-100.0, -100.0), (-20.0, -20.0), (0.0, -13.333)];
        let mut fx = make(39, 48000.0, 2);
        let flat: Vec<f32> = pts.iter().flat_map(|&(x, y)| [x, y]).collect();
        fx.set_data(0, &flat);
        fx.set_param(4, 0.0);
        fx.set_param(5, 0.0);
        fx.reset();
        let (_, yr) = run_stereo(fx.as_mut(), &l, &r);
        assert!((peak(&yr[20000..]) - 0.01).abs() < 2e-4);
    }
}
