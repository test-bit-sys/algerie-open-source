/**
 * Page-level undo history. Each entry is a serialized snapshot of the
 * page's editable state plus where the caret was, so undo works the same for
 * typing, moving containers, ink and page settings.
 */
export class History {
  constructor(limit = 200) {
    this.limit = limit;
    this.stack = [];
    this.index = -1;
  }

  reset(snapshot, caret = null) {
    this.stack = [{ snapshot, caret }];
    this.index = 0;
  }

  /** Records a new state; returns false when nothing changed. */
  push(snapshot, caret = null) {
    const current = this.stack[this.index];
    if (current && current.snapshot === snapshot) {
      current.caret = caret;
      return false;
    }
    this.stack.length = this.index + 1;
    this.stack.push({ snapshot, caret });
    if (this.stack.length > this.limit) this.stack.shift();
    this.index = this.stack.length - 1;
    return true;
  }

  canUndo() {
    return this.index > 0;
  }

  canRedo() {
    return this.index < this.stack.length - 1;
  }

  /** Returns the entry to restore and the caret to put back. */
  undo() {
    if (!this.canUndo()) return null;
    const leaving = this.stack[this.index];
    this.index--;
    return { ...this.stack[this.index], caret: leaving.caretBefore ?? this.stack[this.index].caret };
  }

  redo() {
    if (!this.canRedo()) return null;
    this.index++;
    return this.stack[this.index];
  }
}

/** The parts of a page that undo restores. */
export function snapshotOf(page) {
  return JSON.stringify({ title: page.title, outlines: page.outlines, ink: page.ink, color: page.color, rules: page.rules, ruleColor: page.ruleColor });
}

export function applySnapshot(page, snapshot) {
  const s = JSON.parse(snapshot);
  page.title = s.title;
  page.outlines = s.outlines;
  page.ink = s.ink;
  page.color = s.color;
  page.rules = s.rules;
  page.ruleColor = s.ruleColor;
}
