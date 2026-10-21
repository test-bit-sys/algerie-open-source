/**
 * Signature capture: draw, type, or upload. Resolves to
 * { dataUrl, saveAsDefault } or null if dismissed. The produced image is a
 * transparent PNG trimmed to its content, ready to be drawn into a PDF.
 */

import { el, clear, append, fieldId } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { bindDropzone } from './dropzone.js';

const INK = '#14141f';

/* The sign worker drops any image over its 300k-char cap at submit (the
   signer would get an opaque failure). Keep uploads comfortably under it. */
const MAX_UPLOAD_CHARS = 250_000;

function trimCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  if (!width || !height) return canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return canvas; // empty
  const pad = 8;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext('2d').drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

function typedToDataUrl(text, style) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = style === 'plain'
    ? 'italic 64px Georgia, "Times New Roman", serif'
    : '64px "Snell Roundhand", "Savoye LET", "Segoe Script", "Brush Script MT", cursive';
  ctx.font = font;
  const width = Math.ceil(ctx.measureText(text).width);
  canvas.width = Math.min(1200, width + 32);
  canvas.height = 150;
  const ctx2 = canvas.getContext('2d');
  ctx2.font = font;
  ctx2.fillStyle = INK;
  ctx2.textBaseline = 'middle';
  const scale = Math.min(1, (canvas.width - 24) / Math.max(1, width));
  ctx2.setTransform(scale, 0, 0, scale, 16, canvas.height / 2);
  ctx2.fillText(text, 0, 0);
  return trimCanvas(canvas).toDataURL('image/png');
}

export function openSignaturePad({
  title = 'Add your signature',
  kind = 'signature', // 'signature' | 'initials', for button and alt copy
  suggestedName = '',
  saved = null, // a previously saved data URL, offered for one-tap reuse
  allowSave = true,
} = {}) {
  const useLabel = kind === 'initials' ? 'Use these initials' : 'Use this signature';
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    // Teardown for whatever the visible pane set up (the Draw pane observes
    // its canvas). Every other surface in the app disconnects its observers on
    // destroy; this one had nowhere to do it, so each render left one behind
    // holding a full-width canvas backing store - and signing a document with
    // initials on every page opens this dialog once per field.
    let paneCleanup = null;
    const teardown = () => {
      paneCleanup?.();
      paneCleanup = null;
    };

    const body = el('div');
    const modal = openModal({
      title,
      content: body,
      onClose: () => {
        teardown();
        done(null);
      },
    });
    const finish = (dataUrl) => {
      const saveAsDefault = allowSave && saveCheck.querySelector('input')?.checked === true;
      done({ dataUrl, saveAsDefault });
      modal.close();
    };

    /* Tabs */
    const tabs = ['Draw', 'Type', 'Upload'];
    if (saved) tabs.unshift('Saved');
    let active = tabs[0];
    // Toggle-button group, not a tablist: there is no tabpanel wiring or
    // arrow-key handling here, and the app's other segmented controls
    // (theme, signature style) already use this pattern.
    const tabBar = el('div.seg.sigpad-tabs', { role: 'group', 'aria-label': 'Signature method' });
    const pane = el('div');
    const saveId = fieldId('savesig');
    const saveCheck = el('label.check-row', { for: saveId, style: { marginTop: '14px' } },
      el('input', { type: 'checkbox', id: saveId }),
      'Save as my signature for next time');

    function renderTabs() {
      clear(tabBar);
      for (const tab of tabs) {
        tabBar.append(el('button', {
          type: 'button',
          'aria-pressed': tab === active ? 'true' : 'false',
          onclick: () => { active = tab; renderTabs(); renderPane(); },
        }, tab));
      }
    }

    function renderPane() {
      teardown();
      clear(pane);
      if (active === 'Saved') renderSaved();
      else if (active === 'Draw') renderDraw();
      else if (active === 'Type') renderType();
      else renderUpload();
    }

    /* Saved */
    function renderSaved() {
      pane.append(
        el('div.sig-preview', {}, el('img', { src: saved, alt: kind === 'initials' ? 'Your saved initials' : 'Your saved signature' })),
        el('div.sigpad-actions', {},
          el('button.btn.btn-primary', { type: 'button', onclick: () => finish(saved) }, useLabel)
        )
      );
    }

    /* Draw */
    function renderDraw() {
      const canvas = el('canvas.sigpad-canvas');
      const surface = el('div.sigpad-surface', {}, canvas,
        el('div.sigpad-line'),
        el('div.sigpad-hint', {}, kind === 'initials' ? 'Draw your initials above the line' : 'Draw your signature above the line'),
        el('button.icon-btn.sigpad-clear', {
          type: 'button', html: icon('eraser', 17), 'aria-label': 'Clear drawing',
          // The eraser is on screen before the first measurement, so it must
          // not assume a context.
          onclick: () => { ctx?.clearRect(0, 0, canvas.width, canvas.height); hasInk = false; useBtn.disabled = true; },
        })
      );
      let ctx = null;
      let hasInk = false;
      let drawing = false;
      let last = null;

      // The CSS size the backing store is currently mapped to, so ink drawn
      // before a resize can be put back at the size it was drawn.
      let inkW = 0;
      let inkH = 0;

      const setup = () => {
        const dpr = Math.min(devicePixelRatio || 1, 2);
        // offsetWidth/Height: the dialog's opening animation scales it, and a
        // rect measured mid-animation would skew the stroke-to-pixel mapping.
        const w = canvas.offsetWidth || canvas.getBoundingClientRect().width;
        const h = canvas.offsetHeight || canvas.getBoundingClientRect().height;
        const width = Math.max(1, Math.round(w * dpr));
        const height = Math.max(1, Math.round(h * dpr));
        if (ctx && canvas.width === width && canvas.height === height) return;
        // Resizing a canvas clears it, so carry whatever has been drawn over —
        // at the size it was drawn, never rescaled to the new box. This image
        // becomes the signature on the document: a pad that got wider must not
        // stretch the signature with it.
        let drawn = null;
        if (hasInk && canvas.width > 1 && canvas.height > 1) {
          drawn = document.createElement('canvas');
          drawn.width = canvas.width;
          drawn.height = canvas.height;
          drawn.getContext('2d').drawImage(canvas, 0, 0);
        }
        const wasW = inkW || w;
        const wasH = inkH || h;
        canvas.width = width;
        canvas.height = height;
        inkW = w;
        inkH = h;
        ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = INK;
        ctx.fillStyle = INK;
        if (drawn) ctx.drawImage(drawn, 0, 0, wasW, wasH);
      };
      requestAnimationFrame(setup);
      /**
       * The pad is as wide as the dialog, which on a phone is as wide as the
       * screen: rotating it (or resizing a window) changes the pad's width
       * while the backing store keeps the old one, and everything drawn past
       * the old edge lands nowhere. Re-measuring on the element's own resize
       * also covers the first measurement, whenever the box actually settles.
       */
      const resizer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => setup()) : null;
      resizer?.observe(canvas);
      paneCleanup = () => resizer?.disconnect();

      const pos = (e) => {
        const rect = canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top, p: e.pressure || 0.5 };
      };
      canvas.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
        drawing = true;
        last = pos(e);
        if (!ctx) return;
        // A tap has no pointermove, and a zero-length stroke paints nothing:
        // put down a dot so i's can be dotted and taps aren't swallowed.
        ctx.beginPath();
        ctx.arc(last.x, last.y, (1.6 + last.p * 2.2) / 2, 0, Math.PI * 2);
        ctx.fill();
        if (!hasInk) {
          hasInk = true;
          useBtn.disabled = false;
        }
      });
      canvas.addEventListener('pointermove', (e) => {
        if (!drawing || !ctx) return;
        const pt = pos(e);
        ctx.lineWidth = 1.6 + pt.p * 2.2;
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        // Midpoint smoothing keeps fast strokes from looking like polylines.
        ctx.quadraticCurveTo(last.x, last.y, (last.x + pt.x) / 2, (last.y + pt.y) / 2);
        ctx.lineTo(pt.x, pt.y);
        ctx.stroke();
        last = pt;
        if (!hasInk) {
          hasInk = true;
          useBtn.disabled = false;
        }
      });
      const stop = () => { drawing = false; };
      canvas.addEventListener('pointerup', stop);
      canvas.addEventListener('pointercancel', stop);

      const useBtn = el('button.btn.btn-primary', {
        type: 'button', disabled: true,
        onclick: () => {
          const trimmed = trimCanvas(canvas);
          finish(trimmed.toDataURL('image/png'));
        },
      }, useLabel);
      append(pane, [surface, allowSave && saveCheck, el('div.sigpad-actions', {}, useBtn)]);
    }

    /* Type */
    function renderType() {
      let style = 'cursive';
      const nameId = fieldId('signame');
      const input = el('input.input', {
        id: nameId, type: 'text', value: suggestedName,
        placeholder: kind === 'initials' ? 'Type your initials' : 'Type your name',
        autocomplete: kind === 'initials' ? 'off' : 'name', maxLength: 80,
        oninput: update,
      });
      const placeholderText = kind === 'initials' ? 'Your initials' : 'Your name';
      const preview = el('span.style-cursive', {}, suggestedName || placeholderText);
      const previewWrap = el('div.sigpad-typed', { 'aria-hidden': 'true' }, preview);
      const styleSeg = el('div.seg', { role: 'group', 'aria-label': 'Signature style' });
      const useBtn = el('button.btn.btn-primary', {
        type: 'button', disabled: !suggestedName.trim(),
        onclick: () => finish(typedToDataUrl(input.value.trim(), style)),
      }, useLabel);

      function renderStyles() {
        clear(styleSeg);
        for (const s of [{ id: 'cursive', label: 'Flowing' }, { id: 'plain', label: 'Classic' }]) {
          styleSeg.append(el('button', {
            type: 'button', 'aria-pressed': s.id === style ? 'true' : 'false',
            onclick: () => { style = s.id; renderStyles(); update(); },
          }, s.label));
        }
      }
      function update() {
        const text = input.value.trim();
        preview.textContent = text || placeholderText;
        preview.className = style === 'plain' ? 'style-plain' : 'style-cursive';
        useBtn.disabled = !text;
      }
      renderStyles();
      append(pane, [
        el('div.field', {}, el('label', { for: nameId }, kind === 'initials' ? 'Initials' : 'Full name'), input),
        styleSeg,
        previewWrap,
        allowSave && saveCheck,
        el('div.sigpad-actions', {}, useBtn),
      ]);
    }

    /* Upload */
    function renderUpload() {
      const preview = el('div.sig-preview', {}, el('span.faint.small', {}, 'No image yet'));
      let dataUrl = null;
      const useBtn = el('button.btn.btn-primary', {
        type: 'button', disabled: true,
        onclick: () => finish(dataUrl),
      }, useLabel);
      const loadFile = (file) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onerror = () => {
          URL.revokeObjectURL(url);
          dataUrl = null;
          useBtn.disabled = true;
          clear(preview);
          preview.append(el('span.faint.small', {}, 'Could not read that image. Try a PNG or JPG file.'));
        };
        img.onload = () => {
          const scale = Math.min(1, 800 / img.width, 300 / img.height);
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          dataUrl = canvas.toDataURL('image/png');
          // Photos compress poorly as PNG and can blow past the worker's
          // per-image cap. Re-encode busy images as JPEG on white (JPEG
          // has no alpha; the default fill would be black) until they fit.
          if (dataUrl.length > MAX_UPLOAD_CHARS) {
            const flat = document.createElement('canvas');
            flat.width = canvas.width;
            flat.height = canvas.height;
            const fctx = flat.getContext('2d');
            fctx.fillStyle = '#ffffff';
            fctx.fillRect(0, 0, flat.width, flat.height);
            fctx.drawImage(canvas, 0, 0);
            for (const quality of [0.85, 0.7, 0.55]) {
              dataUrl = flat.toDataURL('image/jpeg', quality);
              if (dataUrl.length <= MAX_UPLOAD_CHARS) break;
            }
          }
          URL.revokeObjectURL(url);
          clear(preview);
          preview.append(el('img', { src: dataUrl, alt: 'Uploaded signature preview' }));
          useBtn.disabled = false;
        };
        img.src = url;
      };
      const fileInput = el('input', {
        type: 'file', accept: 'image/png,image/jpeg,image/webp', className: 'visually-hidden',
        onchange: () => {
          const file = fileInput.files && fileInput.files[0];
          if (file) loadFile(file);
        },
      });
      // The zone shows a copy cursor while a file is over it (see main.js), so
      // it has to take the drop as well, like the PDF zone does.
      const zone = bindDropzone(
        el('button.dropzone', { type: 'button', onclick: () => fileInput.click(), style: { padding: '22px' } },
          el('span', { html: icon('upload', 22) }),
          el('span.dz-title', {}, 'Choose an image or drop it here'),
          el('span.dz-sub', {}, 'PNG or JPG of your signature, ideally on a plain background')
        ),
        loadFile);
      append(pane, [
        zone,
        fileInput,
        el('div', { style: { marginTop: '12px' } }, preview),
        allowSave && saveCheck,
        el('div.sigpad-actions', {}, useBtn),
      ]);
    }

    renderTabs();
    renderPane();
    body.append(tabBar, pane);
  });
}
