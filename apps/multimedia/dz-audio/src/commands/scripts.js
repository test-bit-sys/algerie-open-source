// File > Run Script: runs a JavaScript file from this device against the app,
// for automating repetitive work. The script body runs as an async function
// with these arguments:
//
//   app      the application (documents, active, commands, prefs, ...)
//   run      (commandId, args?) => Promise, same as app.commands.run
//   log      (...values) => void, shown in the script's result dialog
//   files    { open(blobs) } to open Files or Blobs as documents
//
// Example: normalize every open file
//   for (const doc of app.documents.filter((d) => d.kind === 'audio')) {
//     app.activate(doc);
//     await run('fx.normalizePeak', { peak: -1 });
//   }
//
// Scripts can do anything the app can, so the user confirms each run.

import { h } from '../lib/dom.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { pickLocalFiles, openFiles } from '../storage/files.js';

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

/** Runs script source; resolves { ok, output: string[], error }. */
export async function runScript(app, source, { name = 'script' } = {}) {
  const output = [];
  const log = (...values) => output.push(values.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(' '));
  try {
    const fn = new AsyncFunction('app', 'run', 'log', 'files', `"use strict";\n${source}\n//# sourceURL=${encodeURIComponent(name)}`);
    const result = await fn(app, (id, args) => app.commands.run(id, args), log, { open: (blobs) => openFiles(app, blobs) });
    if (result !== undefined) log(result);
    return { ok: true, output };
  } catch (error) {
    return { ok: false, output, error };
  }
}

async function runScriptFromFile(app) {
  const [file] = await pickLocalFiles({ accept: '.js,.mjs,text/javascript', multiple: false });
  if (!file) return;
  const source = await file.text();
  const ok = await confirmDialog({
    title: 'Run Script',
    message: `Run "${file.name}"? Scripts can change and close your files and use your Puter account, so only run scripts you trust.`,
    confirm: 'Run',
  });
  if (!ok) return;
  app.setStatus(`Running ${file.name}...`);
  const r = await runScript(app, source, { name: file.name });
  app.setStatus(r.ok ? `${file.name} finished` : `${file.name} failed`);
  if (!r.ok || r.output.length) {
    await openDialog({
      title: r.ok ? `${file.name}: Output` : `${file.name}: Error`,
      body: h(
        'div.script-result',
        r.ok ? null : h('p', { style: { color: 'var(--danger)', margin: '0 0 8px' } }, String(r.error?.message || r.error)),
        r.output.length ? h('pre.script-output', r.output.join('\n')) : null,
      ),
      buttons: [{ label: 'Close', value: true, primary: true }],
    });
  }
}

export function installScriptCommands(app) {
  app.commands.register([{ id: 'file.runScript', label: 'Run Script...', run: () => runScriptFromFile(app) }]);
}
