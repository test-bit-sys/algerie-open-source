//! Audio Studio DSP kernels, compiled to wasm32 and called through a plain C ABI.
//!
//! Buffers are planar f32 in linear memory. JavaScript allocates with `mem_alloc`,
//! copies samples in, calls a kernel and reads the result back. Long-lived DSP
//! state (effects, analyzers) lives behind opaque handles returned as u32.

pub mod fft;
pub mod flac;
pub mod fx;
pub mod limiter;
pub mod loudness;
pub mod md5;
pub mod peaks;
pub mod pitch;
pub mod resample;
pub mod spectral;
pub mod resample_stream;
pub mod spectrum;
pub mod stats;

use std::alloc::{alloc as raw_alloc, dealloc as raw_dealloc, Layout};

/// Allocates `bytes` bytes aligned to 16 and returns the pointer (0 on failure).
#[no_mangle]
pub extern "C" fn mem_alloc(bytes: u32) -> u32 {
    if bytes == 0 {
        return 0;
    }
    match Layout::from_size_align(bytes as usize, 16) {
        Ok(layout) => unsafe { raw_alloc(layout) as u32 },
        Err(_) => 0,
    }
}

/// Frees memory previously returned by `mem_alloc` with the same size.
#[no_mangle]
pub extern "C" fn mem_free(ptr: u32, bytes: u32) {
    if ptr == 0 || bytes == 0 {
        return;
    }
    if let Ok(layout) = Layout::from_size_align(bytes as usize, 16) {
        unsafe { raw_dealloc(ptr as *mut u8, layout) }
    }
}

pub(crate) unsafe fn slice<'a>(ptr: u32, len: u32) -> &'a [f32] {
    if len == 0 {
        return &[];
    }
    std::slice::from_raw_parts(ptr as *const f32, len as usize)
}

pub(crate) unsafe fn slice_mut<'a>(ptr: u32, len: u32) -> &'a mut [f32] {
    if len == 0 {
        return &mut [];
    }
    std::slice::from_raw_parts_mut(ptr as *mut f32, len as usize)
}
