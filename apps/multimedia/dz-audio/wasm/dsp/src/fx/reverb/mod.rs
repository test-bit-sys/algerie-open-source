//! Effect group: Reverb (kinds 80..89).
//!   80 Studio Reverb       FDN room with early reflections, damping, width
//!   81 Reverb              FDN with pre-delay and attack (build up) control
//!   82 Full Reverb         FDN with geometric early reflections and colouration EQ
//!   83 Convolution Reverb  two-level partitioned FFT convolution with an impulse
//!                          supplied through data slot 0

mod convolution;
mod fastfft;
mod fdn;
mod full;
mod simple;
mod studio;

use super::Effect;

pub fn create(kind: u32, rate: f32, channels: usize) -> Option<Box<dyn Effect>> {
    match kind {
        80 => Some(Box::new(studio::StudioReverb::new(rate, channels))),
        81 => Some(Box::new(simple::Reverb::new(rate, channels))),
        82 => Some(Box::new(full::FullReverb::new(rate, channels))),
        83 => Some(Box::new(convolution::ConvolutionReverb::new(rate, channels))),
        _ => None,
    }
}

/// Extra frames reported after the decay time for the algorithmic reverbs
/// (line lengths, early reflections). Mirrored in src/effects/defs/reverb.js.
pub const TAIL_PAD_MS: f64 = 250.0;

/// Tail of an algorithmic reverb: decay (T60) plus pre-delay plus padding.
pub fn reverb_tail(decay_ms: f32, predelay_ms: f32, rate: f32) -> u32 {
    ((decay_ms as f64 + predelay_ms as f64 + TAIL_PAD_MS) * rate as f64 / 1000.0).round() as u32
}

#[cfg(test)]
pub mod tests {
    use crate::fx::testutil::*;
    use crate::fx::Effect;

    /// Impulse response of a reverb (left channel), `secs` long.
    pub fn impulse_response(fx: &mut dyn Effect, secs: f32, rate: f32) -> (Vec<f32>, Vec<f32>) {
        let n = (secs * rate) as usize;
        let mut x = vec![0.0; n];
        x[0] = 1.0;
        run_stereo(fx, &x, &x)
    }

    /// Time in seconds for the energy decay curve to fall from -5 to -25 dB,
    /// extrapolated to 60 dB (a T20 estimate of T60).
    pub fn t60(ir: &[f32], rate: f32) -> f32 {
        let mut edc: Vec<f64> = vec![0.0; ir.len() + 1];
        for i in (0..ir.len()).rev() {
            edc[i] = edc[i + 1] + (ir[i] as f64).powi(2);
        }
        let total = edc[0].max(1e-30);
        let at = |db: f64| edc.iter().position(|&e| 10.0 * (e / total).log10() <= db).unwrap_or(ir.len());
        let (a, b) = (at(-5.0), at(-25.0));
        3.0 * (b - a) as f32 / rate
    }
}
