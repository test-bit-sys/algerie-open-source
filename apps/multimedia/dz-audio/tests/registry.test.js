import { describe, it, expect } from 'vitest';
import { CommandRegistry, normalizeShortcut } from '../src/commands/registry.js';
import { Prefs } from '../src/lib/prefs.js';

const memory = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
};

describe('CommandRegistry shortcuts', () => {
  it('matches, remaps, moves conflicts and persists', () => {
    const app = { prefs: new Prefs(memory()), documentKinds: new Map() };
    const C = new CommandRegistry(app);
    C.register([
      { id: 'a', label: 'A', shortcut: 'Mod+K', run: () => 'a' },
      { id: 'b', label: 'B', shortcut: 'B', run: () => 'b' },
    ]);
    expect(C.commandFor('Mod+K')).toBe('a');
    C.setShortcuts('b', [normalizeShortcut('Mod+K')]);
    expect(C.commandFor('Mod+K')).toBe('b');
    expect(C.keysFor('a')).toEqual([]);
    expect(app.prefs.get('shortcuts').b).toEqual(['mod+k']);
    const again = new CommandRegistry(app);
    again.register({ id: 'b', label: 'B', shortcut: 'B', run() {} });
    expect(again.commandFor('Mod+K')).toBe('b');
    again.resetShortcuts('b');
    expect(again.commandFor('B')).toBe('b');
  });

  it('lets a document kind override a shared command', async () => {
    const app = { active: { kind: 'session' }, documentKinds: new Map([['session', { commands: { a: { run: () => 'session' } } }]]) };
    const C = new CommandRegistry(app);
    C.register({ id: 'a', label: 'A', run: () => 'audio' });
    expect(await C.run('a')).toBe('session');
    app.active = { kind: 'audio' };
    expect(await C.run('a')).toBe('audio');
  });
});

describe('Prefs', () => {
  it('renames keys, shortcuts and panels saved by earlier versions', () => {
    const storage = memory();
    const saved = {
      essentialPresets: { music: { Soft: {} } },
      essentialCollapsed: { repair: true },
      shortcuts: { 'window.essential': 'Alt+5' },
      layouts: { Default: { t: 'row', c: [{ t: 'group', tabs: ['editor'], a: 'editor' }, { t: 'group', tabs: ['properties', 'essential'], a: 'essential' }], s: [1, 1] } },
    };
    storage.setItem('audio-studio:prefs', JSON.stringify(saved));
    const prefs = new Prefs(storage);
    expect(prefs.get('soundAssistantPresets')).toEqual({ music: { Soft: {} } });
    expect(prefs.get('soundAssistantCollapsed')).toEqual({ repair: true });
    expect(prefs.get('shortcuts')).toEqual({ 'window.assistant': 'Alt+5' });
    expect(prefs.get('layouts').Default.c[1]).toEqual({ t: 'group', tabs: ['properties', 'assistant'], a: 'assistant' });
    expect('essentialPresets' in prefs.values).toBe(false);
  });
});
