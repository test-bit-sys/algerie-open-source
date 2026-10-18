/**
 * DZ-Player — VLC Media Player 1:1 Desktop Alternative Controller
 * Part of DZ Open Suite (HeyPuter/everything standard)
 * 100% Offline-First | Vanilla JS ES Modules | Trilingual (AR/FR/EN) | Zero Emojis
 */

import { AudioEngine, VLC_EQ_PRESETS, VLC_EQ_FREQUENCIES } from './audio-engine.js';
import { SubtitleEngine } from './subtitle-engine.js';
import { VideoEffects } from './video-effects.js';
import { Playlist } from './playlist.js';

class DZPlayerApp {
  constructor() {
    this.currentLang = localStorage.getItem('dz_player_lang') || 'ar';
    this.currentTheme = localStorage.getItem('dz_player_theme') || 'dark';

    // Subsystems
    this.audio = new AudioEngine();
    this.subtitle = new SubtitleEngine();
    this.playlist = new Playlist();
    this.effects = null;

    // A-B Loop State
    this.abLoop = { a: null, b: null, active: false };

    // Playback Speed
    this.playbackSpeed = 1.0;

    // Audio / Subtitle Sync Offsets
    this.audioDelayMs = 0;

    // DOM Elements
    this.initDOM();
    this.effects = new VideoEffects(this.dom.video, this.dom.stage);

    this.applyTheme(this.currentTheme);
    this.applyLanguage(this.currentLang);
    this.initMenus();
    this.initControls();
    this.initEffectsDialog();
    this.initModals();
    this.initKeyboardShortcuts();
    this.initDragAndDrop();
  }

  initDOM() {
    this.dom = {
      langSelect: document.getElementById('langSelect'),
      themeToggleBtn: document.getElementById('themeToggleBtn'),

      // Player Viewport
      video: document.getElementById('main-video'),
      stage: document.getElementById('video-stage'),
      emptyState: document.getElementById('empty-state'),
      subtitleOverlay: document.getElementById('subtitle-overlay'),
      subtitleText: document.getElementById('subtitle-text'),
      osdBanner: document.getElementById('osd-banner'),
      centerTrackTitle: document.getElementById('centerTrackTitle'),

      // File Inputs
      fileInput: document.getElementById('file-input'),
      subInput: document.getElementById('sub-input'),
      btnEmptyOpen: document.getElementById('btn-empty-open'),
      btnEmptyNetwork: document.getElementById('btn-empty-network'),

      // Controls Bar
      btnPlay: document.getElementById('btn-play'),
      btnStop: document.getElementById('btn-stop'),
      btnPrev: document.getElementById('btn-prev'),
      btnNext: document.getElementById('btn-next'),
      btnAbLoop: document.getElementById('btn-ab-loop'),
      lblPlaybackSpeed: document.getElementById('lblPlaybackSpeed'),
      progressTrack: document.getElementById('progress-track'),
      progressFill: document.getElementById('progress-fill'),
      progressBuffered: document.getElementById('progress-buffered'),
      timeCurrent: document.getElementById('time-current'),
      timeDuration: document.getElementById('time-duration'),

      // Utility Buttons
      btnEffectsDialog: document.getElementById('btn-effects-dialog'),
      btnPlaylistToggle: document.getElementById('btn-playlist-toggle'),
      btnSnapshot: document.getElementById('btn-snapshot'),
      btnPip: document.getElementById('btn-pip'),
      btnFullscreen: document.getElementById('btn-fullscreen'),
      btnMute: document.getElementById('btn-mute'),
      volumeSlider: document.getElementById('volume-slider'),
      volumeBadge: document.getElementById('volume-badge'),

      // Playlist Drawer
      playlistDrawer: document.getElementById('playlist-drawer'),
      playlistItems: document.getElementById('playlist-items'),
      btnClosePlaylist: document.getElementById('btnClosePlaylist'),

      // Effects Dialog (Ctrl+E)
      modalEffectsDialog: document.getElementById('modal-effects-dialog'),
      btnCloseEffectsDialog: document.getElementById('btnCloseEffectsDialog'),
      vlcTabBtns: document.querySelectorAll('.vlc-tab-btn'),
      visualizerCanvas: document.getElementById('visualizer-canvas'),
      chkEnableEq: document.getElementById('chkEnableEq'),
      eqPresetsSelect: document.getElementById('eq-presets-select'),
      eqPreampSlider: document.getElementById('eq-preamp-slider'),
      eqPreampVal: document.getElementById('eq-preamp-val'),
      eqBandsWrapper: document.getElementById('eq-bands-wrapper'),
      chkEnableCompressor: document.getElementById('chkEnableCompressor'),

      // Video Effects in Dialog
      fxBrightness: document.getElementById('fx-brightness'),
      fxContrast: document.getElementById('fx-contrast'),
      fxSaturation: document.getElementById('fx-saturation'),
      fxHue: document.getElementById('fx-hue'),
      valBrightness: document.getElementById('val-brightness'),
      valContrast: document.getElementById('val-contrast'),
      valSaturation: document.getElementById('val-saturation'),
      valHue: document.getElementById('val-hue'),
      btnRotate: document.getElementById('btn-rotate'),
      btnFlipH: document.getElementById('btn-fliph'),
      btnFlipV: document.getElementById('btn-flipv'),
      btnResetEffects: document.getElementById('btn-reset-effects'),

      // Sync Controls
      valAudioSync: document.getElementById('val-audio-sync'),
      btnAudioSyncMinus50: document.getElementById('btnAudioSyncMinus50'),
      btnAudioSyncPlus50: document.getElementById('btnAudioSyncPlus50'),
      btnAudioSyncReset: document.getElementById('btnAudioSyncReset'),
      subSyncVal: document.getElementById('sub-sync-val'),
      btnSubDelay: document.getElementById('btn-sub-delay'),
      btnSubAdvance: document.getElementById('btn-sub-advance'),
      btnSubSyncReset: document.getElementById('btnSubSyncReset'),
      subEncodingSelect: document.getElementById('sub-encoding-select'),
      detectedEncodingBadge: document.getElementById('detected-encoding-badge'),

      // Modals
      modalNetworkStream: document.getElementById('modal-network-stream'),
      inputNetworkUrl: document.getElementById('inputNetworkUrl'),
      btnConfirmPlayUrl: document.getElementById('btnConfirmPlayUrl'),
      modalMediaInfo: document.getElementById('modal-media-info'),
      mediaInfoBody: document.getElementById('mediaInfoBody'),
      modalAbout: document.getElementById('modal-about')
    };
  }

  applyTheme(theme) {
    this.currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('dz_player_theme', theme);
  }

  applyLanguage(lang) {
    this.currentLang = lang;
    document.documentElement.setAttribute('lang', lang);
    document.documentElement.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    document.body.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    localStorage.setItem('dz_player_lang', lang);
    if (this.dom.langSelect) this.dom.langSelect.value = lang;
  }

  showOSD(text) {
    const banner = this.dom.osdBanner;
    banner.textContent = text;
    banner.style.display = 'block';
    clearTimeout(this.osdTimer);
    this.osdTimer = setTimeout(() => {
      banner.style.display = 'none';
    }, 2000);
  }

  initMenus() {
    // Menu Dropdown Toggles
    document.querySelectorAll('.vlc-menu-bar .menu-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const dropdown = btn.nextElementSibling;
        const wasOpen = dropdown.classList.contains('show');
        this.closeAllMenus();
        if (!wasOpen) {
          dropdown.classList.add('show');
          btn.classList.add('active');
        }
      });
    });

    window.addEventListener('click', () => {
      this.closeAllMenus();
    });

    // 1. Media Menu
    document.getElementById('miOpenFile')?.addEventListener('click', () => this.dom.fileInput.click());
    document.getElementById('miOpenMultiple')?.addEventListener('click', () => this.dom.fileInput.click());
    document.getElementById('miOpenNetwork')?.addEventListener('click', () => {
      this.dom.modalNetworkStream.classList.add('active');
    });
    document.getElementById('miSavePlaylist')?.addEventListener('click', () => this.savePlaylistM3U());
    document.getElementById('miClearPlaylist')?.addEventListener('click', () => {
      this.playlist.clear();
      this.renderPlaylistUI();
      this.showOSD('تم مسح قائمة التشغيل');
    });
    document.getElementById('miQuit')?.addEventListener('click', () => {
      this.stop();
      this.dom.video.src = '';
      this.dom.emptyState.classList.remove('hidden');
    });

    // 2. Playback Menu
    document.getElementById('miPlayPause')?.addEventListener('click', () => this.togglePlay());
    document.getElementById('miStop')?.addEventListener('click', () => this.stop());
    document.getElementById('miPrev')?.addEventListener('click', () => this.playPreviousTrack());
    document.getElementById('miNext')?.addEventListener('click', () => this.playNextTrack());
    document.getElementById('miJumpForward')?.addEventListener('click', () => this.jump(10));
    document.getElementById('miJumpBackward')?.addEventListener('click', () => this.jump(-10));
    document.getElementById('miStepFrame')?.addEventListener('click', () => this.stepFrame());
    document.getElementById('miSpeedFaster')?.addEventListener('click', () => this.changeSpeed(0.25));
    document.getElementById('miSpeedSlower')?.addEventListener('click', () => this.changeSpeed(-0.25));
    document.getElementById('miSpeedNormal')?.addEventListener('click', () => this.setSpeed(1.0));
    document.getElementById('miAbLoop')?.addEventListener('click', () => this.toggleAbLoop());

    // 3. Audio Menu
    document.getElementById('miAudioEffects')?.addEventListener('click', () => this.openEffectsDialog('audio'));
    document.getElementById('miVolUp')?.addEventListener('click', () => this.adjustVolume(5));
    document.getElementById('miVolDown')?.addEventListener('click', () => this.adjustVolume(-5));
    document.getElementById('miMute')?.addEventListener('click', () => this.toggleMute());
    document.getElementById('miStereoDefault')?.addEventListener('click', () => this.audio.setBalance(0));
    document.getElementById('miStereoLeft')?.addEventListener('click', () => this.audio.setBalance(-1));
    document.getElementById('miStereoRight')?.addEventListener('click', () => this.audio.setBalance(1));

    // 4. Video Menu
    document.getElementById('miFullscreen')?.addEventListener('click', () => this.toggleFullscreen());
    document.getElementById('miSnapshot')?.addEventListener('click', () => this.takeSnapshot());
    document.getElementById('miVideoEffects')?.addEventListener('click', () => this.openEffectsDialog('video'));
    document.getElementById('miAspectAuto')?.addEventListener('click', () => this.setAspectRatio('auto'));
    document.getElementById('miAspect169')?.addEventListener('click', () => this.setAspectRatio('16:9'));
    document.getElementById('miAspect43')?.addEventListener('click', () => this.setAspectRatio('4:3'));
    document.getElementById('miAspect219')?.addEventListener('click', () => this.setAspectRatio('21:9'));
    document.getElementById('miRotate90')?.addEventListener('click', () => this.rotateVideo());
    document.getElementById('miFlipH')?.addEventListener('click', () => this.flipHVideo());

    // 5. Subtitle Menu
    document.getElementById('miAddSub')?.addEventListener('click', () => this.dom.subInput.click());
    document.getElementById('miSubEncAuto')?.addEventListener('click', () => this.changeSubtitleEncoding('auto'));
    document.getElementById('miSubEnc1256')?.addEventListener('click', () => this.changeSubtitleEncoding('windows-1256'));
    document.getElementById('miSubEncUtf8')?.addEventListener('click', () => this.changeSubtitleEncoding('utf-8'));
    document.getElementById('miSubDelay')?.addEventListener('click', () => this.adjustSubtitleSync(-50));
    document.getElementById('miSubAdvance')?.addEventListener('click', () => this.adjustSubtitleSync(50));
    document.getElementById('miSubSettings')?.addEventListener('click', () => this.openEffectsDialog('sync'));

    // 6. Tools Menu
    document.getElementById('miEffectsAndFilters')?.addEventListener('click', () => this.openEffectsDialog('audio'));
    document.getElementById('miTrackSync')?.addEventListener('click', () => this.openEffectsDialog('sync'));
    document.getElementById('miMediaInfo')?.addEventListener('click', () => this.openMediaInfoDialog());

    // 7. View Menu
    document.getElementById('miPlaylist')?.addEventListener('click', () => this.togglePlaylist());
    document.getElementById('miPip')?.addEventListener('click', () => this.togglePiP());
    document.getElementById('miToggleTheme')?.addEventListener('click', () => {
      this.applyTheme(this.currentTheme === 'dark' ? 'light' : 'dark');
    });

    // 8. Help Menu
    document.getElementById('miAbout')?.addEventListener('click', () => {
      this.dom.modalAbout.classList.add('active');
    });

    // Header controls
    this.dom.langSelect.addEventListener('change', (e) => this.applyLanguage(e.target.value));
    this.dom.themeToggleBtn.addEventListener('click', () => {
      this.applyTheme(this.currentTheme === 'dark' ? 'light' : 'dark');
    });
  }

  closeAllMenus() {
    document.querySelectorAll('.vlc-menu-bar .dropdown-menu').forEach((d) => d.classList.remove('show'));
    document.querySelectorAll('.vlc-menu-bar .menu-btn').forEach((b) => b.classList.remove('active'));
  }

  initControls() {
    const v = this.dom.video;

    // Play/Pause
    this.dom.btnPlay.addEventListener('click', () => this.togglePlay());
    v.addEventListener('click', () => this.togglePlay());

    // Stop
    this.dom.btnStop.addEventListener('click', () => this.stop());

    // Video events
    v.addEventListener('play', () => {
      this.updatePlayIcon(true);
      this.audio.resumeIfNeeded();
      this.startVisualizer();
    });

    v.addEventListener('pause', () => {
      this.updatePlayIcon(false);
      this.stopVisualizer();
    });

    v.addEventListener('timeupdate', () => this.onTimeUpdate());
    v.addEventListener('loadedmetadata', () => this.onLoadedMetadata());
    v.addEventListener('ended', () => this.playNextTrack());

    // Prev / Next
    this.dom.btnPrev.addEventListener('click', () => this.playPreviousTrack());
    this.dom.btnNext.addEventListener('click', () => this.playNextTrack());

    // A-B Loop
    this.dom.btnAbLoop.addEventListener('click', () => this.toggleAbLoop());

    // Timeline Scrubbing
    let isScrubbing = false;
    const seek = (e) => {
      const rect = this.dom.progressTrack.getBoundingClientRect();
      const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      if (v.duration) v.currentTime = pos * v.duration;
    };

    this.dom.progressTrack.addEventListener('mousedown', (e) => {
      isScrubbing = true;
      seek(e);
    });
    window.addEventListener('mousemove', (e) => {
      if (isScrubbing) seek(e);
    });
    window.addEventListener('mouseup', () => {
      isScrubbing = false;
    });

    // Volume & 300% Boost
    this.dom.volumeSlider.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      this.audio.init(v);
      this.audio.setVolume(val);
      this.dom.volumeBadge.textContent = `${val}%`;
      this.dom.volumeBadge.classList.toggle('boosted', val > 100);
      this.showOSD(`الصوت: ${val}%`);
    });

    this.dom.btnMute.addEventListener('click', () => this.toggleMute());

    // Bottom Action Buttons
    this.dom.btnEffectsDialog.addEventListener('click', () => this.openEffectsDialog('audio'));
    this.dom.btnPlaylistToggle.addEventListener('click', () => this.togglePlaylist());
    this.dom.btnClosePlaylist.addEventListener('click', () => this.togglePlaylist(false));
    this.dom.btnSnapshot.addEventListener('click', () => this.takeSnapshot());
    this.dom.btnPip.addEventListener('click', () => this.togglePiP());
    this.dom.btnFullscreen.addEventListener('click', () => this.toggleFullscreen());

    // Empty state triggers
    this.dom.btnEmptyOpen.addEventListener('click', () => this.dom.fileInput.click());
    this.dom.btnEmptyNetwork.addEventListener('click', () => {
      this.dom.modalNetworkStream.classList.add('active');
    });

    // File Input
    this.dom.fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length) {
        this.loadFiles(Array.from(e.target.files));
      }
      this.dom.fileInput.value = '';
    });

    this.dom.subInput.addEventListener('change', async (e) => {
      if (e.target.files && e.target.files[0]) {
        await this.loadSubtitleFile(e.target.files[0]);
      }
      this.dom.subInput.value = '';
    });
  }

  initEffectsDialog() {
    this.dom.btnCloseEffectsDialog.addEventListener('click', () => {
      this.dom.modalEffectsDialog.classList.remove('active');
    });

    // Dialog Tab Switching
    this.dom.vlcTabBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-vlc-tab');
        this.dom.vlcTabBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.vlc-tab-pane').forEach((p) => p.classList.remove('active'));
        const pane = document.getElementById(`paneVlc${tab.charAt(0).toUpperCase() + tab.slice(1)}`);
        if (pane) pane.classList.add('active');
      });
    });

    // 1. Equalizer UI
    this.renderEqualizerUI();

    // 2. Video Filters UI
    const updateFx = () => {
      this.effects.brightness = Number(this.dom.fxBrightness.value);
      this.effects.contrast = Number(this.dom.fxContrast.value);
      this.effects.saturation = Number(this.dom.fxSaturation.value);
      this.effects.hue = Number(this.dom.fxHue.value);
      this.effects.apply();

      this.dom.valBrightness.textContent = `${this.effects.brightness}%`;
      this.dom.valContrast.textContent = `${this.effects.contrast}%`;
      this.dom.valSaturation.textContent = `${this.effects.saturation}%`;
      this.dom.valHue.textContent = `${this.effects.hue}°`;
    };

    [this.dom.fxBrightness, this.dom.fxContrast, this.dom.fxSaturation, this.dom.fxHue].forEach((input) => {
      input?.addEventListener('input', updateFx);
    });

    this.dom.btnRotate?.addEventListener('click', () => this.rotateVideo());
    this.dom.btnFlipH?.addEventListener('click', () => this.flipHVideo());
    this.dom.btnFlipV?.addEventListener('click', () => {
      this.effects.toggleFlipV();
      this.showOSD('انعكاس رأسي');
    });
    this.dom.btnResetEffects?.addEventListener('click', () => {
      this.effects.resetFilters();
      this.effects.resetGeometry();
      this.dom.fxBrightness.value = 100;
      this.dom.fxContrast.value = 100;
      this.dom.fxSaturation.value = 100;
      this.dom.fxHue.value = 0;
      updateFx();
      this.showOSD('تمت إعادة ضبط تأثيرات الفيديو');
    });

    // Aspect Ratio Pills in Dialog
    document.querySelectorAll('.aspect-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('.aspect-pill').forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        const ratio = pill.getAttribute('data-ratio');
        this.setAspectRatio(ratio);
      });
    });

    // 3. Sync UI
    this.dom.btnAudioSyncMinus50.addEventListener('click', () => this.adjustAudioDelay(-50));
    this.dom.btnAudioSyncPlus50.addEventListener('click', () => this.adjustAudioDelay(50));
    this.dom.btnAudioSyncReset.addEventListener('click', () => {
      this.audioDelayMs = 0;
      this.audio.setAudioDelay(0);
      this.dom.valAudioSync.textContent = '0 ms';
      this.showOSD('مزامنة الصوت: 0 ms');
    });

    this.dom.btnSubDelay.addEventListener('click', () => this.adjustSubtitleSync(-50));
    this.dom.btnSubAdvance.addEventListener('click', () => this.adjustSubtitleSync(50));
    this.dom.btnSubSyncReset.addEventListener('click', () => {
      this.subtitle.syncOffsetSec = 0;
      this.dom.subSyncVal.textContent = '0 ms';
      this.showOSD('مزامنة الترجمة: 0 ms');
    });

    this.dom.subEncodingSelect.addEventListener('change', (e) => {
      this.changeSubtitleEncoding(e.target.value);
    });
  }

  renderEqualizerUI() {
    const wrapper = this.dom.eqBandsWrapper;
    wrapper.innerHTML = '';

    // Populate Presets Select
    const sel = this.dom.eqPresetsSelect;
    sel.innerHTML = '';
    Object.keys(VLC_EQ_PRESETS).forEach((key) => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = VLC_EQ_PRESETS[key].name;
      sel.appendChild(opt);
    });

    sel.addEventListener('change', (e) => {
      this.audio.applyPreset(e.target.value);
      this.updateEqSliders();
      this.showOSD(`EQ Preset: ${VLC_EQ_PRESETS[e.target.value].name}`);
    });

    // Preamp Slider
    this.dom.eqPreampSlider.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      this.audio.setPreamp(val);
      this.dom.eqPreampVal.textContent = `${val >= 0 ? '+' : ''}${val}dB`;
    });

    // EQ Toggle
    this.dom.chkEnableEq.addEventListener('change', (e) => {
      this.audio.toggleEq(e.target.checked);
      this.showOSD(e.target.checked ? 'المعادل الصوتي: مفعل' : 'المعادل الصوتي: معطل');
    });

    // Compressor Toggle
    this.dom.chkEnableCompressor.addEventListener('change', (e) => {
      this.audio.setCompressor(e.target.checked);
      this.showOSD(e.target.checked ? 'ضاغط الصوت: مفعل' : 'ضاغط الصوت: معطل');
    });

    // 10 Band Sliders
    VLC_EQ_FREQUENCIES.forEach((freq, idx) => {
      const col = document.createElement('div');
      col.className = 'eq-band-col';

      const labelFreq = freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
      col.innerHTML = `
        <span class="eq-val-text" id="eq-val-${idx}">0.0</span>
        <input type="range" class="eq-slider" id="eq-slider-${idx}" min="-20" max="20" step="0.5" value="0">
        <span class="eq-freq-text">${labelFreq}</span>
      `;

      const slider = col.querySelector('input');
      const valText = col.querySelector('.eq-val-text');

      slider.addEventListener('input', (e) => {
        const gain = Number(e.target.value);
        this.audio.setBandGain(idx, gain);
        valText.textContent = `${gain >= 0 ? '+' : ''}${gain.toFixed(1)}`;
      });

      wrapper.appendChild(col);
    });
  }

  updateEqSliders() {
    this.audio.currentBands.forEach((gain, idx) => {
      const slider = document.getElementById(`eq-slider-${idx}`);
      const valText = document.getElementById(`eq-val-${idx}`);
      if (slider) slider.value = gain;
      if (valText) valText.textContent = `${gain >= 0 ? '+' : ''}${gain.toFixed(1)}`;
    });
  }

  openEffectsDialog(targetTab = 'audio') {
    this.audio.init(this.dom.video);
    this.dom.vlcTabBtns.forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-vlc-tab') === targetTab);
    });
    document.querySelectorAll('.vlc-tab-pane').forEach((p) => {
      p.classList.toggle('active', p.id === `paneVlc${targetTab.charAt(0).toUpperCase() + targetTab.slice(1)}`);
    });
    this.dom.modalEffectsDialog.classList.add('active');
  }

  initModals() {
    // Network Stream Confirm
    this.dom.btnConfirmPlayUrl.addEventListener('click', () => {
      const url = this.dom.inputNetworkUrl.value.trim();
      if (!url) return;
      this.dom.modalNetworkStream.classList.remove('active');
      this.playUrl(url);
    });

    // Generic Modal Close Buttons
    document.querySelectorAll('.btn-modal-close, .close-modal-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const modal = e.target.closest('.modal-backdrop');
        if (modal) modal.classList.remove('active');
      });
    });
  }

  initKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        this.togglePlay();
      } else if (e.key.toLowerCase() === 's' && !e.shiftKey && !e.ctrlKey) {
        e.preventDefault();
        this.stop();
      } else if (e.key.toLowerCase() === 'p') {
        e.preventDefault();
        this.playPreviousTrack();
      } else if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        this.playNextTrack();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        this.jump(10);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this.jump(-10);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.adjustVolume(5);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.adjustVolume(-5);
      } else if (e.key.toLowerCase() === 'm') {
        e.preventDefault();
        this.toggleMute();
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        this.toggleFullscreen();
      } else if (e.key.toLowerCase() === 'e') {
        e.preventDefault();
        this.stepFrame();
      } else if (e.key === ']' ) {
        e.preventDefault();
        this.changeSpeed(0.25);
      } else if (e.key === '[' ) {
        e.preventDefault();
        this.changeSpeed(-0.25);
      } else if (e.key === '=' ) {
        e.preventDefault();
        this.setSpeed(1.0);
      } else if (e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        this.takeSnapshot();
      } else if (e.ctrlKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        this.openEffectsDialog('audio');
      } else if (e.ctrlKey && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        this.openMediaInfoDialog();
      } else if (e.ctrlKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        this.togglePlaylist();
      } else if (e.ctrlKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        this.dom.modalNetworkStream.classList.add('active');
      } else if (e.ctrlKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        this.dom.fileInput.click();
      } else if (e.key === 'Escape') {
        this.closeAllMenus();
        document.querySelectorAll('.modal-backdrop').forEach((m) => m.classList.remove('active'));
      }
    });
  }

  initDragAndDrop() {
    this.dom.stage.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });

    this.dom.stage.addEventListener('drop', async (e) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files || []);
      const subFiles = files.filter((f) => /\.(srt|vtt|sub|ass)$/i.test(f.name));
      const mediaFiles = files.filter((f) => !/\.(srt|vtt|sub|ass)$/i.test(f.name));

      if (mediaFiles.length) {
        this.loadFiles(mediaFiles);
      }
      if (subFiles.length) {
        await this.loadSubtitleFile(subFiles[0]);
      }
    });
  }

  // Playback Operations
  togglePlay() {
    const v = this.dom.video;
    if (!v.src && this.playlist.items.length > 0) {
      this.playTrack(0);
      return;
    }
    if (v.paused) {
      v.play();
    } else {
      v.pause();
    }
  }

  stop() {
    const v = this.dom.video;
    v.pause();
    v.currentTime = 0;
    this.updatePlayIcon(false);
    this.showOSD('إيقاف (Stopped)');
  }

  jump(seconds) {
    const v = this.dom.video;
    if (!v.duration) return;
    v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + seconds));
    this.showOSD(`${seconds >= 0 ? '+' : ''}${seconds}s`);
  }

  stepFrame() {
    const v = this.dom.video;
    v.pause();
    v.currentTime = Math.min(v.duration || 0, v.currentTime + 1 / 30);
    this.showOSD('إطار للأمام (Step Frame)');
  }

  changeSpeed(delta) {
    this.setSpeed(Math.max(0.25, Math.min(4.0, this.playbackSpeed + delta)));
  }

  setSpeed(speed) {
    this.playbackSpeed = speed;
    this.dom.video.playbackRate = speed;
    this.dom.lblPlaybackSpeed.textContent = `${speed.toFixed(2)}x`;
    this.showOSD(`السرعة: ${speed.toFixed(2)}x`);
  }

  toggleAbLoop() {
    const cur = this.dom.video.currentTime;
    if (!this.abLoop.a) {
      this.abLoop.a = cur;
      this.showOSD(`نقطة البداية A: ${this.formatTime(cur)}`);
      this.dom.btnAbLoop.classList.add('active-loop');
    } else if (!this.abLoop.b) {
      if (cur > this.abLoop.a) {
        this.abLoop.b = cur;
        this.abLoop.active = true;
        this.showOSD(`تكرار A-B مفعّل (${this.formatTime(this.abLoop.a)} -> ${this.formatTime(this.abLoop.b)})`);
      } else {
        this.abLoop.a = cur;
        this.showOSD(`تم تعديل نقطة البداية A: ${this.formatTime(cur)}`);
      }
    } else {
      this.abLoop = { a: null, b: null, active: false };
      this.dom.btnAbLoop.classList.remove('active-loop');
      this.showOSD('إلغاء تكرار A-B');
    }
  }

  adjustVolume(delta) {
    const next = Math.max(0, Math.min(300, this.audio.volumePercent + delta));
    this.audio.init(this.dom.video);
    this.audio.setVolume(next);
    this.dom.volumeSlider.value = next;
    this.dom.volumeBadge.textContent = `${next}%`;
    this.dom.volumeBadge.classList.toggle('boosted', next > 100);
    this.showOSD(`الصوت: ${next}%`);
  }

  toggleMute() {
    this.audio.init(this.dom.video);
    const isMuted = this.audio.toggleMute();
    this.dom.volumeSlider.value = isMuted ? 0 : this.audio.volumePercent;
    this.dom.volumeBadge.textContent = isMuted ? '0%' : `${this.audio.volumePercent}%`;
    this.showOSD(isMuted ? 'كتم الصوت (Muted)' : `الصوت: ${this.audio.volumePercent}%`);
  }

  setAspectRatio(ratio) {
    this.effects.setAspectRatio(ratio);
    this.showOSD(`نسبة الأبعاد: ${ratio}`);
  }

  rotateVideo() {
    const deg = this.effects.rotateClockwise();
    this.showOSD(`تدوير: ${deg}°`);
  }

  flipHVideo() {
    const flipped = this.effects.toggleFlipH();
    this.showOSD(flipped ? 'انعكاس أفقي' : 'إلغاء الانعكاس');
  }

  takeSnapshot() {
    const snap = this.effects.captureSnapshot('vlc_snapshot');
    if (snap) this.showOSD('تم حفظ لقطة الشاشة (Snapshot Saved)');
  }

  async togglePiP() {
    const v = this.dom.video;
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    } else if (document.pictureInPictureEnabled && !v.disablePictureInPicture) {
      await v.requestPictureInPicture();
    }
  }

  toggleFullscreen() {
    const stage = this.dom.stage;
    if (!document.fullscreenElement) {
      stage.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }

  adjustAudioDelay(deltaMs) {
    this.audioDelayMs += deltaMs;
    this.audio.setAudioDelay(this.audioDelayMs);
    this.dom.valAudioSync.textContent = `${this.audioDelayMs >= 0 ? '+' : ''}${this.audioDelayMs} ms`;
    this.showOSD(`تأخير الصوت: ${this.audioDelayMs} ms`);
  }

  adjustSubtitleSync(deltaMs) {
    this.subtitle.syncOffsetSec += deltaMs / 1000;
    const ms = Math.round(this.subtitle.syncOffsetSec * 1000);
    this.dom.subSyncVal.textContent = `${ms >= 0 ? '+' : ''}${ms} ms`;
    this.showOSD(`تأخير الترجمة: ${ms} ms`);
  }

  async changeSubtitleEncoding(enc) {
    if (!this.subtitle.rawBytes) return;
    const res = await this.subtitle.reloadWithEncoding(enc);
    if (res) {
      this.dom.detectedEncodingBadge.textContent = res.encoding;
      this.showOSD(`ترميز الترجمة: ${res.encoding}`);
    }
  }

  openMediaInfoDialog() {
    const v = this.dom.video;
    const cur = this.playlist.getCurrentItem();
    const body = this.dom.mediaInfoBody;

    const dur = v.duration ? this.formatTime(v.duration) : '-';
    const res = v.videoWidth ? `${v.videoWidth} x ${v.videoHeight}` : 'Audio Only';

    body.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:8px; font-size:12px;">
        <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border-color); padding:4px 0;">
          <span style="color:var(--text-secondary);">Title / Name:</span>
          <span class="cell-mono" style="font-weight:700;">${cur ? cur.name : 'Stream / Direct'}</span>
        </div>
        <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border-color); padding:4px 0;">
          <span style="color:var(--text-secondary);">Duration:</span>
          <span class="cell-mono">${dur}</span>
        </div>
        <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border-color); padding:4px 0;">
          <span style="color:var(--text-secondary);">Resolution:</span>
          <span class="cell-mono">${res}</span>
        </div>
        <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border-color); padding:4px 0;">
          <span style="color:var(--text-secondary);">Playback Speed:</span>
          <span class="cell-mono">${this.playbackSpeed.toFixed(2)}x</span>
        </div>
        <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border-color); padding:4px 0;">
          <span style="color:var(--text-secondary);">Equalizer Bands:</span>
          <span class="cell-mono">10 Bands (${this.audio.eqEnabled ? 'Active' : 'Bypassed'})</span>
        </div>
        <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border-color); padding:4px 0;">
          <span style="color:var(--text-secondary);">Subtitle Track:</span>
          <span class="cell-mono">${this.subtitle.cues.length} Cues (${this.subtitle.detectedEncoding})</span>
        </div>
      </div>
    `;

    this.dom.modalMediaInfo.classList.add('active');
  }

  // Files & Playlist Loading
  loadFiles(fileArray) {
    fileArray.forEach((f) => {
      const url = URL.createObjectURL(f);
      this.playlist.addItem({
        name: f.name,
        url: url,
        type: f.type
      });
    });

    this.renderPlaylistUI();
    if (!this.dom.video.src && this.playlist.items.length) {
      this.playTrack(0);
    }
  }

  playUrl(url) {
    this.playlist.addItem({
      name: url.split('/').pop() || 'Network Stream',
      url: url,
      type: 'network'
    });
    this.renderPlaylistUI();
    this.playTrack(this.playlist.items.length - 1);
  }

  playTrack(index) {
    const item = this.playlist.getItem(index);
    if (!item) return;

    this.playlist.currentIndex = index;
    const v = this.dom.video;
    v.src = item.url;
    v.play().catch(() => {});

    this.dom.emptyState.classList.add('hidden');
    this.dom.centerTrackTitle.textContent = item.name;
    this.renderPlaylistUI();
    this.showOSD(`تشغيل: ${item.name}`);
  }

  playPreviousTrack() {
    const idx = this.playlist.getPreviousIndex();
    if (idx !== -1) this.playTrack(idx);
  }

  playNextTrack() {
    const idx = this.playlist.getNextIndex();
    if (idx !== -1) this.playTrack(idx);
  }

  async loadSubtitleFile(file) {
    const buf = await file.arrayBuffer();
    const res = await this.subtitle.loadFromBuffer(buf, file.name);
    this.dom.detectedEncodingBadge.textContent = res.encoding;
    this.dom.subtitleOverlay.style.display = 'flex';
    this.showOSD(`تم تحميل الترجمة (${res.cuesCount} سطراً - ${res.encoding})`);
  }

  togglePlaylist(force = null) {
    const isOpen = this.dom.playlistDrawer.classList.contains('open');
    const next = force !== null ? force : !isOpen;
    this.dom.playlistDrawer.classList.toggle('open', next);
  }

  renderPlaylistUI() {
    const ul = this.dom.playlistItems;
    ul.innerHTML = '';
    this.playlist.items.forEach((item, idx) => {
      const li = document.createElement('li');
      li.className = `playlist-item ${idx === this.playlist.currentIndex ? 'active' : ''}`;
      li.innerHTML = `
        <span style="overflow:hidden; text-overflow:ellipsis; max-width:240px;">${item.name}</span>
        <span style="font-size:10px; color:var(--text-muted);">${idx + 1}</span>
      `;
      li.addEventListener('click', () => this.playTrack(idx));
      ul.appendChild(li);
    });
  }

  savePlaylistM3U() {
    if (!this.playlist.items.length) return;
    let m3u = '#EXTM3U\n';
    this.playlist.items.forEach((item) => {
      m3u += `#EXTINF:-1,${item.name}\n${item.url}\n`;
    });
    const blob = new Blob([m3u], { type: 'audio/x-mpegurl' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'playlist.m3u';
    a.click();
  }

  // Event callbacks
  onTimeUpdate() {
    const v = this.dom.video;
    if (!v.duration) return;

    // Timeline Fill
    const pct = (v.currentTime / v.duration) * 100;
    this.dom.progressFill.style.width = `${pct}%`;
    this.dom.timeCurrent.textContent = this.formatTime(v.currentTime);

    // A-B Loop check
    if (this.abLoop.active && this.abLoop.b && v.currentTime >= this.abLoop.b) {
      v.currentTime = this.abLoop.a;
    }

    // Subtitle check
    const cue = this.subtitle.getCurrentCue(v.currentTime);
    if (cue) {
      this.dom.subtitleText.innerHTML = cue.text.replace(/\n/g, '<br>');
      this.dom.subtitleOverlay.style.display = 'flex';
    } else {
      this.dom.subtitleOverlay.style.display = 'none';
    }
  }

  onLoadedMetadata() {
    const v = this.dom.video;
    this.dom.timeDuration.textContent = this.formatTime(v.duration || 0);
  }

  updatePlayIcon(isPlaying) {
    this.dom.btnPlay.innerHTML = isPlaying
      ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect></svg>`
      : `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
  }

  formatTime(seconds) {
    const s = Math.floor(seconds || 0);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const remM = m % 60;
    const remS = s % 60;

    if (h > 0) {
      return `${h}:${String(remM).padStart(2, '0')}:${String(remS).padStart(2, '0')}`;
    }
    return `${String(remM).padStart(2, '0')}:${String(remS).padStart(2, '0')}`;
  }

  // Audio Visualizer
  startVisualizer() {
    if (!this.audio.analyserNode) return;
    const canvas = this.dom.visualizerCanvas;
    const ctx = canvas.getContext('2d');
    const buffer = this.audio.frequencyBuffer;

    const render = () => {
      this.audio.analyserNode.getByteFrequencyData(buffer);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / buffer.length) * 2.2;
      let x = 0;

      for (let i = 0; i < buffer.length; i++) {
        const barHeight = (buffer[i] / 255) * canvas.height;
        ctx.fillStyle = `hsl(${190 + (i / buffer.length) * 60}, 90%, 55%)`;
        ctx.fillRect(x, canvas.height - barHeight, barWidth - 1, barHeight);
        x += barWidth;
      }

      this.visualizerId = requestAnimationFrame(render);
    };

    render();
  }

  stopVisualizer() {
    if (this.visualizerId) cancelAnimationFrame(this.visualizerId);
  }
}

// Bootstrap
document.addEventListener('DOMContentLoaded', () => {
  window.dzPlayer = new DZPlayerApp();
});
