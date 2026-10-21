//! Effect group: Time and Pitch (kinds 120..129).
//!
//! Realtime: 120 Pitch Shifter, 121 Automatic Pitch Correction.
//! Offline (C ABI below, used by Stretch and Pitch, Pitch Bender and Manual
//! Pitch Correction): a streamed job that takes planar input chunks and gives
//! back finished output as it is ready.

pub mod apc;
pub mod core;
pub mod offline;
pub mod shifter;

use super::Effect;
use offline::{Job, Resampler, Vocoder, Wsola};

pub fn create(kind: u32, rate: f32, channels: usize) -> Option<Box<dyn Effect>> {
    match kind {
        120 => Some(Box::new(shifter::PitchShifter::new(rate, channels))),
        121 => Some(Box::new(apc::AutoPitch::new(rate, channels))),
        _ => None,
    }
}

/// Starts an offline time/pitch job.
/// - `mode` 0: phase vocoder (`stretch` = output/input length, `pitch` ratio,
///   `precision` 0..2, flags bit 0 lock channels, bit 1 preserve formants).
/// - `mode` 1: WSOLA time stretch by `stretch`, then resampling for `pitch`.
/// - `mode` 2: varispeed resampling at speed `pitch` (input frames per output
///   frame; length becomes input / speed, `stretch` is ignored); `precision`
///   2..64 is the sinc kernel's zero crossings per side (below 2: 16).
/// A curve set with `tp_curve` overrides the constant pitch (modes 0 and 2).
#[no_mangle]
pub extern "C" fn tp_new(mode: u32, channels: u32, rate: f32, precision: u32, stretch: f64, pitch: f32, flags: u32) -> u32 {
    let ch = (channels as usize).clamp(1, 2);
    let job = match mode {
        0 => Job::Vocoder(Vocoder::new(ch, rate, precision, stretch, pitch, flags & 1 != 0, flags & 2 != 0)),
        1 => {
            let p = pitch.clamp(0.125, 8.0);
            let res = if (p - 1.0).abs() > 1e-6 { Some(Resampler::new(ch, p)) } else { None };
            Job::Wsola(Wsola::new(ch, rate, stretch * p as f64), res)
        }
        _ => Job::Resample(if precision >= 2 { Resampler::with_zeros(ch, pitch, precision as usize) } else { Resampler::new(ch, pitch) }),
    };
    Box::into_raw(Box::new((job, ch))) as u32
}

/// Sets a curve of `len / 2` (input frame, value) pairs: the pitch ratio for
/// the vocoder, the speed for varispeed.
#[no_mangle]
pub extern "C" fn tp_curve(h: u32, ptr: u32, len: u32) {
    let (job, _) = unsafe { &mut *(h as *mut (Job, usize)) };
    let d = unsafe { crate::slice(ptr, len) };
    match job {
        Job::Vocoder(v) => v.pitch.set(d),
        Job::Resample(r) => r.speed.set(d),
        Job::Wsola(..) => {}
    }
}

/// Pushes `frames` planar frames (channel c at ptr + c * frames).
#[no_mangle]
pub extern "C" fn tp_push(h: u32, ptr: u32, frames: u32) {
    let (job, ch) = unsafe { &mut *(h as *mut (Job, usize)) };
    let d = unsafe { crate::slice(ptr, frames * *ch as u32) };
    job.push(d, frames as usize);
}

/// Marks the end of the input and flushes the remaining output.
#[no_mangle]
pub extern "C" fn tp_finish(h: u32) {
    let (job, _) = unsafe { &mut *(h as *mut (Job, usize)) };
    job.finish();
}

/// Frames of finished output waiting to be pulled.
#[no_mangle]
pub extern "C" fn tp_available(h: u32) -> u32 {
    let (job, _) = unsafe { &mut *(h as *mut (Job, usize)) };
    job.available() as u32
}

/// Moves up to `max` frames into `ptr` (planar with stride `max`); returns the count.
#[no_mangle]
pub extern "C" fn tp_pull(h: u32, ptr: u32, max: u32) -> u32 {
    let (job, ch) = unsafe { &mut *(h as *mut (Job, usize)) };
    let d = unsafe { crate::slice_mut(ptr, max * *ch as u32) };
    job.pull(d, max as usize) as u32
}

#[no_mangle]
pub extern "C" fn tp_free(h: u32) {
    if h != 0 {
        unsafe { drop(Box::from_raw(h as *mut (Job, usize))) }
    }
}

#[cfg(test)]
mod bench {
    use crate::fx::testutil::{noise, run_stereo};
    use crate::fx::util::Stft;
    use crate::fx::Effect;

    struct Ident(Stft);
    impl Effect for Ident {
        fn set_param(&mut self, _: u32, _: f32) {}
        fn process(&mut self, buf: &mut [f32], _: usize, frames: usize) {
            self.0.process(buf, frames, |_, _| {});
        }
    }

    #[test]
    #[ignore]
    fn timings() {
        let l = noise(48000, 0.3, 1);
        let r = noise(48000, 0.3, 2);
        let mut cases: Vec<(&str, Box<dyn Effect>)> = vec![
            ("stft 2048", Box::new(Ident(Stft::new(2048, 4, 2)))),
            ("shifter 1.0", super::create(120, 48000.0, 2).unwrap()),
            ("shifter +5", {
                let mut f = super::create(120, 48000.0, 2).unwrap();
                f.set_param(0, 5.0);
                f
            }),
            ("apc", super::create(121, 48000.0, 2).unwrap()),
        ];
        for (name, fx) in cases.iter_mut() {
            run_stereo(fx.as_mut(), &l, &r);
            let t = std::time::Instant::now();
            for _ in 0..5 {
                run_stereo(fx.as_mut(), &l, &r);
            }
            println!("{name}: {:.2} ms per second", t.elapsed().as_secs_f64() * 1000.0 / 5.0);
        }
    }
}
