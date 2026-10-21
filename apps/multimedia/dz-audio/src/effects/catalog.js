// Registers every effect definition (imported for side effects). One module
// per menu group under ./defs; definitions are plain data plus optional
// offline `run` functions, with no DOM access, so the catalog also loads in
// the offline effect worker.

import './defs/filter.js';
import './defs/amplitude.js';
import './defs/delay.js';
import './defs/modulation.js';
import './defs/reverb.js';
import './defs/special.js';
import './defs/stereo.js';
import './defs/time-pitch.js';
import './defs/restoration.js';
import './defs/diagnostics.js';
