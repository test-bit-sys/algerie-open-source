//! Effect group: Special (kinds 90..110) plus the offline kernels behind
//! Doppler Shifter, Delete Silence and Mark Audio.
//!   90 Distortion, 91 Guitar Suite, 92 Vocal Enhancer, 93 Mastering,
//!   94 Loudness Meter (pass-through measurement)

use super::Effect;

mod distortion;
mod guitar;
mod mastering;
mod meter;
pub mod offline;
mod shaper;
mod vocal;

pub fn create(kind: u32, rate: f32, channels: usize) -> Option<Box<dyn Effect>> {
    Some(match kind {
        90 => Box::new(distortion::Distortion::new(rate, channels)),
        91 => Box::new(guitar::GuitarSuite::new(rate, channels)),
        92 => Box::new(vocal::VocalEnhancer::new(rate, channels)),
        93 => Box::new(mastering::Mastering::new(rate, channels)),
        94 => Box::new(meter::LoudnessMeter::new(rate, channels)),
        _ => return None,
    })
}

#[cfg(test)]
mod bench {
    use crate::fx::testutil::*;

    /// Run with `cargo test --release bench_special -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn bench_special_effects() {
        let x = sine(220.0, 48000.0, 48000, 0.5);
        for kind in [90u32, 91, 92, 93] {
            let mut best = f64::MAX;
            for _ in 0..5 {
                let mut fx = make(kind, 48000.0, 2);
                let t = std::time::Instant::now();
                let _ = run_stereo(fx.as_mut(), &x, &x);
                best = best.min(t.elapsed().as_secs_f64() * 1000.0);
            }
            eprintln!("kind {kind}: {best:.2} ms per second of stereo");
        }
    }
}
