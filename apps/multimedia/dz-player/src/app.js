/**
 * DZ-Player: Main Application Controller
 * Follows HeyPuter/everything standard: Vanilla JS ES Modules, zero emojis,
 * trilingual enterprise UI (AR/FR/EN), dark/light theme, keyboard shortcuts.
 */

import { AudioEngine, VLC_EQ_PRESETS, VLC_EQ_FREQUENCIES } from './audio-engine.js';
import { SubtitleEngine } from './subtitle-engine.js';
import { VideoEffects } from './video-effects.js';
import { Playlist } from './playlist.js';

const I18N = {
  ar: {
    appTitle: 'مشغل الوسائط المتعددة الجزائري',
    tagline: 'بديل VLC المفتوح المصدر',
    dropTitle: 'اسحب وأفلت ملفات الفيديو أو الصوت هنا',
    dropSubtitle: 'يدعم كافة صيغ الوسائط الشائعة (MP4, MKV, WebM, MP3, FLAC, WAV) مع كشف ذكي لترميز الترجمة العربية (Windows-1256)',
    openFile: 'فتح ملف وسائط',
    openSub: 'تحميل ملف ترجمة',
    equalizer: 'المُعادل الصوتي (Equalizer)',
    videoEffects: 'تأثيرات وأبعاد الفيديو',
    subtitles: 'إعدادات ومزامنة الترجمة',
    playlist: 'قائمة التشغيل',
    theme: 'المظهر',
    snapshot: 'التقاط صورة',
    pip: 'صورة داخل صورة',
    fullscreen: 'شاشة كاملة',
    preamp: 'المضخم الأولي (Preamp)',
    presets: 'الإعدادات المسبقة',
    aspectRatio: 'نسبة الأبعاد',
    geometry: 'تدوير وانعكاس الصورة',
    rotate: 'تدوير 90°',
    flipH: 'انعكاس أفقي',
    flipV: 'انعكاس رأسي',
    brightness: 'السطوع',
    contrast: 'التباين',
    saturation: 'التشبع',
    hue: 'درجة اللون',
    encoding: 'ترميز الخط العربي',
    autoDetect: 'كشف تلقائي ذكي',
    syncDelay: 'تأخير 50- م.ث (G)',
    syncAdvance: 'تقديم 50+ م.ث (H)',
    fontSize: 'حجم الخط',
    textColor: 'لون النص',
    bgStyle: 'نمط الخلفية',
    speed: 'سرعة التشغيل',
    emptyPlaylist: 'قائمة التشغيل فارغة',
    volume: 'الصوت',
    boostNotice: 'تضخيم فائق حتى 300%'
  },
  fr: {
    appTitle: 'Lecteur Multimédia DZ-Player',
    tagline: 'Alternative Open Source à VLC',
    dropTitle: 'Glissez-déposez vos fichiers vidéo ou audio ici',
    dropSubtitle: 'Prend en charge tous les formats multimédias (MP4, MKV, WebM, MP3, FLAC, WAV) avec détection intelligente des sous-titres arabes (Windows-1256)',
    openFile: 'Ouvrir un fichier',
    openSub: 'Charger des sous-titres',
    equalizer: 'Égaliseur Audio',
    videoEffects: 'Effets & Géométrie Vidéo',
    subtitles: 'Paramètres des Sous-titres',
    playlist: 'Liste de Lecture',
    theme: 'Thème',
    snapshot: 'Capture d\'écran',
    pip: 'Image dans l\'image',
    fullscreen: 'Plein écran',
    preamp: 'Préamplificateur',
    presets: 'Préréglages',
    aspectRatio: 'Format d\'image',
    geometry: 'Rotation et Miroir',
    rotate: 'Rotation 90°',
    flipH: 'Miroir horizontal',
    flipV: 'Miroir vertical',
    brightness: 'Luminosité',
    contrast: 'Contraste',
    saturation: 'Saturation',
    hue: 'Teinte',
    encoding: 'Encodage de texte',
    autoDetect: 'Détection auto intelligente',
    syncDelay: 'Délai -50ms (G)',
    syncAdvance: 'Avance +50ms (H)',
    fontSize: 'Taille du texte',
    textColor: 'Couleur du texte',
    bgStyle: 'Style de fond',
    speed: 'Vitesse de lecture',
    emptyPlaylist: 'Liste de lecture vide',
    volume: 'Volume',
    boostNotice: 'Amplification jusqu\'à 300%'
  },
  en: {
    appTitle: 'DZ-Player Multimedia Suite',
    tagline: 'Open Source VLC Alternative',
    dropTitle: 'Drag & Drop video or audio files here',
    dropSubtitle: 'Supports all modern media formats (MP4, MKV, WebM, MP3, FLAC, WAV) with intelligent Arabic subtitle encoding detection (Windows-1256)',
    openFile: 'Open Media File',
    openSub: 'Load Subtitles',
    equalizer: 'Audio Equalizer',
    videoEffects: 'Video Effects & Geometry',
    subtitles: 'Subtitle Settings & Sync',
    playlist: 'Playlist',
    theme: 'Theme',
    snapshot: 'Take Snapshot',
    pip: 'Picture-in-Picture',
    fullscreen: 'Fullscreen',
    preamp: 'Preamp',
    presets: 'Presets',
    aspectRatio: 'Aspect Ratio',
    geometry: 'Geometry & Transform',
    rotate: 'Rotate 90°',
    flipH: 'Flip Horizontal',
    flipV: 'Flip Vertical',
    brightness: 'Brightness',
    contrast: 'Contrast',
    saturation: 'Saturation',
    hue: 'Hue',
    encoding: 'Text Encoding',
    autoDetect: 'Smart Auto-Detect',
    syncDelay: 'Delay -50ms (G)',
    syncAdvance: 'Advance +50ms (H)',
    fontSize: 'Font Size',
    textColor: 'Text Color',
    bgStyle: 'Background Style',
    speed: 'Playback Speed',
    emptyPlaylist: 'Playlist is empty',
    volume: 'Volume',
    boostNotice: 'Boost amplification up to 300%'
  }
};

class DZPlayerApp {
  constructor() {
    this.currentLang = 'ar';
    this.theme = 'dark';

    // Subsystems
    this.audio = new AudioEngine();
    this.subtitle = new SubtitleEngine();
    this.playlist = new Playlist();
    this.effects = null; // initialized after video element binds

    // UI Elements
    this.video = document.getElementById('main-video');
    this.stage = document.getElementById('video-stage');
    this.playerContainer = document.getElementById('player-container');
    this.emptyState = document.getElementById('empty-state');
    this.subtitleOverlay = document.getElementById('subtitle-overlay');
    this.subtitleText = document.getElementById('subtitle-text');

    // Controls
    this.btnPlay = document.getElementById('btn-play');
    this.progressTrack = document.getElementById('progress-track');
    this.progressFill = document.getElementById('progress-fill');
    this.progressBuffered = document.getElementById('progress-buffered');
    this.timeCurrent = document.getElementById('time-current');
    this.timeDuration = document.getElementById('time-duration');
    this.volumeSlider = document.getElementById('volume-slider');
    this.volumeBadge = document.getElementById('volume-badge');
    this.btnMute = document.getElementById('btn-mute');

    // Modals
    this.modalEq = document.getElementById('modal-eq');
    this.modalEffects = document.getElementById('modal-effects');
    this.modalSubtitles = document.getElementById('modal-subtitles');
    this.playlistDrawer = document.getElementById('playlist-drawer');

    // Idle mouse hide timer
    this.idleTimer = null;
    this.visualizerAnimationId = null;

    this.init();
  }

  init() {
    this.effects = new VideoEffects(this.video, this.stage);
    this.setupLanguage(this.currentLang);
    this.setupTheme(this.theme);
    this.bindEvents();
    this.renderEqualizerUI();
    this.renderEffectsUI();
  }

  setupLanguage(lang) {
    this.currentLang = lang;
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';

    const t = I18N[lang];
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (t[key]) {
        el.textContent = t[key];
      }
    });

    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const key = el.getAttribute('data-i18n-title');
      if (t[key]) {
        el.title = t[key];
      }
    });
  }

  setupTheme(theme) {
    this.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
  }

  toggleTheme() {
    this.setupTheme(this.theme === 'dark' ? 'light' : 'dark');
  }

  showToast(message) {
    let toast = document.getElementById('app-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'app-toast';
      toast.className = 'toast-container';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 2200);
  }

  bindEvents() {
    // 1. Play / Pause
    this.btnPlay.addEventListener('click', () => this.togglePlay());
    this.video.addEventListener('click', () => this.togglePlay());

    this.video.addEventListener('play', () => {
      this.updatePlayButtonIcon(true);
      this.audio.resumeIfNeeded();
      this.startVisualizer();
    });

    this.video.addEventListener('pause', () => {
      this.updatePlayButtonIcon(false);
      this.stopVisualizer();
    });

    this.video.addEventListener('timeupdate', () => this.onTimeUpdate());
    this.video.addEventListener('progress', () => this.onProgress());
    this.video.addEventListener('loadedmetadata', () => this.onLoadedMetadata());
    this.video.addEventListener('ended', () => this.onTrackEnded());

    // 2. Timeline scrubbing
    let isScrubbing = false;
    const seekToPosition = (e) => {
      const rect = this.progressTrack.getBoundingClientRect();
      const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      if (this.video.duration) {
        this.video.currentTime = pos * this.video.duration;
      }
    };

    this.progressTrack.addEventListener('mousedown', (e) => {
      isScrubbing = true;
      seekToPosition(e);
    });

    window.addEventListener('mousemove', (e) => {
      if (isScrubbing) seekToPosition(e);
    });

    window.addEventListener('mouseup', () => {
      isScrubbing = false;
    });

    // 3. Volume & Boost
    this.volumeSlider.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      this.audio.init(this.video);
      this.audio.setVolume(val);
      this.volumeBadge.textContent = `${val}%`;
      if (val > 100) {
        this.volumeBadge.classList.add('boosted');
      } else {
        this.volumeBadge.classList.remove('boosted');
      }
    });

    this.btnMute.addEventListener('click', () => {
      this.audio.init(this.video);
      const isMuted = this.audio.toggleMute();
      this.volumeSlider.value = isMuted ? 0 : this.audio.volumePercent;
      this.volumeBadge.textContent = isMuted ? '0%' : `${this.audio.volumePercent}%`;
    });

    // 4. File input & drag and drop
    const fileInput = document.getElementById('file-input');
    const subInput = document.getElementById('sub-input');

    document.getElementById('btn-open-file')?.addEventListener('click', () => fileInput.click());
    document.getElementById('btn-empty-open')?.addEventListener('click', () => fileInput.click());
    document.getElementById('btn-open-sub')?.addEventListener('click', () => subInput.click());

    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length) {
        this.loadFiles(e.target.files);
      }
    });

    subInput.addEventListener('change', async (e) => {
      if (e.target.files.length) {
        await this.loadSubtitleFile(e.target.files[0]);
      }
    });

    // Stage Drag and Drop
    this.stage.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });

    this.stage.addEventListener('drop', async (e) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files);
      const subFiles = files.filter((f) => /\.(srt|vtt|sub|ass)$/i.test(f.name));
      const mediaFiles = files.filter((f) => !/\.(srt|vtt|sub|ass)$/i.test(f.name));

      if (mediaFiles.length) {
        this.loadFiles(mediaFiles);
      }
      if (subFiles.length) {
        await this.loadSubtitleFile(subFiles[0]);
      }
    });

    // 5. Idle mouse hide
    this.stage.addEventListener('mousemove', () => this.handleUserActivity());

    // 6. Navigation Buttons
    document.getElementById('btn-prev')?.addEventListener('click', () => this.playPreviousTrack());
    document.getElementById('btn-next')?.addEventListener('click', () => this.playNextTrack());
    document.getElementById('btn-step-frame')?.addEventListener('click', () => this.stepFrame());
    document.getElementById('btn-snapshot')?.addEventListener('click', () => this.takeSnapshot());
    document.getElementById('btn-pip')?.addEventListener('click', () => this.togglePiP());
    document.getElementById('btn-fullscreen')?.addEventListener('click', () => this.toggleFullscreen());

    // Modals
    document.getElementById('btn-eq')?.addEventListener('click', () => this.toggleModal('eq'));
    document.getElementById('btn-effects')?.addEventListener('click', () => this.toggleModal('effects'));
    document.getElementById('btn-subtitles')?.addEventListener('click', () => this.toggleModal('subtitles'));
    document.getElementById('btn-playlist')?.addEventListener('click', () => this.togglePlaylist());
    document.getElementById('btn-theme')?.addEventListener('click', () => this.toggleTheme());

    // Subtitle Encoding Selector
    const encSelect = document.getElementById('sub-encoding-select');
    encSelect?.addEventListener('change', async (e) => {
      const enc = e.target.value;
      const res = await this.subtitle.reloadWithEncoding(enc);
      if (res) {
        this.showToast(`Encoding: ${res.encoding}`);
      }
    });

    // Subtitle Sync nudge buttons
    document.getElementById('btn-sub-delay')?.addEventListener('click', () => {
      const offset = this.subtitle.adjustSyncOffset(0.05);
      this.updateSubSyncDisplay();
      this.showToast(`Subtitle sync: ${offset > 0 ? '+' : ''}${Math.round(offset * 1000)}ms`);
    });

    document.getElementById('btn-sub-advance')?.addEventListener('click', () => {
      const offset = this.subtitle.adjustSyncOffset(-0.05);
      this.updateSubSyncDisplay();
      this.showToast(`Subtitle sync: ${offset > 0 ? '+' : ''}${Math.round(offset * 1000)}ms`);
    });

    // Modal Close buttons
    document.querySelectorAll('.btn-modal-close').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.modal-backdrop').forEach((m) => m.classList.remove('open'));
      });
    });

    // Close modal on backdrop click
    document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) backdrop.classList.remove('open');
      });
    });

    // 7. Keyboard Shortcuts
    window.addEventListener('keydown', (e) => this.handleKeyboardShortcuts(e));
  }

  loadFiles(files) {
    const added = this.playlist.addFiles(files);
    if (!added.length) return;

    this.renderPlaylist();
    const current = this.playlist.getCurrentItem();
    if (current) {
      this.playItem(current);
    }
  }

  playItem(item) {
    this.audio.init(this.video);
    this.video.src = item.url;
    this.emptyState.style.display = 'none';
    this.video.play().catch(() => {});
    this.renderPlaylist();
    this.showToast(item.name);
  }

  async loadSubtitleFile(file) {
    const buffer = await file.arrayBuffer();
    const res = await this.subtitle.loadFromBuffer(buffer, file.name, 'auto');
    this.showToast(`Subtitles loaded (${res.cuesCount} cues, ${res.encoding})`);
    const encBadge = document.getElementById('detected-encoding-badge');
    if (encBadge) encBadge.textContent = res.encoding;
  }

  togglePlay() {
    if (!this.video.src) return;
    if (this.video.paused) {
      this.video.play();
    } else {
      this.video.pause();
    }
  }

  updatePlayButtonIcon(isPlaying) {
    const icon = this.btnPlay.querySelector('svg');
    if (!icon) return;
    if (isPlaying) {
      // Pause SVG
      icon.innerHTML = `<rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/>`;
    } else {
      // Play SVG
      icon.innerHTML = `<polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/>`;
    }
  }

  onTimeUpdate() {
    const cur = this.video.currentTime || 0;
    const dur = this.video.duration || 0;

    // Timeline progress
    if (dur > 0) {
      const pct = (cur / dur) * 100;
      this.progressFill.style.width = `${pct}%`;
    }

    this.timeCurrent.textContent = this.formatTime(cur);

    // Subtitle cue update
    const cue = this.subtitle.getCueAtTime(cur);
    if (cue) {
      this.subtitleText.textContent = cue.text;
      this.subtitleText.dir = cue.isRtl ? 'rtl' : 'ltr';
      this.subtitleOverlay.style.display = 'flex';
    } else {
      this.subtitleOverlay.style.display = 'none';
    }
  }

  onProgress() {
    if (this.video.buffered.length > 0 && this.video.duration > 0) {
      const bufferedEnd = this.video.buffered.end(this.video.buffered.length - 1);
      const pct = (bufferedEnd / this.video.duration) * 100;
      this.progressBuffered.style.width = `${pct}%`;
    }
  }

  onLoadedMetadata() {
    this.timeDuration.textContent = this.formatTime(this.video.duration);
  }

  onTrackEnded() {
    const nextItem = this.playlist.next();
    if (nextItem) {
      this.playItem(nextItem);
    }
  }

  playNextTrack() {
    const nextItem = this.playlist.next();
    if (nextItem) this.playItem(nextItem);
  }

  playPreviousTrack() {
    const prevItem = this.playlist.prev();
    if (prevItem) this.playItem(prevItem);
  }

  stepFrame() {
    if (!this.video.paused) this.video.pause();
    // 1 frame advance ~ 1/30s
    this.video.currentTime = Math.min(this.video.duration, this.video.currentTime + 1 / 30);
  }

  takeSnapshot() {
    if (this.effects) {
      const res = this.effects.captureSnapshot('dz_snapshot');
      if (res) this.showToast(`Snapshot saved: ${res.filename}`);
    }
  }

  togglePiP() {
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture();
    } else if (this.video.requestPictureInPicture) {
      this.video.requestPictureInPicture();
    }
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      this.playerContainer.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }

  handleUserActivity() {
    this.playerContainer.classList.remove('controls-hidden');
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (!this.video.paused) {
        this.playerContainer.classList.add('controls-hidden');
      }
    }, 2800);
  }

  formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '00:00';
    const s = Math.floor(seconds);
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return hrs > 0 ? `${pad(hrs)}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
  }

  // Equalizer UI rendering
  renderEqualizerUI() {
    const wrapper = document.getElementById('eq-bands-wrapper');
    const presetsSelect = document.getElementById('eq-presets-select');
    const preampSlider = document.getElementById('eq-preamp-slider');
    const preampVal = document.getElementById('eq-preamp-val');
    if (!wrapper) return;

    wrapper.innerHTML = '';
    VLC_EQ_FREQUENCIES.forEach((freq, index) => {
      const col = document.createElement('div');
      col.className = 'eq-band-col';
      const label = freq >= 1000 ? `${freq / 1000}k` : `${freq}`;

      col.innerHTML = `
        <span class="eq-gain-label" id="eq-gain-${index}">0dB</span>
        <input type="range" class="eq-slider" min="-20" max="20" step="0.5" value="0" data-band="${index}">
        <span class="eq-freq-label">${label}Hz</span>
      `;

      const slider = col.querySelector('input');
      slider.addEventListener('input', (e) => {
        const db = Number(e.target.value);
        this.audio.setBandGain(index, db);
        col.querySelector('.eq-gain-label').textContent = `${db > 0 ? '+' : ''}${db}dB`;
      });

      wrapper.appendChild(col);
    });

    // Populate Presets
    if (presetsSelect) {
      presetsSelect.innerHTML = Object.entries(VLC_EQ_PRESETS)
        .map(([k, v]) => `<option value="${k}">${v.name}</option>`)
        .join('');

      presetsSelect.addEventListener('change', (e) => {
        this.audio.applyPreset(e.target.value);
        this.syncEqualizerSliders();
      });
    }

    if (preampSlider) {
      preampSlider.addEventListener('input', (e) => {
        const val = Number(e.target.value);
        this.audio.setPreamp(val);
        if (preampVal) preampVal.textContent = `${val > 0 ? '+' : ''}${val}dB`;
      });
    }
  }

  syncEqualizerSliders() {
    this.audio.currentBands.forEach((gain, index) => {
      const slider = document.querySelector(`.eq-slider[data-band="${index}"]`);
      const label = document.getElementById(`eq-gain-${index}`);
      if (slider) slider.value = gain;
      if (label) label.textContent = `${gain > 0 ? '+' : ''}${gain}dB`;
    });
  }

  startVisualizer() {
    const canvas = document.getElementById('visualizer-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const render = () => {
      const data = this.audio.getFrequencyData();
      if (!data) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const barWidth = (canvas.width / data.length) * 2.2;
      let x = 0;

      for (let i = 0; i < data.length; i++) {
        const barHeight = (data[i] / 255) * canvas.height;
        ctx.fillStyle = `rgba(14, 165, 233, ${0.3 + (data[i] / 255) * 0.7})`;
        ctx.fillRect(x, canvas.height - barHeight, barWidth - 1, barHeight);
        x += barWidth;
        if (x > canvas.width) break;
      }

      this.visualizerAnimationId = requestAnimationFrame(render);
    };

    render();
  }

  stopVisualizer() {
    if (this.visualizerAnimationId) {
      cancelAnimationFrame(this.visualizerAnimationId);
      this.visualizerAnimationId = null;
    }
  }

  // Effects UI bindings
  renderEffectsUI() {
    const bindSlider = (id, property, unit, labelId) => {
      const slider = document.getElementById(id);
      const label = document.getElementById(labelId);
      slider?.addEventListener('input', (e) => {
        const val = Number(e.target.value);
        this.effects[property] = val;
        this.effects.apply();
        if (label) label.textContent = `${val}${unit}`;
      });
    };

    bindSlider('fx-brightness', 'brightness', '%', 'val-brightness');
    bindSlider('fx-contrast', 'contrast', '%', 'val-contrast');
    bindSlider('fx-saturation', 'saturation', '%', 'val-saturation');
    bindSlider('fx-hue', 'hue', '°', 'val-hue');

    document.querySelectorAll('.aspect-pill').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.aspect-pill').forEach((b) => b.classList.remove('active'));
        e.target.classList.add('active');
        this.effects.setAspectRatio(e.target.getAttribute('data-ratio'));
      });
    });

    document.getElementById('btn-rotate')?.addEventListener('click', () => {
      const rot = this.effects.rotateClockwise();
      this.showToast(`Rotation: ${rot}°`);
    });

    document.getElementById('btn-fliph')?.addEventListener('click', () => {
      const flip = this.effects.toggleFlipH();
      this.showToast(`Mirror: ${flip ? 'ON' : 'OFF'}`);
    });

    document.getElementById('btn-reset-effects')?.addEventListener('click', () => {
      this.effects.resetFilters();
      this.effects.resetGeometry();
      this.showToast('Effects reset');
    });
  }

  updateSubSyncDisplay() {
    const disp = document.getElementById('sub-sync-val');
    if (disp) {
      const ms = Math.round(this.subtitle.syncOffsetSec * 1000);
      disp.textContent = `${ms > 0 ? '+' : ''}${ms}ms`;
    }
  }

  toggleModal(modalKey) {
    const map = {
      eq: this.modalEq,
      effects: this.modalEffects,
      subtitles: this.modalSubtitles
    };
    const target = map[modalKey];
    if (!target) return;

    const isOpen = target.classList.contains('open');
    document.querySelectorAll('.modal-backdrop').forEach((m) => m.classList.remove('open'));
    if (!isOpen) {
      target.classList.add('open');
    }
  }

  togglePlaylist() {
    this.playlistDrawer.classList.toggle('open');
  }

  renderPlaylist() {
    const list = document.getElementById('playlist-items');
    if (!list) return;

    if (this.playlist.items.length === 0) {
      list.innerHTML = `<li class="playlist-empty" style="padding:20px; text-align:center; color:var(--text-muted);">${I18N[this.currentLang].emptyPlaylist}</li>`;
      return;
    }

    list.innerHTML = this.playlist.items
      .map((item, index) => {
        const isActive = index === this.playlist.currentIndex;
        return `
          <li class="playlist-item ${isActive ? 'active' : ''}" data-index="${index}">
            <div class="playlist-item-info">
              <div class="playlist-item-title">${item.name}</div>
              <div class="playlist-item-meta">${item.sizeFormatted} • ${item.isVideo ? 'Video' : 'Audio'}</div>
            </div>
            <button class="btn-ctrl btn-remove-item" data-index="${index}" title="Remove">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </li>
        `;
      })
      .join('');

    list.querySelectorAll('.playlist-item').forEach((li) => {
      li.addEventListener('click', (e) => {
        if (e.target.closest('.btn-remove-item')) return;
        const idx = Number(li.getAttribute('data-index'));
        const item = this.playlist.setIndex(idx);
        if (item) this.playItem(item);
      });
    });

    list.querySelectorAll('.btn-remove-item').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = Number(btn.getAttribute('data-index'));
        this.playlist.remove(idx);
        this.renderPlaylist();
      });
    });
  }

  handleKeyboardShortcuts(e) {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        this.togglePlay();
        break;
      case 'KeyF':
        e.preventDefault();
        this.toggleFullscreen();
        break;
      case 'KeyM':
        e.preventDefault();
        this.btnMute.click();
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.volumeSlider.value = Math.min(300, Number(this.volumeSlider.value) + 5);
        this.volumeSlider.dispatchEvent(new Event('input'));
        this.showToast(`Volume: ${this.volumeSlider.value}%`);
        break;
      case 'ArrowDown':
        e.preventDefault();
        this.volumeSlider.value = Math.max(0, Number(this.volumeSlider.value) - 5);
        this.volumeSlider.dispatchEvent(new Event('input'));
        this.showToast(`Volume: ${this.volumeSlider.value}%`);
        break;
      case 'ArrowRight':
        e.preventDefault();
        this.video.currentTime = Math.min(this.video.duration, this.video.currentTime + (e.ctrlKey ? 60 : 5));
        break;
      case 'ArrowLeft':
        e.preventDefault();
        this.video.currentTime = Math.max(0, this.video.currentTime - (e.ctrlKey ? 60 : 5));
        break;
      case 'BracketRight':
        e.preventDefault();
        this.video.playbackRate = Math.min(4.0, Math.round((this.video.playbackRate + 0.1) * 10) / 10);
        this.showToast(`Speed: ${this.video.playbackRate}x`);
        break;
      case 'BracketLeft':
        e.preventDefault();
        this.video.playbackRate = Math.max(0.25, Math.round((this.video.playbackRate - 0.1) * 10) / 10);
        this.showToast(`Speed: ${this.video.playbackRate}x`);
        break;
      case 'Equal':
        e.preventDefault();
        this.video.playbackRate = 1.0;
        this.showToast(`Speed: 1.0x`);
        break;
      case 'KeyE':
        e.preventDefault();
        this.stepFrame();
        break;
      case 'KeyG':
        e.preventDefault();
        this.subtitle.adjustSyncOffset(0.05);
        this.updateSubSyncDisplay();
        this.showToast(`Sub sync: +50ms`);
        break;
      case 'KeyH':
        e.preventDefault();
        this.subtitle.adjustSyncOffset(-0.05);
        this.updateSubSyncDisplay();
        this.showToast(`Sub sync: -50ms`);
        break;
      case 'KeyS':
        if (e.shiftKey) {
          e.preventDefault();
          this.takeSnapshot();
        } else {
          e.preventDefault();
          this.video.pause();
          this.video.currentTime = 0;
        }
        break;
    }
  }
}

// Bootstrap application on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  window.dzPlayer = new DZPlayerApp();
});
