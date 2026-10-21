//! Effect group: Modulation (kinds 70..79).
//!   70 Chorus          multi-voice modulated delays
//!   71 Flanger         swept short delay with feedback
//!   72 Phaser          swept all-pass stages with feedback
//!   73 Chorus/Flanger  a simple combined unit

mod chorus;
mod chorus_flanger;
mod flanger;
mod phaser;

use super::Effect;

pub fn create(kind: u32, rate: f32, channels: usize) -> Option<Box<dyn Effect>> {
    match kind {
        70 => Some(Box::new(chorus::Chorus::new(rate, channels))),
        71 => Some(Box::new(flanger::Flanger::new(rate, channels))),
        72 => Some(Box::new(phaser::Phaser::new(rate, channels))),
        73 => Some(Box::new(chorus_flanger::ChorusFlanger::new(rate, channels))),
        _ => None,
    }
}

/// Fast sine of a phase in cycles (max error about 0.001), for LFOs.
#[inline]
pub fn fsin(p: f32) -> f32 {
    let mut x = p - p.floor();
    if x > 0.5 {
        x -= 1.0;
    }
    let t = x * std::f32::consts::TAU;
    let y = 1.273_239_5 * t - 0.405_284_73 * t * t.abs();
    0.225 * (y * y.abs() - y) + y
}

/// Triangle of a phase in cycles, in [-1, 1], peaking at phase 0.25.
#[inline]
pub fn ftri(p: f32) -> f32 {
    let x = p - p.floor();
    if x < 0.25 {
        4.0 * x
    } else if x < 0.75 {
        2.0 - 4.0 * x
    } else {
        4.0 * x - 4.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fast_waves_match() {
        for i in 0..1000 {
            let p = i as f32 / 997.0 * 3.0 - 1.0;
            assert!((fsin(p) - (std::f32::consts::TAU * p).sin()).abs() < 2e-3, "{p}");
            assert!(ftri(p).abs() <= 1.0);
        }
        assert!((ftri(0.25) - 1.0).abs() < 1e-6 && (ftri(0.75) + 1.0).abs() < 1e-6);
    }
}
