import { openDataDialog } from './data-io.js';
import { toast } from './toast.js';

/** Accept external files on any calendar view; leave event/text drags alone. */
export function bindCalendarFileDrop(calendar, { store, canImport }) {
  let depth = 0;
  const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
  const isTarget = (e) => calendar.contains(e.target) && canImport();
  const reset = () => {
    depth = 0;
    calendar.classList.remove('is-file-drop-target');
  };

  function enter(e) {
    if (!hasFiles(e) || !isTarget(e)) return;
    depth++;
    calendar.classList.add('is-file-drop-target');
  }

  function leave(e) {
    if (!calendar.contains(e.target)) return;
    if (--depth <= 0) reset();
  }

  function over(e) {
    if (!hasFiles(e)) return;
    // Prevent the browser from opening a dropped file, including outside the
    // calendar or over an editor that must not be interrupted by an import.
    e.preventDefault();
    const allowed = isTarget(e);
    e.dataTransfer.dropEffect = allowed ? 'copy' : 'none';
    calendar.classList.toggle('is-file-drop-target', allowed);
  }

  function drop(e) {
    reset();
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (!isTarget(e)) return;
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length !== 1) {
      toast('Drop one calendar file at a time.', { variant: 'danger' });
      return;
    }
    const file = files[0];
    if (!/\.(ics|ical|json)$/i.test(file.name)) {
      toast('Choose an .ics, .ical, or .json calendar file.', { variant: 'danger' });
      return;
    }
    openDataDialog({ store, file });
  }

  const listeners = { dragenter: enter, dragleave: leave, dragover: over, drop, dragend: reset };
  for (const [type, handler] of Object.entries(listeners)) document.addEventListener(type, handler);
  window.addEventListener('blur', reset);
  return () => {
    reset();
    for (const [type, handler] of Object.entries(listeners)) document.removeEventListener(type, handler);
    window.removeEventListener('blur', reset);
  };
}
