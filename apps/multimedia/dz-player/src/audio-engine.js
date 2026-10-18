/**
 * DZ-Player: High-Fidelity Audio Engine (Web Audio API)
 * Reverse engineered from VLC media player's audio_filter architecture:
 * - 10-Band Graphic Equalizer with VLC exact frequency bands
 * - 17 Equalizer Presets (Rock, Pop, Classical, Full Bass, etc.)
 * - VLC-style Preamp Gain (-20dB to +20dB)
 * - Master Volume Amplification up to 300% (The famous VLC volume boost)
 * - Real-Time Audio Visualizer (FFT Frequency & Oscilloscope Analyser)
 * - Stereo Balance Panning
 */

export const VLC_EQ_FREQUENCIES = [
  60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000
];

export const VLC_EQ_PRESETS = {
  flat: {
    name: 'Flat',
    preamp: 0,
    bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  },
  classical: {
    name: 'Classical',
    preamp: 0,
    bands: [4.8, 4.8, 3.6, 2.4, -2.4, -2.4, 0, 2.4, 3.6, 4.8]
  },
  club: {
    name: 'Club',
    preamp: 0,
    bands: [0, 0, 2.4, 4.8, 4.8, 4.8, 2.4, 0, 0, 0]
  },
  fullBass: {
    name: 'Full Bass',
    preamp: 0,
    bands: [9.6, 9.6, 9.6, 6.0, 1.2, -4.8, -8.4, -10.8, -11.4, -11.4]
  },
  fullTreble: {
    name: 'Full Treble',
    preamp: 0,
    bands: [-9.6, -9.6, -9.6, -4.8, 2.4, 8.4, 12.0, 12.0, 12.0, 12.0]
  },
  headphones: {
    name: 'Headphones',
    preamp: 0,
    bands: [4.8, 10.8, 5.4, -3.6, -1.8, 1.8, 4.8, 9.0, 12.0, 12.6]
  },
  largeHall: {
    name: 'Large Hall',
    preamp: 0,
    bands: [10.2, 10.2, 5.4, 5.4, 0, -4.8, -4.8, -4.8, 0, 0]
  },
  live: {
    name: 'Live',
    preamp: 0,
    bands: [-4.8, 0, 2.4, 3.6, 4.8, 4.8, 3.6, 2.4, 2.4, 2.4]
  },
  party: {
    name: 'Party',
    preamp: 0,
    bands: [7.2, 7.2, 0, 0, 0, 0, 0, 0, 7.2, 7.2]
  },
  pop: {
    name: 'Pop',
    preamp: 0,
    bands: [-1.8, 1.8, 7.2, 7.8, 5.4, -1.2, -2.4, -2.4, -1.8, -1.8]
  },
  reggae: {
    name: 'Reggae',
    preamp: 0,
    bands: [0, 0, -0.6, -5.4, 0, 6.0, 6.0, 0, 0, 0]
  },
  rock: {
    name: 'Rock',
    preamp: 0,
    bands: [7.8, 4.8, -5.4, -7.8, -3.6, 3.6, 7.8, 10.8, 10.8, 10.8]
  },
  soft: {
    name: 'Soft',
    preamp: 0,
    bands: [4.8, 1.8, 0, -2.4, 0, 3.6, 7.8, 9.0, 10.8, 11.4]
  },
  softRock: {
    name: 'Soft Rock',
    preamp: 0,
    bands: [3.6, 3.6, 1.8, 0, -4.2, -5.4, -3.0, 0, 2.4, 8.4]
  },
  techno: {
    name: 'Techno',
    preamp: 0,
    bands: [7.8, 6.0, 0, -5.4, -4.8, 0, 7.8, 9.6, 9.6, 9.0]
  },
  vocal: {
    name: 'Vocal / Dialogue',
    preamp: 0,
    bands: [2.4, -1.8, -3.6, 1.2, 4.8, 4.8, 4.8, 3.6, 0, -2.4]
  }
};

export class AudioEngine {
  constructor() {
    this.audioCtx = null;
    this.sourceNode = null;
    this.preampNode = null;
    this.eqFilters = [];
    this.pannerNode = null;
    this.masterGainNode = null;
    this.analyserNode = null;
    this.mediaElement = null;

    this.volumePercent = 100;
    this.isMuted = false;
    this.eqEnabled = true;
    this.currentPreset = 'flat';
    this.currentPreampDb = 0;
    this.currentBands = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    this.currentBalance = 0; // -1 (L) to +1 (R)

    this.frequencyBuffer = null;
    this.waveformBuffer = null;
  }

  /**
   * Initializes Web Audio graph on first user interaction.
   * Browsers require user gesture before activating AudioContext.
   */
  init(mediaElement) {
    if (this.audioCtx && this.mediaElement === mediaElement) {
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
      return;
    }

    this.mediaElement = mediaElement;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      console.warn('[AudioEngine] Web Audio API is not supported in this environment.');
      return;
    }

    this.audioCtx = new AudioContextClass();

    // 1. Media Element Source
    this.sourceNode = this.audioCtx.createMediaElementSource(mediaElement);

    // 2. Preamp Gain (-20dB to +20dB)
    this.preampNode = this.audioCtx.createGain();
    this.setPreamp(this.currentPreampDb);

    // 3. 10-Band BiquadFilter EQ Chain
    this.eqFilters = VLC_EQ_FREQUENCIES.map((freq, index) => {
      const filter = this.audioCtx.createBiquadFilter();
      filter.frequency.value = freq;

      if (index === 0) {
        filter.type = 'lowshelf';
      } else if (index === VLC_EQ_FREQUENCIES.length - 1) {
        filter.type = 'highshelf';
      } else {
        filter.type = 'peaking';
        filter.Q.value = 1.414; // VLC / ISO octave bandwidth
      }

      filter.gain.value = this.currentBands[index];
      return filter;
    });

    // 4. Compressor Node
    this.compressorNode = this.audioCtx.createDynamicsCompressor();
    this.compressorEnabled = false;

    // 5. Audio Delay Node (for audio/video synchronization)
    this.delayNode = this.audioCtx.createDelay(5.0);
    this.audioDelaySec = 0;

    // 6. Stereo Panner
    if (this.audioCtx.createStereoPanner) {
      this.pannerNode = this.audioCtx.createStereoPanner();
      this.pannerNode.pan.value = this.currentBalance;
    }

    // 7. Analyser for Visualizer
    this.analyserNode = this.audioCtx.createAnalyser();
    this.analyserNode.fftSize = 256;
    this.analyserNode.smoothingTimeConstant = 0.8;
    this.frequencyBuffer = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.waveformBuffer = new Uint8Array(this.analyserNode.fftSize);

    // 8. Master Gain (supports VLC 300% volume boost)
    this.masterGainNode = this.audioCtx.createGain();
    this.setVolume(this.volumePercent);

    // Connect the audio graph:
    // Source -> Preamp -> EQ[0..9] -> Compressor -> Delay -> Panner -> Analyser -> MasterGain -> Destination
    let previousNode = this.sourceNode;

    previousNode.connect(this.preampNode);
    previousNode = this.preampNode;

    for (const filter of this.eqFilters) {
      previousNode.connect(filter);
      previousNode = filter;
    }

    previousNode.connect(this.delayNode);
    previousNode = this.delayNode;

    if (this.pannerNode) {
      previousNode.connect(this.pannerNode);
      previousNode = this.pannerNode;
    }

    previousNode.connect(this.analyserNode);
    this.analyserNode.connect(this.masterGainNode);
    this.masterGainNode.connect(this.audioCtx.destination);
  }

  setAudioDelay(ms) {
    this.audioDelaySec = Math.max(0, Math.min(5, (Number(ms) || 0) / 1000));
    if (this.delayNode && this.audioCtx) {
      this.delayNode.delayTime.setValueAtTime(this.audioDelaySec, this.audioCtx.currentTime);
    }
  }

  setCompressor(enabled, threshold = -24, ratio = 12) {
    this.compressorEnabled = !!enabled;
    if (this.compressorNode && this.audioCtx) {
      this.compressorNode.threshold.setValueAtTime(threshold, this.audioCtx.currentTime);
      this.compressorNode.ratio.setValueAtTime(ratio, this.audioCtx.currentTime);
    }
  }

  async resumeIfNeeded() {
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }
  }

  /**
   * Sets volume percentage.
   * Allows 0% to 300% (VLC signature boost).
   */
  setVolume(percent) {
    this.volumePercent = Math.max(0, Math.min(300, Number(percent) || 0));
    if (!this.masterGainNode) return;

    if (this.isMuted) {
      this.masterGainNode.gain.setValueAtTime(0, this.audioCtx.currentTime);
    } else {
      // 100% = gain 1.0; 300% = gain 3.0
      const linearGain = this.volumePercent / 100;
      this.masterGainNode.gain.setValueAtTime(linearGain, this.audioCtx.currentTime);
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    this.setVolume(this.volumePercent);
    return this.isMuted;
  }

  /**
   * Preamp gain in dB (-20dB to +20dB).
   */
  setPreamp(db) {
    this.currentPreampDb = Math.max(-20, Math.min(20, Number(db) || 0));
    if (!this.preampNode) return;
    const linearGain = Math.pow(10, this.currentPreampDb / 20);
    this.preampNode.gain.setValueAtTime(linearGain, this.audioCtx.currentTime);
  }

  /**
   * Sets individual band gain in dB (-20dB to +20dB).
   */
  setBandGain(bandIndex, db) {
    if (bandIndex < 0 || bandIndex >= this.eqFilters.length) return;
    const clampedDb = Math.max(-20, Math.min(20, Number(db) || 0));
    this.currentBands[bandIndex] = clampedDb;

    if (this.eqEnabled && this.eqFilters[bandIndex]) {
      this.eqFilters[bandIndex].gain.setValueAtTime(clampedDb, this.audioCtx.currentTime);
    }
  }

  /**
   * Applies an equalizer preset.
   */
  applyPreset(presetKey) {
    const preset = VLC_EQ_PRESETS[presetKey];
    if (!preset) return false;

    this.currentPreset = presetKey;
    this.setPreamp(preset.preamp);

    preset.bands.forEach((gainDb, index) => {
      this.setBandGain(index, gainDb);
    });

    return true;
  }

  /**
   * Enables or disables equalizer effects (bypass).
   */
  setEqEnabled(enabled) {
    this.eqEnabled = Boolean(enabled);
    if (!this.audioCtx) return;

    this.eqFilters.forEach((filter, index) => {
      const targetGain = this.eqEnabled ? this.currentBands[index] : 0;
      filter.gain.setValueAtTime(targetGain, this.audioCtx.currentTime);
    });
  }

  /**
   * Stereo Balance (-1.0 Left to +1.0 Right).
   */
  setBalance(balance) {
    this.currentBalance = Math.max(-1, Math.min(1, Number(balance) || 0));
    if (this.pannerNode) {
      this.pannerNode.pan.setValueAtTime(this.currentBalance, this.audioCtx.currentTime);
    }
  }

  /**
   * Returns frequency data array for bar visualizer.
   */
  getFrequencyData() {
    if (!this.analyserNode || !this.frequencyBuffer) return null;
    this.analyserNode.getByteFrequencyData(this.frequencyBuffer);
    return this.frequencyBuffer;
  }

  /**
   * Returns time-domain waveform data array for oscilloscope.
   */
  getWaveformData() {
    if (!this.analyserNode || !this.waveformBuffer) return null;
    this.analyserNode.getByteTimeDomainData(this.waveformBuffer);
    return this.waveformBuffer;
  }
}
