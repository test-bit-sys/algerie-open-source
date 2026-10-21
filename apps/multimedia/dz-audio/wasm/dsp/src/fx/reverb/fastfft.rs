//! A faster real FFT for the convolution reverb: split complex arrays,
//! precomputed bit-reversal swaps, a fused radix-4 first pass and contiguous
//! per-stage twiddles so the remaining radix-2 stages run four butterflies at
//! a time with wasm SIMD. Same conventions as `crate::fft::RealFft`:
//! forward is unscaled, inverse is scaled so forward + inverse is identity.

use std::f64::consts::PI;

struct Cfft {
    n: usize,
    swaps: Vec<(u32, u32)>,
    /// Twiddles for stages of size 8, 16, ..., n, concatenated (half each).
    tw_re: Vec<f32>,
    tw_im: Vec<f32>,
}

impl Cfft {
    fn new(n: usize) -> Cfft {
        assert!(n.is_power_of_two() && n >= 4);
        let bits = n.trailing_zeros();
        let mut swaps = Vec::new();
        for i in 0..n as u32 {
            let j = i.reverse_bits() >> (32 - bits);
            if j > i {
                swaps.push((i, j));
            }
        }
        let (mut tw_re, mut tw_im) = (Vec::new(), Vec::new());
        let mut size = 8;
        while size <= n {
            for k in 0..size / 2 {
                let a = -2.0 * PI * k as f64 / size as f64;
                tw_re.push(a.cos() as f32);
                tw_im.push(a.sin() as f32);
            }
            size *= 2;
        }
        Cfft { n, swaps, tw_re, tw_im }
    }

    /// Forward transform in place (unscaled). For the inverse, call with re
    /// and im swapped.
    fn forward(&self, re: &mut [f32], im: &mut [f32]) {
        let n = self.n;
        let (re, im) = (&mut re[..n], &mut im[..n]);
        for &(i, j) in &self.swaps {
            re.swap(i as usize, j as usize);
            im.swap(i as usize, j as usize);
        }
        // Radix-4 pass: sizes 2 and 4 at once.
        let mut s = 0;
        while s < n {
            let (a0r, a0i) = (re[s], im[s]);
            let (a1r, a1i) = (re[s + 1], im[s + 1]);
            let (a2r, a2i) = (re[s + 2], im[s + 2]);
            let (a3r, a3i) = (re[s + 3], im[s + 3]);
            let (b0r, b0i) = (a0r + a1r, a0i + a1i);
            let (b1r, b1i) = (a0r - a1r, a0i - a1i);
            let (b2r, b2i) = (a2r + a3r, a2i + a3i);
            let (b3r, b3i) = (a2r - a3r, a2i - a3i);
            // Twiddle -i on b3.
            let (t3r, t3i) = (b3i, -b3r);
            re[s] = b0r + b2r;
            im[s] = b0i + b2i;
            re[s + 2] = b0r - b2r;
            im[s + 2] = b0i - b2i;
            re[s + 1] = b1r + t3r;
            im[s + 1] = b1i + t3i;
            re[s + 3] = b1r - t3r;
            im[s + 3] = b1i - t3i;
            s += 4;
        }
        let mut size = 8;
        let mut off = 0;
        while size <= n {
            let half = size / 2;
            let (wr, wi) = (&self.tw_re[off..off + half], &self.tw_im[off..off + half]);
            let mut start = 0;
            while start < n {
                butterflies(re, im, start, half, wr, wi);
                start += size;
            }
            off += half;
            size *= 2;
        }
    }
}

#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
#[inline]
fn butterflies(re: &mut [f32], im: &mut [f32], start: usize, half: usize, wr: &[f32], wi: &[f32]) {
    use core::arch::wasm32::*;
    assert!(start + 2 * half <= re.len() && start + 2 * half <= im.len() && wr.len() >= half && wi.len() >= half && half % 4 == 0);
    // SAFETY: the assert above bounds every access; loads are unaligned.
    unsafe {
        let (pr, pi) = (re.as_mut_ptr().add(start), im.as_mut_ptr().add(start));
        let mut k = 0;
        while k < half {
            let ar = pr.add(k) as *mut v128;
            let ai = pi.add(k) as *mut v128;
            let br = pr.add(k + half) as *mut v128;
            let bi = pi.add(k + half) as *mut v128;
            let w_r = v128_load(wr.as_ptr().add(k) as *const v128);
            let w_i = v128_load(wi.as_ptr().add(k) as *const v128);
            let (x_r, x_i) = (v128_load(br), v128_load(bi));
            let t_r = f32x4_sub(f32x4_mul(x_r, w_r), f32x4_mul(x_i, w_i));
            let t_i = f32x4_add(f32x4_mul(x_r, w_i), f32x4_mul(x_i, w_r));
            let (a_r, a_i) = (v128_load(ar), v128_load(ai));
            v128_store(br, f32x4_sub(a_r, t_r));
            v128_store(bi, f32x4_sub(a_i, t_i));
            v128_store(ar, f32x4_add(a_r, t_r));
            v128_store(ai, f32x4_add(a_i, t_i));
            k += 4;
        }
    }
}

#[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
#[inline]
fn butterflies(re: &mut [f32], im: &mut [f32], start: usize, half: usize, wr: &[f32], wi: &[f32]) {
    let (lo_r, hi_r) = re[start..start + 2 * half].split_at_mut(half);
    let (lo_i, hi_i) = im[start..start + 2 * half].split_at_mut(half);
    for k in 0..half {
        let t_r = hi_r[k] * wr[k] - hi_i[k] * wi[k];
        let t_i = hi_r[k] * wi[k] + hi_i[k] * wr[k];
        hi_r[k] = lo_r[k] - t_r;
        hi_i[k] = lo_i[k] - t_i;
        lo_r[k] += t_r;
        lo_i[k] += t_i;
    }
}

/// Real FFT of size n (power of two, at least 8) via an n/2 complex FFT.
pub struct FastRealFft {
    pub n: usize,
    inner: Cfft,
    re: Vec<f32>,
    im: Vec<f32>,
    cos: Vec<f32>,
    sin: Vec<f32>,
}

impl FastRealFft {
    pub fn new(n: usize) -> FastRealFft {
        assert!(n.is_power_of_two() && n >= 8);
        let h = n / 2;
        let (mut cos, mut sin) = (Vec::with_capacity(h), Vec::with_capacity(h));
        for k in 0..h {
            let a = -2.0 * PI * k as f64 / n as f64;
            cos.push(a.cos() as f32);
            sin.push(a.sin() as f32);
        }
        FastRealFft { n, inner: Cfft::new(h), re: vec![0.0; h], im: vec![0.0; h], cos, sin }
    }

    /// `input` (n samples) to `out_re`/`out_im` (n/2 + 1 bins).
    pub fn forward(&mut self, input: &[f32], out_re: &mut [f32], out_im: &mut [f32]) {
        let h = self.n / 2;
        for i in 0..h {
            self.re[i] = input[2 * i];
            self.im[i] = input[2 * i + 1];
        }
        self.inner.forward(&mut self.re, &mut self.im);
        out_re[0] = self.re[0] + self.im[0];
        out_im[0] = 0.0;
        out_re[h] = self.re[0] - self.im[0];
        out_im[h] = 0.0;
        for k in 1..h {
            let (ar, ai) = (self.re[k], self.im[k]);
            let (br, bi) = (self.re[h - k], -self.im[h - k]);
            let er = 0.5 * (ar + br);
            let ei = 0.5 * (ai + bi);
            let or = 0.5 * (ai - bi);
            let oi = -0.5 * (ar - br);
            let (c, s) = (self.cos[k], self.sin[k]);
            out_re[k] = er + (or * c - oi * s);
            out_im[k] = ei + (or * s + oi * c);
        }
    }

    /// Inverse of `forward` into `output` (n samples).
    pub fn inverse(&mut self, in_re: &[f32], in_im: &[f32], output: &mut [f32]) {
        let h = self.n / 2;
        for k in 0..h {
            let (xr, xi) = (in_re[k], in_im[k]);
            let (yr, yi) = (in_re[h - k], -in_im[h - k]);
            let er = 0.5 * (xr + yr);
            let ei = 0.5 * (xi + yi);
            let dr = 0.5 * (xr - yr);
            let di = 0.5 * (xi - yi);
            let (c, s) = (self.cos[k], -self.sin[k]);
            let or = dr * c - di * s;
            let oi = dr * s + di * c;
            self.re[k] = er - oi;
            self.im[k] = ei + or;
        }
        // Inverse via the forward transform with real and imaginary swapped.
        self.inner.forward(&mut self.im, &mut self.re);
        let scale = 1.0 / h as f32;
        for i in 0..h {
            output[2 * i] = self.re[i] * scale;
            output[2 * i + 1] = self.im[i] * scale;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fft::RealFft;
    use crate::fx::testutil::noise;

    #[test]
    fn matches_reference_fft_and_round_trips() {
        for n in [8usize, 16, 64, 512, 8192] {
            let x = noise(n, 1.0, n as u32);
            let mut a = FastRealFft::new(n);
            let mut b = RealFft::new(n);
            let (mut ar, mut ai) = (vec![0.0; n / 2 + 1], vec![0.0; n / 2 + 1]);
            let (mut br, mut bi) = (vec![0.0; n / 2 + 1], vec![0.0; n / 2 + 1]);
            a.forward(&x, &mut ar, &mut ai);
            b.forward(&x, &mut br, &mut bi);
            let tol = 1e-4 * (n as f32).sqrt() * 4.0;
            for k in 0..=n / 2 {
                assert!((ar[k] - br[k]).abs() < tol && (ai[k] - bi[k]).abs() < tol, "n {n} bin {k}");
            }
            let mut y = vec![0.0; n];
            a.inverse(&ar, &ai, &mut y);
            for i in 0..n {
                assert!((y[i] - x[i]).abs() < 1e-4, "n {n} at {i}");
            }
        }
    }
}
