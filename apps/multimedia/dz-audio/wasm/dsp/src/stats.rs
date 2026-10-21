//! Amplitude statistics over a block of samples.

use crate::{slice, slice_mut};

/// Writes [min, max, sum, sum_sq, clipped, nonfinite] for `len` samples.
/// Callers accumulate blocks and derive peak, RMS and DC offset.
#[no_mangle]
pub extern "C" fn stats_block(src: u32, len: u32, out: u32) {
    let s = unsafe { slice(src, len) };
    let o = unsafe { slice_mut(out, 6) };
    let (mut lo, mut hi) = (f32::INFINITY, f32::NEG_INFINITY);
    let (mut sum, mut sq) = (0.0f64, 0.0f64);
    let (mut clipped, mut bad) = (0u32, 0u32);
    for &x in s {
        if !x.is_finite() {
            bad += 1;
            continue;
        }
        lo = lo.min(x);
        hi = hi.max(x);
        sum += x as f64;
        sq += (x as f64) * (x as f64);
        if x.abs() >= 0.999_969_5 {
            clipped += 1;
        }
    }
    o[0] = if len == 0 { 0.0 } else { lo };
    o[1] = if len == 0 { 0.0 } else { hi };
    o[2] = sum as f32;
    o[3] = sq as f32;
    o[4] = clipped as f32;
    o[5] = bad as f32;
}

/// Bits needed to represent every sample exactly as fixed point (1..24), 32
/// when any sample is not on a 24-bit grid (floating point), 0 for silence.
#[no_mangle]
pub extern "C" fn stats_bits(src: u32, len: u32) -> u32 {
    let s = unsafe { slice(src, len) };
    bits_needed(s)
}

pub fn bits_needed(s: &[f32]) -> u32 {
    let mut bits = 0u32;
    for &x in s {
        if x == 0.0 || !x.is_finite() {
            continue;
        }
        let v = x as f64 * 8_388_608.0;
        if v.fract() != 0.0 || v.abs() > 8_388_608.0 {
            return 32;
        }
        let iv = v as i64;
        let need = 24 - iv.trailing_zeros().min(23);
        bits = bits.max(need);
    }
    bits
}

/// RMS over consecutive windows of `win` samples (a trailing partial window
/// is ignored): writes [min, max, sum of window RMS, window count].
#[no_mangle]
pub extern "C" fn stats_rms(src: u32, len: u32, win: u32, out: u32) {
    let s = unsafe { slice(src, len) };
    let o = unsafe { slice_mut(out, 4) };
    let (mut lo, mut hi, mut sum, mut count) = (f64::INFINITY, 0.0f64, 0.0f64, 0u32);
    let win = win.max(1) as usize;
    for chunk in s.chunks_exact(win) {
        let ms: f64 = chunk.iter().map(|&x| if x.is_finite() { (x as f64) * (x as f64) } else { 0.0 }).sum::<f64>() / win as f64;
        let r = ms.sqrt();
        lo = lo.min(r);
        hi = hi.max(r);
        sum += r;
        count += 1;
    }
    o[0] = if count == 0 { 0.0 } else { lo as f32 };
    o[1] = hi as f32;
    o[2] = sum as f32;
    o[3] = count as f32;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn measures_bit_depth() {
        assert_eq!(bits_needed(&[0.0, 0.0]), 0);
        assert_eq!(bits_needed(&[0.5, -0.5]), 2);
        assert_eq!(bits_needed(&[0.5, -0.25]), 3);
        let q16: Vec<f32> = (0..100).map(|i| ((i * 37 % 65536) as i32 - 32768) as f32 / 32768.0).collect();
        assert!(bits_needed(&q16) <= 16 && bits_needed(&q16) > 8);
        let q24 = [1.0 / 8_388_608.0];
        assert_eq!(bits_needed(&q24), 24);
        assert_eq!(bits_needed(&[0.1]), 32);
    }
}
