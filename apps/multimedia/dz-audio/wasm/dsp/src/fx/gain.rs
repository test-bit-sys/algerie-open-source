//! Amplify: per-channel gain in dB, optionally linked.
//! Params: 0 = left/first gain dB, 1 = right/second gain dB, 2 = linked (0/1).

use super::{db_to_gain, Effect, Smooth};

pub struct Gain {
    gains: Vec<Smooth>,
    db: [f32; 2],
    linked: bool,
}

impl Gain {
    pub fn new(rate: f32, channels: usize) -> Gain {
        Gain { gains: (0..channels).map(|_| Smooth::new(1.0, rate, 10.0)).collect(), db: [0.0; 2], linked: true }
    }
    fn update(&mut self) {
        for (c, g) in self.gains.iter_mut().enumerate() {
            let db = if self.linked { self.db[0] } else { self.db[c.min(1)] };
            g.target = db_to_gain(db);
        }
    }
}

impl Effect for Gain {
    fn set_param(&mut self, idx: u32, value: f32) {
        match idx {
            0 => self.db[0] = value,
            1 => self.db[1] = value,
            2 => self.linked = value >= 0.5,
            _ => {}
        }
        self.update();
    }
    fn process(&mut self, buf: &mut [f32], channels: usize, frames: usize) {
        for c in 0..channels {
            let g = &mut self.gains[c];
            for x in &mut buf[c * frames..(c + 1) * frames] {
                *x *= g.next();
            }
        }
    }
    fn reset(&mut self) {
        for g in &mut self.gains {
            g.settle();
        }
    }
}
