// Linear undo history of immutable document states. Every entry stores a full
// state object; states share sample blocks, so snapshots are cheap. The
// History panel lists entries and can jump to any of them.

import { Emitter } from './emitter.js';

export class History extends Emitter {
  constructor(initial, { label = 'Open', limit = 200 } = {}) {
    super();
    this.entries = [{ label, state: initial, time: Date.now() }];
    this.index = 0;
    this.limit = limit;
  }

  get state() {
    return this.entries[this.index].state;
  }

  get canUndo() {
    return this.index > 0;
  }

  get canRedo() {
    return this.index < this.entries.length - 1;
  }

  get undoLabel() {
    return this.canUndo ? this.entries[this.index].label : '';
  }

  get redoLabel() {
    return this.canRedo ? this.entries[this.index + 1].label : '';
  }

  /** Records a new state, dropping any redo entries. */
  push(label, state, extra = {}) {
    this.entries.length = this.index + 1;
    this.entries.push({ label, state, time: Date.now(), ...extra });
    if (this.entries.length > this.limit) this.entries.splice(1, this.entries.length - this.limit);
    this.index = this.entries.length - 1;
    this.emit('change', this);
  }

  /** Replaces the current entry's state without a new step (e.g. coalesced drags). */
  amend(state) {
    this.entries[this.index].state = state;
    this.emit('change', this);
  }

  /** Replaces the current state without an undo step, dropping redo entries (changes kept out of history). */
  replace(state) {
    this.entries.length = this.index + 1;
    this.amend(state);
  }

  /**
   * A change kept out of history (markers when marker edits are not undoable):
   * the current entry becomes `state` and every other entry, before or after
   * it, gets the same change through `carry(entryState)`, so undo and redo
   * neither add nor drop it.
   */
  outside(state, carry) {
    this.entries = this.entries.map((e, i) => (i === this.index ? { ...e, state } : { ...e, state: carry(e.state) }));
    this.emit('change', this);
  }

  undo() {
    if (!this.canUndo) return false;
    this.index--;
    this.emit('change', this);
    return true;
  }

  redo() {
    if (!this.canRedo) return false;
    this.index++;
    this.emit('change', this);
    return true;
  }

  goTo(index) {
    if (index < 0 || index >= this.entries.length || index === this.index) return false;
    this.index = index;
    this.emit('change', this);
    return true;
  }

  /** Drops the entries after the current one (nothing left to redo). */
  dropRedo() {
    if (!this.canRedo) return false;
    this.entries.length = this.index + 1;
    this.emit('change', this);
    return true;
  }

  clear() {
    this.entries = [this.entries[this.index]];
    this.index = 0;
    this.emit('change', this);
  }
}
