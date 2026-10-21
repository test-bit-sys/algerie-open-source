//! DeClipper (offline): finds runs of samples stuck at the clipping level
//! and rebuilds the missing peaks, either with a cubic through the
//! neighbouring samples or with least-squares AR interpolation. Rebuilt
//! samples are never allowed below the clip level, so the waveform only
//! gains its lost peaks.

use super::ar::Lsar;

/// Interpolation methods.
#[allow(dead_code)]
pub const CUBIC: u32 = 0;
pub const AR: u32 = 1;

/// Repairs clipped runs in place. A sample is clipped when |x| >= `level`
/// and a run must be at least `min_run` samples long. Returns the number of
/// repaired runs.
pub fn declip(x: &mut [f32], level: f32, min_run: usize, method: u32) -> usize {
    let n = x.len();
    let min_run = min_run.max(1);
    let max_len = 2048;
    let mut lsar = if method == AR { Some(Lsar::new(max_len, 64, 2048)) } else { None };
    let mut count = 0;
    let mut i = 0;
    while i < n {
        if x[i].abs() < level {
            i += 1;
            continue;
        }
        let sign = x[i].signum();
        let s = i;
        while i < n && x[i].abs() >= level && x[i].signum() == sign {
            i += 1;
        }
        let e = i;
        let len = e - s;
        if len < min_run || s < 2 || e + 2 > n || len > max_len {
            continue;
        }
        let ok = match lsar.as_mut() {
            Some(l) => {
                let order = (2 * len + 8).clamp(16, 64);
                l.repair(x, s, len, order, 512)
            }
            None => {
                cubic_fill(x, s, e);
                true
            }
        };
        if ok {
            for v in &mut x[s..e] {
                if *v * sign < level {
                    *v = sign * level;
                }
            }
            count += 1;
        }
    }
    count
}

/// Fills x[s..e] with the cubic through x[s-2], x[s-1], x[e], x[e+1].
fn cubic_fill(x: &mut [f32], s: usize, e: usize) {
    let pts = [(-2.0f64, x[s - 2] as f64), (-1.0, x[s - 1] as f64), ((e - s) as f64, x[e] as f64), ((e - s + 1) as f64, x[e + 1] as f64)];
    for i in s..e {
        let t = (i - s) as f64;
        let mut v = 0.0;
        for (j, &(tj, yj)) in pts.iter().enumerate() {
            let mut l = 1.0;
            for (m, &(tm, _)) in pts.iter().enumerate() {
                if m != j {
                    l *= (t - tm) / (tj - tm);
                }
            }
            v += yj * l;
        }
        x[i] = v as f32;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fx::testutil::*;

    #[test]
    fn restores_clipped_peaks() {
        let rate = 48000.0;
        let clean = sine(150.0, rate, 9600, 1.3);
        let clipped: Vec<f32> = clean.iter().map(|v| v.clamp(-1.0, 1.0)).collect();
        let err = |y: &[f32]| (0..y.len()).map(|i| (y[i] - clean[i]).powi(2)).sum::<f32>();
        for method in [CUBIC, AR] {
            let mut y = clipped.clone();
            let runs = declip(&mut y, 0.999, 3, method);
            assert!(runs >= 10, "method {method}: {runs} runs");
            assert!(peak(&y) > 1.1, "method {method}: peak {}", peak(&y));
            assert!(err(&y) < err(&clipped) * 0.2, "method {method}: {} vs {}", err(&y), err(&clipped));
        }
        // Unclipped audio is untouched.
        let mut q = sine(150.0, rate, 4800, 0.5);
        let before = q.clone();
        assert_eq!(declip(&mut q, 0.999, 3, CUBIC), 0);
        assert_eq!(q, before);
    }
}
