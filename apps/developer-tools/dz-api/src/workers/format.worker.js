// Pretty-prints response bodies off the main thread.
import { prettyOrSame, decodeText } from '../core/pretty.js';

self.onmessage = (e) => {
  const { id, bytes, text, language, charset } = e.data;
  try {
    const source = text ?? decodeText(bytes, charset);
    self.postMessage({ id, text: source, pretty: prettyOrSame(source, language) });
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
