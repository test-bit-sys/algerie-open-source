/** Random id, sortable-ish by time prefix so stable sorts stay stable. */
export function uid() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${Date.now().toString(36)}-${rand}`;
}

export function debounce(fn, ms) {
  let timer = null;
  const run = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  run.cancel = () => clearTimeout(timer);
  return run;
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/** "3 subtasks", "1 subtask" */
export function plural(n, word, suffix = 's') {
  return `${n} ${word}${n === 1 ? '' : suffix}`;
}

/** Case/accent-insensitive substring match for search. */
export function fuzzyIncludes(haystack, needle) {
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return norm(haystack).includes(norm(needle));
}
