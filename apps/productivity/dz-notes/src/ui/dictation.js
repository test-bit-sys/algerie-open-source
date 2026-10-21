import { announce } from '../lib/dom.js';
import { toast } from './toast.js';
import { insertText } from '../editor/format.js';

/** Home > Dictate: speech to text at the caret, where the browser supports it. */
export class Dictation {
  constructor(app) {
    this.app = app;
    this.Recognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
    this.supported = Boolean(this.Recognition);
    this.active = false;
    this.rec = null;
  }

  toggle() {
    if (this.active) this.stop();
    else this.start();
  }

  start() {
    if (!this.supported) {
      toast('Dictation is not available in this browser.');
      return;
    }
    this.app.editor.ensureCaret();
    const rec = new this.Recognition();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = navigator.language || 'en-US';
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (!e.results[i].isFinal) continue;
        const text = e.results[i][0].transcript.trim();
        if (!text) continue;
        this.app.editor.restoreRange();
        insertText(`${text} `);
        this.app.editor.markActiveDirty();
      }
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Allow microphone access to dictate.', { kind: 'error' });
      else if (e.error !== 'no-speech' && e.error !== 'aborted') toast(`Dictation stopped: ${e.error}`, { kind: 'error' });
    };
    rec.onend = () => {
      if (this.rec === rec) {
        this.active = false;
        this.rec = null;
        this.app.ribbon.refresh();
      }
    };
    try {
      rec.start();
    } catch {
      return;
    }
    this.rec = rec;
    this.active = true;
    this.app.ribbon.refresh();
    announce('Dictation on. Start speaking.');
  }

  stop() {
    const rec = this.rec;
    this.rec = null;
    this.active = false;
    rec?.stop();
    this.app.ribbon.refresh();
    announce('Dictation off');
  }
}
