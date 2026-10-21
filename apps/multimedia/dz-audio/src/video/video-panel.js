// Video panel: the frame of the active session's video at the playhead. While
// the session plays, a muted <video> plays along and is kept in step with the
// engine (small drift is closed by nudging its speed, large drift by seeking);
// while stopped or scrubbing it seeks to the playhead. Zoom is Best Fit or a
// percentage of the video's own size (View > Video Display or the panel menu).
// Preferences > Video sets the timecode overlay (size, background, position,
// session or file time) and double-click for full screen.

import { h } from '../lib/dom.js';
import { icon } from '../ui/icons.js';
import { videoClip, videoPool, videoTimeAt, syncStep } from '../model/session-video.js';
import { videoURL } from './media.js';

export const VIDEO_ZOOMS = [
  { id: 'fit', label: 'Best Fit' },
  { id: '25', label: '25%' },
  { id: '50', label: '50%' },
  { id: '100', label: '100%' },
  { id: '200', label: '200%' },
];

/** The Video Display scaling in effect (Preferences key videoZoom). */
export const videoZoom = (app) => (VIDEO_ZOOMS.some((z) => z.id === app.prefs.get('videoZoom')) ? app.prefs.get('videoZoom') : 'fit');

/** How often (ms) a playing video is checked against the playhead. */
const CHECK_MS = 250;

export function videoPanel(app) {
  const video = h('video.video-el', { muted: true, playsInline: true, preload: 'auto', disablePictureInPicture: true, 'aria-hidden': 'true' });
  video.muted = true;
  const timecode = h('div.video-timecode', { 'aria-hidden': 'true' });
  const frame = h('div.video-frame', video, timecode);
  const stage = h('div.video-stage', frame);
  const emptyText = h('p.muted');
  const empty = h('div.empty-state.video-empty', icon('video-off', 28), h('strong', 'No video'), emptyText);
  const info = h('div.video-info', { role: 'status' });
  const el = h('div.video-panel', { role: 'region', 'aria-label': 'Video' }, stage, empty, info);
  let visible = false;
  let raf = 0;
  let session = null;
  let src = null;
  let lastCheck = 0;
  let pendingSeek = null;

  const target = () => {
    const clip = session && videoClip(session.viewState);
    if (!clip) return null;
    const frameAt = app.active === session ? app.playhead : session.cursor;
    const t = videoTimeAt(clip, frameAt, session.sampleRate);
    if (t === null) return null;
    const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : src?.duration || Infinity;
    return Math.min(t, Math.max(0, dur - 0.001));
  };

  const seek = (t) => {
    if (video.readyState === 0) {
      pendingSeek = t;
      return;
    }
    if (video.seeking) {
      pendingSeek = t;
      return;
    }
    pendingSeek = null;
    video.currentTime = t;
  };
  video.addEventListener('seeked', () => {
    if (pendingSeek !== null && Math.abs(pendingSeek - video.currentTime) > 0.001) seek(pendingSeek);
  });
  video.addEventListener('loadedmetadata', () => {
    layout();
    if (pendingSeek !== null) seek(pendingSeek);
    sync(true);
  });

  const playing = () => app.engine.playing && !app.scrubbing && app.active === session;

  /** Brings the video to the playhead; `force` checks drift now instead of on the next interval. */
  const sync = (force = false) => {
    if (!session || !src?.blob) return;
    const t = target();
    frame.classList.toggle('outside', t === null);
    timecode.textContent = app.prefs.get('videoTimecode') ? timecodeText(t) : '';
    if (t === null) {
      if (!video.paused) video.pause();
      return;
    }
    if (!playing()) {
      if (!video.paused) video.pause();
      video.playbackRate = 1;
      const step = syncStep({ current: video.currentTime, target: t, playing: false, fps: src.fps });
      if (step?.seek !== undefined) seek(step.seek);
      return;
    }
    if (video.paused) {
      seek(t);
      video.play().catch(() => {});
      lastCheck = performance.now();
      return;
    }
    const now = performance.now();
    if (!force && now - lastCheck < CHECK_MS) return;
    lastCheck = now;
    if (video.seeking) return;
    const step = syncStep({ current: video.currentTime, target: t, playing: true, fps: src.fps });
    if (!step) return;
    if (step.seek !== undefined) seek(step.seek);
    if (step.rate && Math.abs(video.playbackRate - step.rate) > 0.001) video.playbackRate = step.rate;
  };

  /** Overlay text: session time at the playhead, or the time within the video file. */
  const timecodeText = (t) => {
    if (app.prefs.get('videoTcReference') === 'source') return t === null ? '' : app.formatTime(Math.round(t * session.sampleRate), session.sampleRate);
    return app.formatTime(app.active === session ? app.playhead : session.cursor, session.sampleRate);
  };

  const styleTimecode = () => {
    const p = app.prefs;
    const pos = String(p.get('videoTcPosition') || 'bc');
    timecode.dataset.pos = /^[tmb][lcr]$/.test(pos) ? pos : 'bc';
    const size = Math.max(10, Math.min(100, Number(p.get('videoTcSize')) || 30));
    const opacity = Math.max(0, Math.min(100, Number(p.get('videoTcOpacity') ?? 65)));
    timecode.style.setProperty('--tc-size', String(size / 100));
    timecode.style.setProperty('--tc-bg', `rgba(0, 0, 0, ${opacity / 100})`);
  };
  styleTimecode();

  stage.addEventListener('dblclick', () => {
    if (!app.prefs.get('videoFullscreen') || !src?.blob) return;
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else stage.requestFullscreen?.().catch(() => {});
  });

  const layout = () => {
    const zoom = videoZoom(app);
    el.dataset.zoom = zoom;
    const w = video.videoWidth || src?.width || 0;
    const hgt = video.videoHeight || src?.height || 0;
    if (zoom === 'fit' || !w || !hgt) {
      frame.style.width = '';
      frame.style.height = '';
    } else {
      const k = Number(zoom) / 100;
      frame.style.width = `${Math.round(w * k)}px`;
      frame.style.height = `${Math.round(hgt * k)}px`;
    }
    const z = VIDEO_ZOOMS.find((x) => x.id === zoom)?.label || '';
    const parts = src ? [src.name, w && hgt ? `${w}×${hgt}` : '', src.fps ? `${src.fps} fps` : '', z] : [];
    info.textContent = parts.filter(Boolean).join(' · ');
  };

  /** Picks up the active session's video (or its absence). */
  const update = () => {
    const doc = app.active?.kind === 'session' ? app.active : null;
    const clip = doc && videoClip(doc.viewState);
    session = clip ? doc : null;
    const next = clip ? videoPool(doc).get(clip.sourceId) || null : null;
    if (next !== src) {
      src = next;
      const url = videoURL(src);
      if (url) {
        if (video.src !== url) video.src = url;
      } else if (video.getAttribute('src')) {
        video.removeAttribute('src');
        video.load();
      }
      lastCheck = 0;
    }
    const has = Boolean(src?.blob);
    stage.hidden = !has;
    info.hidden = !has;
    empty.hidden = has;
    emptyText.textContent = src && !src.blob
      ? `The video "${src.name}" is offline. Insert the file into the session again to show it here.`
      : 'Insert a video file into a multitrack session (Multitrack > Insert Files, or drop it on the tracks) to watch it here in sync with the audio.';
    layout();
    sync(true);
    schedule();
  };

  const tick = () => {
    raf = 0;
    if (!visible) return;
    sync();
    if (app.engine.playing) schedule();
  };
  const schedule = () => {
    if (!raf && visible) raf = requestAnimationFrame(tick);
  };

  app.on('active', update);
  app.on('transport', () => {
    sync(true);
    schedule();
  });
  app.on('doc-change', (doc, e) => {
    if (doc !== app.active) return;
    if (e.kind === 'edit' || e.kind === 'history' || e.kind === 'preview' || e.kind === 'graph') update();
    else if (e.kind === 'cursor' && !app.engine.playing) sync(true);
  });
  app.on('prefs', (key) => {
    if (key === 'videoZoom') layout();
    if (key === 'videoTimecode' || key === 'videoTcReference') sync(true);
    if (key === 'videoTcSize' || key === 'videoTcOpacity' || key === 'videoTcPosition') styleTimecode();
  });
  update();

  return {
    el,
    show() {
      visible = true;
      update();
    },
    hide() {
      visible = false;
      if (!video.paused) video.pause();
    },
  };
}
