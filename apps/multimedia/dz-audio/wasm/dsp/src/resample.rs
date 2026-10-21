//! Band-limited sample-rate conversion of a whole buffer: the polyphase
//! Kaiser-windowed sinc of resample_stream.rs run over one block, so both
//! paths share the quality settings and produce the same samples.

use crate::resample_stream::Stream;
use crate::{slice, slice_mut};

/// Converts `input` at `from` Hz into `output` at `to` Hz at `quality` (0..100),
/// with or without the pre/post filter. `output.len()` decides how many
/// samples are produced; reads past the input are treated as silence.
pub fn resample_q(input: &[f32], from: f64, to: f64, output: &mut [f32], quality: f64, filter: bool) {
    let from = from.round().max(1.0) as u32;
    let to = to.round().max(1.0) as u32;
    let mut s = Stream::with_quality(from, to, quality, filter);
    let mut n = s.process(input, output);
    // Trailing silence until every requested output exists.
    let zeros = vec![0.0f32; 4096];
    while n < output.len() {
        let got = s.process(&zeros, &mut output[n..]);
        n += got;
        if got == 0 {
            break;
        }
    }
}

/// Default quality (50) with the pre/post filter.
pub fn resample(input: &[f32], from: f64, to: f64, output: &mut [f32]) {
    resample_q(input, from, to, output, 50.0, true)
}

#[no_mangle]
pub extern "C" fn resample_block(src: u32, src_len: u32, from: f64, to: f64, out: u32, out_len: u32) {
    unsafe { resample(slice(src, src_len), from, to, slice_mut(out, out_len)) }
}

#[no_mangle]
pub extern "C" fn resample_block_q(src: u32, src_len: u32, from: f64, to: f64, out: u32, out_len: u32, quality: f64, filter: u32) {
    unsafe { resample_q(slice(src, src_len), from, to, slice_mut(out, out_len), quality, filter != 0) }
}

#[cfg(test)]
mod tests {
    use super::resample_q;

    fn tone(f: f64, rate: f64, n: usize) -> Vec<f32> {
        (0..n).map(|i| (2.0 * std::f64::consts::PI * f * i as f64 / rate).sin() as f32).collect()
    }

    fn rms(x: &[f32]) -> f64 {
        (x.iter().map(|&v| v as f64 * v as f64).sum::<f64>() / x.len() as f64).sqrt()
    }

    #[test]
    fn keeps_a_low_tone() {
        let input = tone(441.0, 44100.0, 4410);
        let mut out = vec![0.0; 4800];
        super::resample(&input, 44100.0, 48000.0, &mut out);
        for j in 200..4600 {
            let want = (2.0 * std::f32::consts::PI * 441.0 * j as f32 / 48000.0).sin();
            assert!((out[j] - want).abs() < 0.01, "{} {} {}", j, out[j], want);
        }
    }

    #[test]
    fn every_quality_keeps_a_low_tone() {
        for q in [0.0, 25.0, 50.0, 75.0, 100.0] {
            let input = tone(441.0, 48000.0, 9600);
            let mut out = vec![0.0; 8820];
            resample_q(&input, 48000.0, 44100.0, &mut out, q, true);
            for j in 1000..7800 {
                let want = (2.0 * std::f64::consts::PI * 441.0 * j as f64 / 44100.0).sin() as f32;
                assert!((out[j] - want).abs() < 0.01, "q{q} at {j}: {} vs {want}", out[j]);
            }
        }
    }

    #[test]
    fn higher_quality_rejects_more_aliasing() {
        // 22.4 kHz folds to 21.7 kHz when taken to 44.1 kHz; it should be removed.
        let input = tone(22_400.0, 96000.0, 96000 / 2);
        let leak = |q: f64, filter: bool| {
            let mut out = vec![0.0; 22050];
            resample_q(&input, 96000.0, 44100.0, &mut out, q, filter);
            rms(&out[2000..20000])
        };
        let low = leak(0.0, true);
        let high = leak(100.0, true);
        assert!(high < low, "{high} vs {low}");
        assert!(high < 1e-4, "{high}");
        // Without the filter the cutoff sits at Nyquist and that tone partly survives.
        assert!(leak(100.0, false) > high * 10.0);
    }

    #[test]
    fn pads_requested_output_past_the_input() {
        let input = vec![0.5f32; 100];
        let mut out = vec![1.0; 400];
        resample_q(&input, 22050.0, 44100.0, &mut out, 50.0, true);
        assert!(out[399].abs() < 1e-6);
        assert!((out[100] - 0.5).abs() < 0.01);
    }
}
