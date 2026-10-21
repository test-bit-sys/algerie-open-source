// Spectral display, spectral editing and the analysis panels (Frequency
// Analysis, Amplitude Statistics, Phase Meter, Match Loudness).

import { installSpectral } from '../spectral/install.js';
import { installAnalysis } from '../analysis/install.js';

export function installSpectralAnalysis(app) {
  installSpectral(app);
  installAnalysis(app);
}
