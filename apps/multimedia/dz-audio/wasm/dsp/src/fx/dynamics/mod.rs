//! Effect group: dynamics (kinds 30..59). Amplitude and Compression effects
//! plus the Loudness Maximizer.
//!
//!   30 Hard Limiter          31 Single-band Compressor   32 Dynamics
//!   33 Multiband Compressor  34 Tube Compressor          35 DeEsser
//!   36 Speech Volume Leveler 37 Channel Mixer            38 Loudness Maximizer
//!   39 Dynamics Processing (drawn transfer curve)

use super::Effect;

mod common;
mod compressor;
mod curve;
mod deesser;
#[allow(clippy::module_inception)]
mod dynamics;
mod leveler;
mod limiter;
mod mixer;
mod multiband;

pub fn create(kind: u32, rate: f32, channels: usize) -> Option<Box<dyn Effect>> {
    Some(match kind {
        30 => Box::new(limiter::HardLimiter::new(rate, channels)),
        31 => Box::new(compressor::Compressor::new(rate, channels)),
        32 => Box::new(dynamics::Dynamics::new(rate, channels)),
        33 => Box::new(multiband::Multiband::new(rate, channels)),
        34 => Box::new(compressor::TubeCompressor::new(rate, channels)),
        35 => Box::new(deesser::DeEsser::new(rate, channels)),
        36 => Box::new(leveler::Leveler::new(rate, channels)),
        37 => Box::new(mixer::ChannelMixer::new(rate, channels)),
        38 => Box::new(limiter::LoudnessMaximizer::new(rate, channels)),
        39 => Box::new(curve::CurveDynamics::new(rate, channels)),
        _ => return None,
    })
}

#[cfg(test)]
mod bench {
    use crate::fx::testutil::*;
    #[test]
    #[ignore]
    fn timing() {
        let x = noise(48000, 0.5, 1);
        for kind in 30..=39 {
            let mut fx = make(kind, 48000.0, 2);
            let mut best = f64::MAX;
            for _ in 0..30 {
                let t = std::time::Instant::now();
                run_stereo(fx.as_mut(), &x, &x);
                best = best.min(t.elapsed().as_secs_f64() * 1000.0);
            }
            eprintln!("kind {kind}: {best:.2} ms");
        }
        let mut fx = make(33, 48000.0, 2);
        for b in 0..4 { fx.set_param(3 + 7 * b + 6, 1.0); }
        fx.set_param(32, 0.0);
        let mut best = f64::MAX;
        for _ in 0..20 {
            let t = std::time::Instant::now();
            run_stereo(fx.as_mut(), &x, &x);
            best = best.min(t.elapsed().as_secs_f64() * 1000.0);
        }
        eprintln!("multiband split only: {best:.2} ms");
    }
}
