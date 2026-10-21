/**
 * Shared drag-and-drop wiring for `.dropzone` buttons, so every zone that
 * shows the copy cursor actually accepts what is dropped on it, and highlights
 * the same way while it does.
 */

/**
 * Highlight while a file is dragged over `zone`, and hand what was dropped to
 * `onFile(first, all)`. Zones that take one file read the first argument;
 * zones that build a document from several read the second.
 */
export function bindDropzone(zone, onFile) {
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('over');
  });
  // dragleave also fires when the pointer crosses onto one of the zone's own
  // children (the icon, the labels), which flickered the highlight off and on
  // for the whole drag. Only a pointer outside the zone has really left it.
  zone.addEventListener('dragleave', (e) => {
    const r = zone.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX < r.right
      && e.clientY >= r.top && e.clientY < r.bottom;
    if (!inside) zone.classList.remove('over');
  });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    const all = [...(e.dataTransfer?.files || [])];
    if (all.length) onFile(all[0], all);
  });
  return zone;
}
