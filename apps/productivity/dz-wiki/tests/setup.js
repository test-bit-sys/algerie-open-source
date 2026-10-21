// jsdom lacks a few browser APIs the app touches.
if (!globalThis.URL.createObjectURL) globalThis.URL.createObjectURL = () => 'blob:test';
if (!globalThis.URL.revokeObjectURL) globalThis.URL.revokeObjectURL = () => {};
if (!globalThis.structuredClone) globalThis.structuredClone = (v) => JSON.parse(JSON.stringify(v));
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (!window.matchMedia) {
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.matchMedia = window.matchMedia;
}
if (!globalThis.CSS) globalThis.CSS = {};
if (!CSS.escape) CSS.escape = (s) => String(s).replace(/[^\w-]/g, (c) => `\\${c}`);
if (!globalThis.requestAnimationFrame) globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
if (!globalThis.cancelAnimationFrame) globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
}
if (!Element.prototype.scrollTo) Element.prototype.scrollTo = function scrollTo() {};
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = function scrollIntoView() {};
if (!globalThis.crypto?.randomUUID) {
  const { webcrypto } = await import('node:crypto');
  globalThis.crypto = webcrypto;
}
// jsdom has no layout: ranges report empty rects.
if (typeof Range !== 'undefined' && !Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
  Range.prototype.getClientRects = () => [];
}
if (typeof DOMRect === 'undefined') {
  globalThis.DOMRect = class {
    constructor(x = 0, y = 0, width = 0, height = 0) {
      Object.assign(this, { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height });
    }
  };
}
