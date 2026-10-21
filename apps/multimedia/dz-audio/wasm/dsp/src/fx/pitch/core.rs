//! Shared pitch machinery: a phase-locked peak shifter for the phase vocoder
//! (Laroche and Dolson style), a YIN pitch detector and a windowed-sinc table
//! for varispeed resampling.

use crate::fft::RealFft;
use crate::fx::util::{PI, TAU};

/// Wraps a phase to [-pi, pi).
#[inline]
pub fn wrap(x: f32) -> f32 {
    x - TAU * ((x + PI) / TAU).floor()
}

/// FFT size for a precision choice (0 low, 1 medium, 2 high) at `rate`,
/// scaled from the 48 kHz sizes `base` so the time resolution stays similar.
pub fn fft_size(base: usize, precision: u32, rate: f32) -> usize {
    let k = (rate / 48000.0).log2().round() as i32;
    let n = (base << precision.min(2)) as f64 * 2f64.powi(k);
    (n as usize).clamp(256, 32768).next_power_of_two()
}

/// Shifts the pitch of one STFT frame. Spectral peaks are found on the summed
/// power of a channel group, each peak's region of influence is moved to the
/// new frequency as a block, and the block's phase is rotated so the peak's
/// sinusoid stays continuous across frames (phase locking keeps the region's
/// relative phases, so transients and stereo images survive).
pub struct PeakShifter {
    n: usize,
    bins: usize,
    /// Output phase map per channel group leader: previous frame and next.
    map: Vec<Vec<f32>>,
    map_next: Vec<f32>,
    power: Vec<f32>,
    peaks: Vec<usize>,
    env: Vec<f32>,
    prefix: Vec<f32>,
    formant_bins: usize,
    pub ore: Vec<Vec<f32>>,
    pub oim: Vec<Vec<f32>>,
}

impl PeakShifter {
    pub fn new(n: usize, channels: usize, rate: f32) -> PeakShifter {
        let bins = n / 2 + 1;
        PeakShifter {
            n,
            bins,
            map: vec![vec![0.0; bins]; channels],
            map_next: vec![0.0; bins],
            power: vec![0.0; bins],
            peaks: Vec::with_capacity(bins),
            env: vec![0.0; bins],
            prefix: vec![0.0; bins + 1],
            // Smooth the spectral envelope over about 250 Hz.
            formant_bins: ((250.0 * n as f32 / rate) as usize).max(2),
            ore: vec![vec![0.0; bins]; channels],
            oim: vec![vec![0.0; bins]; channels],
        }
    }

    pub fn reset(&mut self) {
        for m in &mut self.map {
            m.iter_mut().for_each(|v| *v = 0.0);
        }
    }

    /// Spectral envelope for formant preservation: magnitudes of the
    /// significant peaks joined by straight lines (held flat beyond the first
    /// and last), then lightly smoothed. A lone sinusoid gets a flat envelope,
    /// a harmonic voice gets the curve through its harmonics.
    fn envelope(&mut self, thr: f32) {
        let bins = self.bins;
        let mut prev: Option<(usize, f32)> = None;
        for i in 0..self.peaks.len() {
            let k = self.peaks[i];
            if self.power[k] <= thr {
                continue;
            }
            let m = self.power[k].sqrt();
            match prev {
                None => self.env[..=k].iter_mut().for_each(|v| *v = m),
                Some((pk, pm)) => {
                    let span = (k - pk) as f32;
                    for t in pk..=k {
                        self.env[t] = pm + (m - pm) * (t - pk) as f32 / span;
                    }
                }
            }
            prev = Some((k, m));
        }
        match prev {
            None => self.env.iter_mut().for_each(|v| *v = 1.0),
            Some((pk, pm)) => self.env[pk..bins].iter_mut().for_each(|v| *v = pm),
        }
        // Moving average over about 250 Hz.
        self.prefix[0] = 0.0;
        for k in 0..bins {
            self.prefix[k + 1] = self.prefix[k] + self.env[k];
        }
        let w = self.formant_bins / 2;
        for k in 0..bins {
            let a = k.saturating_sub(w);
            let b = (k + w + 1).min(bins);
            self.env[k] = (self.prefix[b] - self.prefix[a]) / (b - a) as f32 + 1e-12;
        }
    }

    /// Shifts channels `lo..hi` of the frame (`re`, `im`) by `ratio`.
    /// `pre`/`pim` are the same channels analysed `h` samples earlier (for the
    /// instantaneous frequency); `hs` is the synthesis hop. Writes `ore`/`oim`
    /// and returns false, or returns true when the frame passes unchanged
    /// (ratio 1 with `bypass_ok`), in which case `ore`/`oim` are untouched.
    #[allow(clippy::too_many_arguments)]
    pub fn shift(
        &mut self,
        re: &[Vec<f32>],
        im: &[Vec<f32>],
        pre: &[Vec<f32>],
        pim: &[Vec<f32>],
        lo: usize,
        hi: usize,
        ratio: f32,
        h: f32,
        hs: f32,
        formants: bool,
        bypass_ok: bool,
    ) -> bool {
        let bins = self.bins;
        let n = self.n as f32;
        let bypass = bypass_ok && (ratio - 1.0).abs() < 1e-6;
        let formants = formants && !bypass && (ratio - 1.0).abs() > 1e-6;
        // Summed power of the group, for peak picking.
        let mut maxp = 0.0f32;
        for k in 0..bins {
            let mut p = 0.0;
            for c in lo..hi {
                p += re[c][k] * re[c][k] + im[c][k] * im[c][k];
            }
            self.power[k] = p;
            maxp = maxp.max(p);
        }
        let floor = maxp * 1e-9;
        self.peaks.clear();
        for k in 2..bins.saturating_sub(2) {
            let p = self.power[k];
            if p > floor && p > self.power[k - 1] && p >= self.power[k + 1] && p > self.power[k - 2] && p >= self.power[k + 2] {
                self.peaks.push(k);
            }
        }
        if formants {
            self.envelope(maxp * 1e-6);
        }
        let leader = lo;
        self.map_next.copy_from_slice(&self.map[leader]);
        if !bypass {
            for c in lo..hi {
                self.ore[c].iter_mut().for_each(|v| *v = 0.0);
                self.oim[c].iter_mut().for_each(|v| *v = 0.0);
            }
        }
        let np = self.peaks.len();
        for i in 0..np {
            let k = self.peaks[i];
            let r_lo = if i == 0 { 0 } else { (self.peaks[i - 1] + k) / 2 + 1 };
            let r_hi = if i + 1 == np { bins - 1 } else { (k + self.peaks[i + 1]) / 2 };
            // Reference channel: the loudest at the peak.
            let mut rc = lo;
            let mut best = -1.0;
            for c in lo..hi {
                let p = re[c][k] * re[c][k] + im[c][k] * im[c][k];
                if p > best {
                    best = p;
                    rc = c;
                }
            }
            let (xr, xi) = (re[rc][k], im[rc][k]);
            let phi_in = xi.atan2(xr);
            if bypass {
                for t in r_lo..=r_hi {
                    self.map_next[t] = phi_in;
                }
                continue;
            }
            // Instantaneous frequency from the phase advance over h samples.
            let (yr, yi) = (pre[rc][k], pim[rc][k]);
            let zr = xr * yr + xi * yi;
            let zi = xi * yr - xr * yi;
            let dphi = zi.atan2(zr);
            let expected = TAU * k as f32 * h / n;
            let omega = TAU * k as f32 / n + wrap(dphi - expected) / h;
            let target = omega * n / TAU * ratio;
            let kt = target.round() as isize;
            if kt < 0 || kt >= bins as isize {
                continue;
            }
            let s = kt - k as isize;
            let phi_out = wrap(self.map[leader][kt as usize] + hs * omega * ratio);
            let theta = phi_out - phi_in;
            let (st, ct) = theta.sin_cos();
            let a = (r_lo as isize + s).max(0) as usize;
            let b = ((r_hi as isize + s).min(bins as isize - 1)).max(-1);
            if b < a as isize {
                continue;
            }
            let b = b as usize;
            for t in a..=b {
                let j = (t as isize - s) as usize;
                let g = if formants { (self.env[t] / self.env[j]).clamp(0.1, 10.0) } else { 1.0 };
                let (cg, sg) = (ct * g, st * g);
                for c in lo..hi {
                    let (ar, ai) = (re[c][j], im[c][j]);
                    self.ore[c][t] += ar * cg - ai * sg;
                    self.oim[c][t] += ar * sg + ai * cg;
                }
                self.map_next[t] = phi_out;
            }
        }
        std::mem::swap(&mut self.map[leader], &mut self.map_next);
        bypass
    }
}

/// YIN fundamental frequency estimator (de Cheveigne and Kawahara) using an
/// FFT for the difference function, so a 2048-sample analysis costs three FFTs.
pub struct Yin {
    pub n: usize,
    w: usize,
    rate: f32,
    fft: RealFft,
    a: Vec<f32>,
    are: Vec<f32>,
    aim: Vec<f32>,
    bre: Vec<f32>,
    bim: Vec<f32>,
    r: Vec<f32>,
    d: Vec<f32>,
}

/// A YIN result: frequency in Hz (0 when none), aperiodicity (0 = perfectly
/// periodic, 1 = noise) and mean power of the analysis window.
#[derive(Clone, Copy, Debug)]
pub struct Pitch {
    pub freq: f32,
    pub aperiodicity: f32,
    pub power: f32,
}

impl Yin {
    /// `n` samples are analysed per call (window n/2, lags up to n/2).
    pub fn new(n: usize, rate: f32) -> Yin {
        let bins = n / 2 + 1;
        Yin {
            n,
            w: n / 2,
            rate,
            fft: RealFft::new(n),
            a: vec![0.0; n],
            are: vec![0.0; bins],
            aim: vec![0.0; bins],
            bre: vec![0.0; bins],
            bim: vec![0.0; bins],
            r: vec![0.0; n],
            d: vec![0.0; n / 2],
        }
    }

    /// Analyses `x` (n samples, oldest first) for pitches in [fmin, fmax].
    pub fn detect(&mut self, x: &[f32], fmin: f32, fmax: f32, threshold: f32) -> Pitch {
        let (n, w) = (self.n, self.w);
        self.a[..w].copy_from_slice(&x[..w]);
        self.a[w..].iter_mut().for_each(|v| *v = 0.0);
        self.fft.forward(&self.a, &mut self.are, &mut self.aim);
        self.fft.forward(&x[..n], &mut self.bre, &mut self.bim);
        for k in 0..self.are.len() {
            let (ar, ai) = (self.are[k], -self.aim[k]);
            let (br, bi) = (self.bre[k], self.bim[k]);
            self.bre[k] = ar * br - ai * bi;
            self.bim[k] = ar * bi + ai * br;
        }
        self.fft.inverse(&self.bre, &self.bim, &mut self.r);
        let mut e0 = 0.0f64;
        for v in &x[..w] {
            e0 += (*v as f64) * (*v as f64);
        }
        let power = (e0 / w as f64) as f32;
        let tmin = ((self.rate / fmax) as usize).max(2);
        let tmax = ((self.rate / fmin) as usize).min(w - 2);
        if tmin + 2 >= tmax || power < 1e-12 {
            return Pitch { freq: 0.0, aperiodicity: 1.0, power };
        }
        // Difference function and its cumulative mean normalised form.
        let mut et = e0;
        self.d[0] = 1.0;
        let mut sum = 0.0f64;
        for t in 1..=tmax + 1 {
            et += (x[t + w - 1] as f64).powi(2) - (x[t - 1] as f64).powi(2);
            let dt = (e0 + et - 2.0 * self.r[t] as f64).max(0.0);
            sum += dt;
            self.d[t] = if sum > 0.0 { (dt * t as f64 / sum) as f32 } else { 1.0 };
        }
        let mut tau = 0;
        for t in tmin..=tmax {
            if self.d[t] < threshold {
                let mut u = t;
                while u < tmax && self.d[u + 1] < self.d[u] {
                    u += 1;
                }
                tau = u;
                break;
            }
        }
        if tau == 0 {
            tau = (tmin..=tmax).fold(tmin, |b, t| if self.d[t] < self.d[b] { t } else { b });
        }
        let ap = self.d[tau];
        // Parabolic interpolation of the minimum.
        let (y0, y1, y2) = (self.d[tau - 1], self.d[tau], self.d[tau + 1]);
        let den = y0 - 2.0 * y1 + y2;
        let off = if den.abs() > 1e-12 { (0.5 * (y0 - y2) / den).clamp(-0.5, 0.5) } else { 0.0 };
        Pitch { freq: self.rate / (tau as f32 + off), aperiodicity: ap, power }
    }
}

/// Blackman-Harris windowed sinc, tabulated for fast fractional reads.
pub struct SincTable {
    pub zeros: usize,
    res: usize,
    table: Vec<f32>,
}

impl SincTable {
    pub fn new(zeros: usize, res: usize) -> SincTable {
        let len = zeros * res + 2;
        let table = (0..len)
            .map(|i| {
                let u = i as f64 / res as f64;
                if u >= zeros as f64 {
                    return 0.0;
                }
                let s = if u == 0.0 { 1.0 } else { (std::f64::consts::PI * u).sin() / (std::f64::consts::PI * u) };
                let x = std::f64::consts::PI * (u / zeros as f64 + 1.0); // window over [-zeros, zeros]
                let wnd = 0.35875 - 0.48829 * x.cos() + 0.14128 * (2.0 * x).cos() - 0.01168 * (3.0 * x).cos();
                (s * wnd) as f32
            })
            .collect();
        SincTable { zeros, res, table }
    }

    /// Kernel value at distance `u` zero crossings.
    #[inline]
    pub fn at(&self, u: f32) -> f32 {
        let p = u.abs() * self.res as f32;
        let i = p as usize;
        if i + 1 >= self.table.len() {
            return 0.0;
        }
        let f = p - i as f32;
        self.table[i] + (self.table[i + 1] - self.table[i]) * f
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fx::testutil::sine;

    #[test]
    fn yin_finds_pitch() {
        let rate = 48000.0;
        let mut y = Yin::new(2048, rate);
        for f in [82.4f32, 220.0, 440.0, 987.0] {
            let x = sine(f, rate, 2048, 0.5);
            let p = y.detect(&x, 50.0, 1500.0, 0.15);
            assert!((p.freq / f - 1.0).abs() < 0.003, "{f} -> {}", p.freq);
            assert!(p.aperiodicity < 0.05);
        }
        // Noise is aperiodic.
        let x = crate::fx::testutil::noise(2048, 0.5, 7);
        assert!(y.detect(&x, 50.0, 1500.0, 0.15).aperiodicity > 0.3);
    }

    #[test]
    fn fft_sizes_scale_with_rate() {
        assert_eq!(fft_size(1024, 1, 48000.0), 2048);
        assert_eq!(fft_size(1024, 1, 44100.0), 2048);
        assert_eq!(fft_size(1024, 1, 96000.0), 4096);
        assert_eq!(fft_size(1024, 0, 22050.0), 512);
    }

    #[test]
    fn sinc_table_shape() {
        let s = SincTable::new(16, 512);
        assert!((s.at(0.0) - 1.0).abs() < 1e-6);
        assert!(s.at(1.0).abs() < 1e-3);
        assert!(s.at(2.0).abs() < 1e-3);
        assert_eq!(s.at(16.0), 0.0);
    }
}
