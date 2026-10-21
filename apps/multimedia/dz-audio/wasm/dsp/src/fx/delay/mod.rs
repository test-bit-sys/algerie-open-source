//! Effect group: Delay and Echo (kinds 60..69).
//!   60 Delay         simple per-channel delay with mix and invert
//!   61 Echo          feedback echo with bounce and successive echo EQ
//!   62 Analog Delay  tape, tape and tube, or bucket brigade style delay
//!
//! Also holds small helpers shared with the modulation and reverb groups.

mod analog;
mod echo;
mod simple;

use super::Effect;

pub fn create(kind: u32, rate: f32, channels: usize) -> Option<Box<dyn Effect>> {
    match kind {
        60 => Some(Box::new(simple::Delay::new(rate, channels))),
        61 => Some(Box::new(echo::Echo::new(rate, channels))),
        62 => Some(Box::new(analog::AnalogDelay::new(rate, channels))),
        _ => None,
    }
}

/// Longest tail any feedback effect reports, in seconds.
pub const MAX_TAIL_SECONDS: f64 = 30.0;

/// Frames until a feedback loop with per-pass gain `g` and pass length
/// `delay` frames decays by 60 dB (capped). Mirrored in src/effects/defs/delay.js.
pub fn feedback_tail(delay: f64, g: f64, rate: f32) -> u32 {
    let cap = MAX_TAIL_SECONDS * rate as f64;
    let t = if g <= 1e-3 {
        delay
    } else if g >= 0.999 {
        cap
    } else {
        delay * ((-3.0 / g.log10()).ceil() + 1.0)
    };
    t.min(cap).max(0.0).round() as u32
}

/// Rational tanh approximation (exact at 0, saturates at +-1 beyond |x| = 3).
#[inline]
pub fn tanh_r(x: f32) -> f32 {
    let x = x.clamp(-3.0, 3.0);
    x * (27.0 + x * x) / (27.0 + 9.0 * x * x)
}

/// Transparent below 0.8, then a soft knee toward 1.0: keeps feedback loops
/// bounded without colouring normal levels.
#[inline]
pub fn soft_limit(x: f32) -> f32 {
    let a = x.abs();
    if a <= 0.8 {
        x
    } else {
        let y = 0.8 + 0.2 * tanh_r((a - 0.8) * 5.0);
        y.copysign(x)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tail_formula() {
        assert_eq!(feedback_tail(1000.0, 0.0, 48000.0), 1000);
        // 0.5 per pass: 10 passes to -60 dB, plus the first.
        assert_eq!(feedback_tail(1000.0, 0.5, 48000.0), 11000);
        assert_eq!(feedback_tail(1000.0, 1.0, 48000.0), 30 * 48000);
    }

    #[test]
    fn limiters_are_bounded_and_transparent() {
        assert_eq!(soft_limit(0.5), 0.5);
        assert!(soft_limit(10.0) <= 1.0 && soft_limit(-10.0) >= -1.0);
        assert!((tanh_r(0.1) - 0.1f32.tanh()).abs() < 1e-3);
    }
}
