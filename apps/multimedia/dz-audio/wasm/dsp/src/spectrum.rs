//! Short-time Fourier analysis for the spectral display and frequency analysis.

use crate::fft::{RealFft, Window};
use crate::{slice, slice_mut};

pub struct Analyzer {
    fft: RealFft,
    window: Vec<f32>,
    frame: Vec<f32>,
    re: Vec<f32>,
    im: Vec<f32>,
    norm: f32,
}

impl Analyzer {
    pub fn new(size: usize, window: Window) -> Analyzer {
        let w = window.build(size);
        let sum: f32 = w.iter().sum();
        Analyzer {
            fft: RealFft::new(size),
            window: w,
            frame: vec![0.0; size],
            re: vec![0.0; size / 2 + 1],
            im: vec![0.0; size / 2 + 1],
            // Full-scale sine reads 0 dBFS.
            norm: 2.0 / sum.max(1e-9),
        }
    }

    pub fn size(&self) -> usize {
        self.fft.n
    }

    /// Magnitudes in dBFS for one frame starting at `src[0]` (zero padded at the end).
    pub fn frame_db(&mut self, src: &[f32], out: &mut [f32]) {
        let n = self.fft.n;
        for i in 0..n {
            self.frame[i] = if i < src.len() { src[i] * self.window[i] } else { 0.0 };
        }
        self.fft.forward(&self.frame, &mut self.re, &mut self.im);
        for k in 0..=n / 2 {
            let m = (self.re[k] * self.re[k] + self.im[k] * self.im[k]).sqrt() * self.norm;
            out[k] = 20.0 * m.max(1e-10).log10();
        }
    }
}

#[no_mangle]
pub extern "C" fn spec_new(size: u32, window: u32) -> u32 {
    Box::into_raw(Box::new(Analyzer::new(size as usize, Window::from_u32(window)))) as u32
}

#[no_mangle]
pub extern "C" fn spec_free(h: u32) {
    if h != 0 {
        unsafe { drop(Box::from_raw(h as *mut Analyzer)) }
    }
}

/// One spectrum of `len` samples at `src` into `out` (size/2 + 1 dB values).
#[no_mangle]
pub extern "C" fn spec_frame(h: u32, src: u32, len: u32, out: u32) {
    let a = unsafe { &mut *(h as *mut Analyzer) };
    let bins = (a.size() / 2 + 1) as u32;
    unsafe { a.frame_db(slice(src, len), slice_mut(out, bins)) }
}

/// Spectrogram columns: `frames` analysis frames centred at src + i * hop
/// (src points `size / 2` samples before the first centre, so callers pass a
/// padded range). Each column is `bins` bytes, 0 at `floor_db`, 255 at 0 dB,
/// with bin 0 = DC.
#[no_mangle]
pub extern "C" fn spec_columns(h: u32, src: u32, len: u32, hop: f64, frames: u32, floor_db: f32, out: u32) {
    let a = unsafe { &mut *(h as *mut Analyzer) };
    let size = a.size();
    let bins = size / 2 + 1;
    let input = unsafe { slice(src, len) };
    let out = unsafe { std::slice::from_raw_parts_mut(out as *mut u8, frames as usize * bins) };
    let mut db = vec![0.0f32; bins];
    let scale = 255.0 / -floor_db.min(-1.0);
    for f in 0..frames as usize {
        let start = (f as f64 * hop).round() as usize;
        let end = (start + size).min(input.len());
        let seg = if start < input.len() { &input[start..end] } else { &input[0..0] };
        a.frame_db(seg, &mut db);
        let col = &mut out[f * bins..(f + 1) * bins];
        for k in 0..bins {
            col[k] = ((db[k] - floor_db) * scale).clamp(0.0, 255.0) as u8;
        }
    }
}

/// Average power spectrum (in dBFS) of `frames` frames laid out like
/// `spec_columns`; out holds size/2 + 1 values.
#[no_mangle]
pub extern "C" fn spec_average(h: u32, src: u32, len: u32, hop: f64, frames: u32, out: u32) {
    let a = unsafe { &mut *(h as *mut Analyzer) };
    let size = a.size();
    let bins = size / 2 + 1;
    let input = unsafe { slice(src, len) };
    let out = unsafe { slice_mut(out, bins as u32) };
    let mut db = vec![0.0f32; bins];
    let mut acc = vec![0.0f64; bins];
    for f in 0..frames as usize {
        let start = (f as f64 * hop).round() as usize;
        let end = (start + size).min(input.len());
        let seg = if start < input.len() { &input[start..end] } else { &input[0..0] };
        a.frame_db(seg, &mut db);
        for k in 0..bins {
            acc[k] += 10f64.powf(db[k] as f64 / 10.0);
        }
    }
    let n = (frames as f64).max(1.0);
    for k in 0..bins {
        out[k] = (10.0 * (acc[k] / n).max(1e-20).log10()) as f32;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn full_scale_sine_reads_zero_db() {
        let n = 1024;
        let mut a = Analyzer::new(n, Window::Hann);
        let src: Vec<f32> = (0..n).map(|i| (2.0 * std::f32::consts::PI * 64.0 * i as f32 / n as f32).sin()).collect();
        let mut out = vec![0.0; n / 2 + 1];
        a.frame_db(&src, &mut out);
        assert!(out[64].abs() < 0.2, "{}", out[64]);
        assert!(out[200] < -80.0);
    }
}
