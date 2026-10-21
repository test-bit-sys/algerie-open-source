/** Minimal event emitter. on() returns an unsubscribe function. */
export class Emitter {
  #handlers = new Map();
  on(type, fn) {
    if (!this.#handlers.has(type)) this.#handlers.set(type, new Set());
    this.#handlers.get(type).add(fn);
    return () => this.#handlers.get(type)?.delete(fn);
  }
  emit(type, detail) {
    for (const fn of this.#handlers.get(type) || []) {
      try {
        fn(detail);
      } catch (err) {
        console.error(err);
      }
    }
  }
}
