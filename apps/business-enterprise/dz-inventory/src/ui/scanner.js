/**
 * Barcode scanning.
 *
 * Three ways in, in the order they're worth using:
 *   1. A hardware scanner (USB or Bluetooth) types the code and presses
 *      Enter — `listenForScans` picks that up anywhere in the app.
 *   2. The phone camera, through the platform's BarcodeDetector.
 *   3. Typing the code, which always works.
 *
 * There is no bundled decoder: a WASM fallback would cost more than the
 * rest of the app put together, so browsers without BarcodeDetector get
 * (1) and (3) and are told so plainly.
 */

import { el, clear, CODE_FIELD } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'codabar', 'qr_code'];

export function cameraScanSupported() {
  return typeof window !== 'undefined'
    && 'BarcodeDetector' in window
    && !!navigator.mediaDevices?.getUserMedia
    && window.isSecureContext;
}

/**
 * Open the scan dialog.
 *
 * onCode(code) may return a promise; while it runs the scanner pauses.
 * Return false from it to keep the dialog open (a miss the user should
 * try again), anything else closes it — unless `continuous`, where the
 * dialog stays up for the next item.
 */
export function openScanner({
  title = 'Scan a barcode',
  hint = 'Point the camera at the barcode, or type the code below.',
  continuous = false,
  onCode,
} = {}) {
  const body = el('div');
  const status = el('p.hint', { 'aria-live': 'polite' }, hint);
  const stage = el('div.scan-stage');
  const video = el('video', { playsInline: true, muted: true, autoplay: true });

  const manual = el('input.input', {
    ...CODE_FIELD,
    placeholder: 'e.g. 5901234123457',
    'aria-label': 'Barcode',
    autocomplete: 'off',
    // A hardware scanner types straight in here and presses Enter.
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); submitManual(); } },
  });

  let stream = null;
  let detector = null;
  let timer = null;
  let busy = false;
  let closed = false;
  let lastCode = '';
  let lastAt = 0;

  /** Replace the preview with an explanation of why there isn't one. */
  function showStageMessage(ic, title, detail) {
    clear(stage);
    stage.classList.remove('live');
    // Nothing is ever going to fill this box now, so it stops holding a
    // camera's worth of room for a two-line message (see the stylesheet).
    stage.classList.add('no-camera');
    stage.append(el('div.scan-fallback', { html: icon(ic, 26) },
      el('p', {}, title),
      el('p.small.muted', {}, detail)
    ));
  }

  async function start() {
    if (!cameraScanSupported()) {
      showStageMessage('barcode', 'This browser can’t use the camera to scan.',
        'A USB or Bluetooth scanner works anywhere in the app, or type the code below.');
      manual.focus();
      return;
    }
    // Permission can sit unanswered for a while; say what's happening
    // instead of showing an empty box.
    const waiting = el('div.scan-fallback', { html: icon('barcode', 26) },
      el('p', {}, 'Starting the camera…'),
      el('p.small.muted', {}, 'Allow camera access when your browser asks.')
    );
    stage.append(waiting);
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      if (closed) return;
      const formats = FORMATS.filter((f) => supported.includes(f));
      detector = new window.BarcodeDetector(formats.length ? { formats } : undefined);
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      if (closed) return stop();
      video.srcObject = stream;
      await video.play().catch(() => {});
      if (closed) return stop();
      waiting.remove();
      stage.classList.add('live');
      timer = setInterval(tick, 250);
    } catch (err) {
      if (closed) return;
      console.error(err);
      showStageMessage('circleAlert',
        err?.name === 'NotAllowedError' ? 'Camera access was blocked.' : 'The camera isn’t available.',
        'Type the code below, or use a USB or Bluetooth scanner.');
      manual.focus();
    }
  }

  async function tick() {
    if (busy || closed || video.readyState < 2) return;
    // A dialog stacked on top — a stock sheet, the "Add it" product
    // form — owns the screen. Detecting through it would pop dialogs
    // and toasts under whatever the user is doing there, so hold fire
    // until this scanner is the topmost dialog again.
    const open = document.querySelectorAll('.modal-root:not(.closing)');
    if (open[open.length - 1] !== body.closest('.modal-root')) return;
    busy = true;
    try {
      const [hit] = await detector.detect(video);
      if (hit?.rawValue) await handle(hit.rawValue, true);
    } catch {
      /* A frame that can't be decoded is the normal case, not an error. */
    } finally {
      busy = false;
    }
  }

  async function handle(code, fromCamera) {
    if (closed) return;
    const value = String(code || '').trim();
    if (!value) return;
    // The camera sees the same barcode many times a second; one hit per
    // code per second is what a person means by "a scan".
    const now = Date.now();
    if (fromCamera && value === lastCode && now - lastAt < 1500) return;
    lastCode = value;
    lastAt = now;
    navigator.vibrate?.(40);
    pause();
    const keepOpen = await onCode?.(value);
    if (closed) return;
    if (continuous || keepOpen === false) {
      status.textContent = continuous ? `Scanned ${value}. Ready for the next one.` : hint;
      resume();
    } else {
      close();
    }
  }

  function submitManual() {
    const value = manual.value.trim();
    if (!value) return;
    manual.value = '';
    handle(value, false);
  }

  const pause = () => { clearInterval(timer); timer = null; };
  const resume = () => { if (!timer && detector && !closed) timer = setInterval(tick, 250); };

  function stop() {
    clearInterval(timer);
    timer = null;
    for (const track of stream?.getTracks() || []) track.stop();
    stream = null;
    video.srcObject = null;
  }

  stage.append(video);
  body.append(
    stage,
    status,
    el('div.field', { style: { marginTop: '12px' } },
      el('label', { htmlFor: 'scan-manual' }, 'Or enter the code'),
      el('div.row', {},
        Object.assign(manual, { id: 'scan-manual' }),
        el('button.btn.btn-secondary', { type: 'button', onclick: submitManual }, 'Look up')
      )
    )
  );

  const modal = openModal({
    title,
    content: body,
    onClose: () => { closed = true; stop(); },
  });

  function close() {
    closed = true;
    stop();
    modal.close();
  }

  start();
  return { close, status };
}

/* ---------- Hardware scanners ---------- */

/** Characters this fast in a row can only be a machine typing. */
const WEDGE_MAX_GAP = 40;
const WEDGE_MIN_LENGTH = 4;

/**
 * Watch for a USB/Bluetooth scanner, which acts as a keyboard: a burst
 * of keystrokes ending in Enter. Typing into a field is left alone, so
 * this never steals what someone is writing.
 *
 * Returns a function that stops listening.
 */
export function listenForScans(onCode, { target = document } = {}) {
  let buffer = '';
  let last = 0;

  const onKeyDown = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const node = e.target;
    const editable = node instanceof HTMLElement
      && (node.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName));
    if (editable) return;
    // A dialog on top owns the keyboard; the sheet's own field handles it.
    if (document.querySelector('.modal-root:not(.closing)')) return;
    // A scanner presses Shift before each uppercase character; that's
    // part of the burst, not a break in it — resetting here would mangle
    // any mixed-case code down to whatever followed the last Shift.
    if (e.key === 'Shift') return;

    const now = Date.now();
    const gap = now - last;
    last = now;
    if (gap > WEDGE_MAX_GAP) buffer = '';

    if (e.key === 'Enter') {
      const code = buffer.trim();
      buffer = '';
      if (code.length >= WEDGE_MIN_LENGTH) {
        e.preventDefault();
        onCode(code);
      }
      return;
    }
    if (e.key.length === 1) buffer += e.key;
    else buffer = '';
  };

  target.addEventListener('keydown', onKeyDown);
  return () => target.removeEventListener('keydown', onKeyDown);
}
