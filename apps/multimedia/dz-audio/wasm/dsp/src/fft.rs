//! In-place radix-2 complex FFT and a real FFT built on a half-size complex
//! transform. Sizes are powers of two from 4 to 65536. Plans cache twiddles and
//! bit-reversal tables so repeated transforms do no allocation.

use std::f64::consts::PI;

pub struct Fft {
    pub n: usize,
    rev: Vec<u32>,
    /// Per-stage twiddles, contiguous: the stage with half-size `h` (h >= 4)
    /// stores its `h` factors at offset `h - 4` (forward sign).
    tw_re: Vec<f32>,
    tw_im: Vec<f32>,
}

impl Fft {
    pub fn new(n: usize) -> Fft {
        assert!(n.is_power_of_two() && n >= 2);
        let bits = n.trailing_zeros();
        let rev = (0..n as u32).map(|i| if bits == 0 { 0 } else { i.reverse_bits() >> (32 - bits) }).collect();
        let mut tw_re = Vec::new();
        let mut tw_im = Vec::new();
        let mut h = 4;
        while h < n {
            for k in 0..h {
                let a = -PI * k as f64 / h as f64;
                tw_re.push(a.cos() as f32);
                tw_im.push(a.sin() as f32);
            }
            h *= 2;
        }
        Fft { n, rev, tw_re, tw_im }
    }

    /// Forward transform (inverse when `inverse`, unscaled).
    pub fn process(&self, re: &mut [f32], im: &mut [f32], inverse: bool) {
        let n = self.n;
        let re = &mut re[..n];
        let im = &mut im[..n];
        for i in 0..n {
            let j = self.rev[i] as usize;
            if j > i {
                re.swap(i, j);
                im.swap(i, j);
            }
        }
        // Stage 1 (size 2): trivial butterflies.
        for (r, i) in re.chunks_exact_mut(2).zip(im.chunks_exact_mut(2)) {
            let (ar, ai, br, bi) = (r[0], i[0], r[1], i[1]);
            r[0] = ar + br;
            i[0] = ai + bi;
            r[1] = ar - br;
            i[1] = ai - bi;
        }
        if n < 4 {
            return;
        }
        // Stage 2 (size 4): twiddles 1 and -i (forward) or +i (inverse).
        let s = if inverse { -1.0f32 } else { 1.0 };
        for (r, i) in re.chunks_exact_mut(4).zip(im.chunks_exact_mut(4)) {
            let (a0r, a0i, b0r, b0i) = (r[0], i[0], r[2], i[2]);
            r[0] = a0r + b0r;
            i[0] = a0i + b0i;
            r[2] = a0r - b0r;
            i[2] = a0i - b0i;
            // b1 * (-i * s): (x + iy)(-i s) = s*y - i s*x
            let (a1r, a1i) = (r[1], i[1]);
            let xr = s * i[3];
            let xi = -s * r[3];
            r[1] = a1r + xr;
            i[1] = a1i + xi;
            r[3] = a1r - xr;
            i[3] = a1i - xi;
        }
        // Remaining stages with contiguous twiddles (bounds-check free inner loop).
        let mut half = 4;
        while half < n {
            let size = half * 2;
            let wr = &self.tw_re[half - 4..half - 4 + half];
            let wi = &self.tw_im[half - 4..half - 4 + half];
            for (r, i) in re.chunks_exact_mut(size).zip(im.chunks_exact_mut(size)) {
                let (ra, rb) = r.split_at_mut(half);
                let (ia, ib) = i.split_at_mut(half);
                #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
                {
                    // half is a multiple of 4 here; four butterflies per step.
                    unsafe { simd::stage(ra, rb, ia, ib, wr, wi, inverse) };
                    continue;
                }
                #[allow(unreachable_code)]
                if inverse {
                    for k in 0..half {
                        let (c, d) = (wr[k], -wi[k]);
                        let xr = rb[k] * c - ib[k] * d;
                        let xi = rb[k] * d + ib[k] * c;
                        rb[k] = ra[k] - xr;
                        ib[k] = ia[k] - xi;
                        ra[k] += xr;
                        ia[k] += xi;
                    }
                } else {
                    for k in 0..half {
                        let (c, d) = (wr[k], wi[k]);
                        let xr = rb[k] * c - ib[k] * d;
                        let xi = rb[k] * d + ib[k] * c;
                        rb[k] = ra[k] - xr;
                        ib[k] = ia[k] - xi;
                        ra[k] += xr;
                        ia[k] += xi;
                    }
                }
            }
            half = size;
        }
    }
}

#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
mod simd {
    use core::arch::wasm32::*;

    /// One radix-2 stage over a block, four butterflies at a time.
    #[inline(always)]
    pub unsafe fn stage(ra: &mut [f32], rb: &mut [f32], ia: &mut [f32], ib: &mut [f32], wr: &[f32], wi: &[f32], inverse: bool) {
        let n = ra.len();
        let sign = f32x4_splat(if inverse { -1.0 } else { 1.0 });
        let (pra, prb, pia, pib) = (ra.as_mut_ptr() as *mut v128, rb.as_mut_ptr() as *mut v128, ia.as_mut_ptr() as *mut v128, ib.as_mut_ptr() as *mut v128);
        let (pwr, pwi) = (wr.as_ptr() as *const v128, wi.as_ptr() as *const v128);
        let mut k = 0;
        while k < n / 4 {
            let c = v128_load(pwr.add(k));
            let d = f32x4_mul(v128_load(pwi.add(k)), sign);
            let br = v128_load(prb.add(k));
            let bi = v128_load(pib.add(k));
            let xr = f32x4_sub(f32x4_mul(br, c), f32x4_mul(bi, d));
            let xi = f32x4_add(f32x4_mul(br, d), f32x4_mul(bi, c));
            let ar = v128_load(pra.add(k));
            let ai = v128_load(pia.add(k));
            v128_store(prb.add(k), f32x4_sub(ar, xr));
            v128_store(pib.add(k), f32x4_sub(ai, xi));
            v128_store(pra.add(k), f32x4_add(ar, xr));
            v128_store(pia.add(k), f32x4_add(ai, xi));
            k += 1;
        }
    }
}

/// Real FFT of size n using an n/2 complex FFT. Output has n/2 + 1 bins.
pub struct RealFft {
    pub n: usize,
    inner: Fft,
    re: Vec<f32>,
    im: Vec<f32>,
    cos: Vec<f32>,
    sin: Vec<f32>,
}

impl RealFft {
    pub fn new(n: usize) -> RealFft {
        assert!(n.is_power_of_two() && n >= 4);
        let h = n / 2;
        let mut cos = Vec::with_capacity(h);
        let mut sin = Vec::with_capacity(h);
        for k in 0..h {
            let a = -2.0 * PI * k as f64 / n as f64;
            cos.push(a.cos() as f32);
            sin.push(a.sin() as f32);
        }
        RealFft { n, inner: Fft::new(h), re: vec![0.0; h], im: vec![0.0; h], cos, sin }
    }

    /// Forward transform of `input` (len n) into `out_re`/`out_im` (len n/2 + 1).
    pub fn forward(&mut self, input: &[f32], out_re: &mut [f32], out_im: &mut [f32]) {
        let h = self.n / 2;
        for i in 0..h {
            self.re[i] = input[2 * i];
            self.im[i] = input[2 * i + 1];
        }
        self.inner.process(&mut self.re, &mut self.im, false);
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

    /// Inverse of `forward`; writes n real samples scaled so forward+inverse is identity.
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
        self.inner.process(&mut self.re, &mut self.im, true);
        let scale = 1.0 / h as f32;
        for i in 0..h {
            output[2 * i] = self.re[i] * scale;
            output[2 * i + 1] = self.im[i] * scale;
        }
    }
}

/// Window functions shared by analysis and spectral processing.
#[derive(Clone, Copy)]
pub enum Window {
    Hann = 0,
    Hamming = 1,
    Blackman = 2,
    BlackmanHarris = 3,
    Rectangular = 4,
}

impl Window {
    pub fn from_u32(v: u32) -> Window {
        match v {
            1 => Window::Hamming,
            2 => Window::Blackman,
            3 => Window::BlackmanHarris,
            4 => Window::Rectangular,
            _ => Window::Hann,
        }
    }

    pub fn build(self, n: usize) -> Vec<f32> {
        let m = n as f64;
        (0..n)
            .map(|i| {
                let x = 2.0 * PI * i as f64 / m;
                let w = match self {
                    Window::Hann => 0.5 - 0.5 * x.cos(),
                    Window::Hamming => 0.54 - 0.46 * x.cos(),
                    Window::Blackman => 0.42 - 0.5 * x.cos() + 0.08 * (2.0 * x).cos(),
                    Window::BlackmanHarris => {
                        0.35875 - 0.48829 * x.cos() + 0.14128 * (2.0 * x).cos() - 0.01168 * (3.0 * x).cos()
                    }
                    Window::Rectangular => 1.0,
                };
                w as f32
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn complex_fft_matches_dft() {
        for n in [2usize, 4, 8, 16, 64, 256] {
            let f = Fft::new(n);
            let xr: Vec<f32> = (0..n).map(|i| ((i * 37 % 11) as f32 - 5.0) / 5.0).collect();
            let xi: Vec<f32> = (0..n).map(|i| ((i * 13 % 7) as f32 - 3.0) / 3.0).collect();
            for inverse in [false, true] {
                let (mut re, mut im) = (xr.clone(), xi.clone());
                f.process(&mut re, &mut im, inverse);
                let sg = if inverse { 1.0 } else { -1.0 };
                for k in 0..n {
                    let (mut sr, mut si) = (0.0f64, 0.0f64);
                    for t in 0..n {
                        let a = sg * 2.0 * PI * (k * t) as f64 / n as f64;
                        sr += xr[t] as f64 * a.cos() - xi[t] as f64 * a.sin();
                        si += xr[t] as f64 * a.sin() + xi[t] as f64 * a.cos();
                    }
                    assert!((re[k] as f64 - sr).abs() < 1e-3 && (im[k] as f64 - si).abs() < 1e-3, "n {n} k {k} inv {inverse}");
                }
            }
        }
    }

    #[test]
    fn real_fft_round_trip_and_bins() {
        let n = 64;
        let mut f = RealFft::new(n);
        let input: Vec<f32> = (0..n).map(|i| (2.0 * std::f32::consts::PI * 4.0 * i as f32 / n as f32).sin()).collect();
        let mut re = vec![0.0; n / 2 + 1];
        let mut im = vec![0.0; n / 2 + 1];
        f.forward(&input, &mut re, &mut im);
        let mag: Vec<f32> = re.iter().zip(&im).map(|(r, i)| (r * r + i * i).sqrt()).collect();
        let peak = mag.iter().enumerate().fold(0, |b, (i, &m)| if m > mag[b] { i } else { b });
        assert_eq!(peak, 4);
        assert!((mag[4] - n as f32 / 2.0).abs() < 1e-3);
        let mut out = vec![0.0; n];
        f.inverse(&re, &im, &mut out);
        for i in 0..n {
            assert!((out[i] - input[i]).abs() < 1e-4);
        }
    }
}
