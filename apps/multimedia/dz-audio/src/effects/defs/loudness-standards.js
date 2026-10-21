// Loudness Meter standards, shared by its definition and its dialog view.

/**
 * Loudness targets the meter can follow: choosing one sets the target and
 * the true peak ceiling; changing either by hand switches to Custom.
 */
export const LOUDNESS_STANDARDS = [
  { label: 'EBU R128 (-23 LUFS)', target: -23, peakCeiling: -1 },
  { label: 'ATSC A/85 (-24 LKFS)', target: -24, peakCeiling: -2 },
  { label: 'Music streaming (-14 LUFS)', target: -14, peakCeiling: -1 },
  { label: 'Podcast (-16 LUFS)', target: -16, peakCeiling: -1 },
  { label: 'Film dialogue (-27 LUFS)', target: -27, peakCeiling: -2 },
  { label: 'Custom' },
];
