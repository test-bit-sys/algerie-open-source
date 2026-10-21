//! Min/max peak reduction used to build waveform overviews.

use crate::{slice, slice_mut};

/// Reduces `len` samples into ceil(len / bucket) (min, max) pairs written to `out`.
pub fn minmax(src: &[f32], bucket: usize, out: &mut [f32]) {
    for (i, chunk) in src.chunks(bucket).enumerate() {
        let mut lo = f32::INFINITY;
        let mut hi = f32::NEG_INFINITY;
        for &s in chunk {
            lo = lo.min(s);
            hi = hi.max(s);
        }
        out[2 * i] = lo;
        out[2 * i + 1] = hi;
    }
}

/// Reduces existing (min, max) pairs by `factor` into a coarser level.
pub fn reduce(pairs: &[f32], factor: usize, out: &mut [f32]) {
    for (i, chunk) in pairs.chunks(2 * factor).enumerate() {
        let mut lo = f32::INFINITY;
        let mut hi = f32::NEG_INFINITY;
        for p in chunk.chunks(2) {
            lo = lo.min(p[0]);
            hi = hi.max(p[1]);
        }
        out[2 * i] = lo;
        out[2 * i + 1] = hi;
    }
}

#[no_mangle]
pub extern "C" fn peaks_minmax(src: u32, len: u32, bucket: u32, out: u32) {
    let b = bucket.max(1) as usize;
    let n = (len as usize).div_ceil(b) as u32;
    unsafe { minmax(slice(src, len), b, slice_mut(out, n * 2)) }
}

#[no_mangle]
pub extern "C" fn peaks_reduce(pairs: u32, count: u32, factor: u32, out: u32) {
    let f = factor.max(1) as usize;
    let n = (count as usize).div_ceil(f) as u32;
    unsafe { reduce(slice(pairs, count * 2), f, slice_mut(out, n * 2)) }
}

#[cfg(test)]
mod tests {
    #[test]
    fn minmax_and_reduce() {
        let src = [0.1, -0.5, 0.9, 0.2, -0.1, 0.3, 0.0];
        let mut out = [0.0; 6];
        super::minmax(&src, 3, &mut out);
        assert_eq!(out, [-0.5, 0.9, -0.1, 0.3, 0.0, 0.0]);
        let mut red = [0.0; 4];
        super::reduce(&out, 2, &mut red);
        assert_eq!(red, [-0.5, 0.9, 0.0, 0.0]);
    }
}
