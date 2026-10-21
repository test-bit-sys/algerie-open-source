// Builds wasm/dsp (Rust) into src/audio/dsp.wasm. The built file is committed,
// so the app builds without a Rust toolchain; run this after editing the crate.
// CARGO_TARGET_DIR may point at a shared directory to save disk space.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const crate = path.join(root, 'wasm/dsp');
const targetDir = process.env.CARGO_TARGET_DIR || path.join(root, 'wasm/target');
execFileSync('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown', '--target-dir', targetDir], {
  cwd: crate,
  stdio: 'inherit',
  env: { ...process.env, RUSTFLAGS: '-C target-feature=+simd128' },
});
const out = path.join(targetDir, 'wasm32-unknown-unknown/release/dsp.wasm');
fs.copyFileSync(out, path.join(root, 'src/audio/dsp.wasm'));
console.log(`dsp.wasm: ${fs.statSync(out).size} bytes`);
