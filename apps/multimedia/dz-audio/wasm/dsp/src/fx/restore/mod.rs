//! Effect group: Noise Reduction / Restoration and the restoration side of
//! Diagnostics. Realtime kinds:
//!   130 DeHummer, 131 Hiss Reduction, 132 DeNoise, 133 DeReverb,
//!   134 Adaptive Noise Reduction, 135 Noise Reduction (noise print),
//!   136 Automatic Click Remover, 137 Automatic Phase Correction.
//! Offline kernels (C ABI below): noise print capture, click/pop
//! elimination, declipping and the Sound Remover's NMF model learning and
//! removal.

mod adaptive;
mod ar;
mod click;
mod declip;
mod dehummer;
mod denoise;
mod dereverb;
mod hiss;
mod nmf;
mod noise_reduction;
mod phase;
mod spectral;

use super::Effect;
use crate::{slice, slice_mut};

pub fn create(kind: u32, rate: f32, channels: usize) -> Option<Box<dyn Effect>> {
    Some(match kind {
        130 => Box::new(dehummer::DeHummer::new(rate, channels)),
        131 => Box::new(hiss::HissReduction::new(rate, channels)),
        132 => Box::new(denoise::DeNoise::new(rate, channels)),
        133 => Box::new(dereverb::DeReverb::new(rate, channels)),
        134 => Box::new(adaptive::AdaptiveNoiseReduction::new(rate, channels)),
        135 => Box::new(noise_reduction::NoiseReduction::new(rate, channels)),
        136 => Box::new(click::AutoClickRemover::new(rate, channels)),
        137 => Box::new(phase::AutoPhaseCorrection::new(rate, channels)),
        _ => return None,
    })
}

/// Adds the noise power profile of `len` samples at `src` (FFT size `fft`,
/// hop fft/4) into `acc` (fft/2 + 1 floats) and returns the frames added.
/// Divide the accumulated sums by the total frame count for the mean.
#[no_mangle]
pub extern "C" fn rs_noise_profile(src: u32, len: u32, fft: u32, acc: u32) -> u32 {
    let n = noise_reduction::fft_size(fft as f32);
    let x = unsafe { slice(src, len) };
    let a = unsafe { slice_mut(acc, (n / 2 + 1) as u32) };
    noise_reduction::accumulate_profile(x, n, a) as u32
}

/// Click/pop elimination in place over `len` samples; returns repaired runs.
#[no_mangle]
pub extern "C" fn rs_declick(buf: u32, len: u32, k: f32, disc: f32, max_run: u32, oversample: f32, passes: u32) -> u32 {
    let x = unsafe { slice_mut(buf, len) };
    let s = click::DeclickSettings { k, disc, max_run: max_run as usize, oversample, passes: passes as usize };
    click::declick(x, &s) as u32
}

/// Click detection only: finds clicks in `len` samples at `buf` (unchanged)
/// and writes up to `cap` runs to `out` as (start, length, peak) float
/// triples. Returns the number of runs found (may exceed `cap`).
#[no_mangle]
pub extern "C" fn rs_click_detect(buf: u32, len: u32, k: f32, disc: f32, max_run: u32, oversample: f32, out: u32, cap: u32) -> u32 {
    let x = unsafe { slice(buf, len) };
    let s = click::DeclickSettings { k, disc, max_run: max_run as usize, oversample, passes: 1 };
    let mut lsar = click::click_lsar(&s);
    let mut sc = click::ClickScratch::new(x.len());
    let mut runs = Vec::new();
    click::find_clicks(x, &s, &mut lsar, &mut sc, &mut runs);
    let o = unsafe { slice_mut(out, cap * 3) };
    for (i, r) in runs.iter().take(cap as usize).enumerate() {
        o[3 * i] = r.start as f32;
        o[3 * i + 1] = r.len as f32;
        o[3 * i + 2] = r.peak;
    }
    runs.len() as u32
}

/// Rebuilds `buf[start .. start + gap]` (of `len` samples) by least-squares
/// AR interpolation from up to 512 samples of context on each side (Fill
/// Single Click, and the Click/Pop Eliminator's repair of chosen clicks).
/// Returns 1 when the gap was filled, 0 when the context is too short.
#[no_mangle]
pub extern "C" fn rs_fill_gap(buf: u32, len: u32, start: u32, gap: u32) -> u32 {
    let x = unsafe { slice_mut(buf, len) };
    click::fill_gap(x, start as usize, gap as usize) as u32
}

/// Declipping in place over `len` samples; returns repaired runs.
#[no_mangle]
pub extern "C" fn rs_declip(buf: u32, len: u32, level: f32, min_run: u32, method: u32) -> u32 {
    let x = unsafe { slice_mut(buf, len) };
    declip::declip(x, level, min_run as usize, method) as u32
}

/// Learns a sound model: `k` NMF basis spectra of the mono sound at `src`
/// (`len` samples, FFT size `fft`, `iters` iterations), written k-major to
/// `out` (k x (fft/2 + 1) floats). Returns the number of STFT frames used.
#[no_mangle]
pub extern "C" fn rs_sound_learn(src: u32, len: u32, fft: u32, k: u32, iters: u32, out: u32) -> u32 {
    let n = nmf::fft_size(fft);
    let x = unsafe { slice(src, len) };
    let o = unsafe { slice_mut(out, k.max(1) * (n as u32 / 2 + 1)) };
    nmf::learn(x, n, k as usize, iters as usize, o) as u32
}

/// Removes a learned sound (`k` bases at `model`) from planar `buf`
/// (`channels` x `len`) in place. `floor_db` is the deepest attenuation
/// (negative dB); `speech` 1 protects the speech band.
#[no_mangle]
pub extern "C" fn rs_sound_remove(
    buf: u32,
    channels: u32,
    len: u32,
    fft: u32,
    model: u32,
    k: u32,
    k_free: u32,
    iters: u32,
    strength: f32,
    floor_db: f32,
    sensitivity: f32,
    speech: u32,
    rate: f32,
    enhance: f32,
) {
    let n = nmf::fft_size(fft);
    let b = unsafe { slice_mut(buf, channels * len) };
    let m = unsafe { slice(model, k * (n as u32 / 2 + 1)) };
    let s = nmf::RemoveSettings {
        n,
        k_free: k_free as usize,
        iters: iters as usize,
        strength: strength.clamp(0.0, 1.0),
        floor: 10f32.powf(floor_db.min(0.0) / 20.0),
        sensitivity,
        speech: speech != 0,
        rate,
        enhance,
    };
    nmf::remove(b, channels as usize, len as usize, m, k as usize, &s);
}
