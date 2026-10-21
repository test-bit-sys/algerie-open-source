/**
 * jsdom does not run the script sandbox's iframe: this answers its port with
 * `handler(message, port)` instead of the real loader. Call it once the
 * sandbox has added its iframe (on its first run). `mode` is what the loader
 * reports ('worker' or 'inline'); `iframe` picks another sandbox iframe than
 * the first. Returns the init message the host sent.
 */
export function fakeLoader(handler, { mode = 'worker', iframe = document.querySelector('iframe[title="Script sandbox"]') } = {}) {
  let init = null;
  const contentWindow = {
    postMessage(data, _origin, [port]) {
      init = data;
      port.onmessage = (e) => handler(e.data, port);
      port.postMessage({ type: 'ready', mode });
    },
  };
  Object.defineProperty(iframe, 'contentWindow', { value: contentWindow });
  iframe.dispatchEvent(new Event('load'));
  return init;
}
