//! Effect group: Stereo Imagery (kinds 110..119).
//!
//!   110 stereoExpander   111 centerChannelExtractor   112 graphicPhaseShifter

mod center;
mod expander;
mod phase;

use super::Effect;

pub fn create(kind: u32, rate: f32, channels: usize) -> Option<Box<dyn Effect>> {
    Some(match kind {
        110 => Box::new(expander::StereoExpander::new(rate, channels)),
        111 => Box::new(center::CenterExtractor::new(rate, channels)),
        112 => Box::new(phase::PhaseShifter::new(rate, channels)),
        _ => return None,
    })
}
