// Shared fakes for the effects UI tests.
import { Prefs } from '../src/lib/prefs.js';
import { Emitter } from '../src/lib/emitter.js';
import { CommandRegistry } from '../src/commands/registry.js';

export function memoryPrefs() {
  const store = new Map();
  return new Prefs({ getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) });
}

/** A minimal app: prefs, commands, events, an engine stub and notifications. */
export function fakeApp() {
  const app = new Emitter();
  app.prefs = memoryPrefs();
  app.commands = new CommandRegistry(app);
  app.engine = new Emitter();
  app.engine.position = 0;
  app.documents = [];
  app.active = null;
  app.previewFx = null;
  app.notes = [];
  app.notify = (m, o) => app.notes.push({ m, error: Boolean(o?.error) });
  app.setStatus = () => {};
  app.syncGraph = () => {};
  app.stop = () => {};
  app.play = () => {};
  app.panels = new Map();
  app.registerPanel = (def) => app.panels.set(def.id, def);
  app.uniqueName = (n) => n;
  app.addDocument = (doc) => {
    app.documents.push(doc);
    app.active = doc;
  };
  app.runEffect = undefined;
  return app;
}

/** A Float32Array ramp or constant. */
export function filled(n, fn) {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = typeof fn === 'function' ? fn(i) : fn;
  return a;
}
