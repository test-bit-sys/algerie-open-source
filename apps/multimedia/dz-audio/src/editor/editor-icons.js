// Glyphs used by the waveform editor's HUD, overview and zoom bar, on the
// shared 24px grid (see ui/icons.js).

import { Pin } from 'lucide';
import { registerIcons } from '../ui/icons.js';

registerIcons({
  pin: Pin,
  // HUD: a rising level ramp and a knob with its pointer at the top.
  'hud-level': [['path', { d: 'M4 19h1M8 19v-3M12 19v-6M16 19v-9M20 19V7' }]],
  'hud-knob': [['circle', { cx: '12', cy: '12', r: '8' }], ['path', { d: 'M12 12V4' }]],
  // Zoom bar extras: back to the default time zoom, and fit the selected track.
  'zoom-reset': [['circle', { cx: '13', cy: '12', r: '5' }], ['path', { d: 'm16.5 15.5 4 4' }], ['path', { d: 'M3.5 9A9 9 0 0 1 9 3.5' }], ['path', { d: 'M3 4v5h5' }]],
  'zoom-in-track': [['circle', { cx: '14', cy: '11', r: '5' }], ['path', { d: 'm17.5 14.5 3.5 3.5M12 11h4M14 9v4' }], ['path', { d: 'M3 4h4M3 20h4M5 4v16' }]],
});
