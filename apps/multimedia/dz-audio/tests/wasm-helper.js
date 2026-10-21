// Loads the committed dsp.wasm synchronously for tests that exercise Rust kernels.
import fs from 'node:fs';
import path from 'node:path';
import { Dsp } from '../src/audio/dsp.js';

let instance = null;
export function testDsp() {
  if (!instance) {
    const bytes = fs.readFileSync(path.resolve(process.cwd(), 'src/audio/dsp.wasm'));
    instance = new Dsp(new WebAssembly.Instance(new WebAssembly.Module(bytes), {}));
  }
  return instance;
}
