import { describe, it, expect } from 'vitest';
import { Dock, normalize } from '../src/ui/dock.js';
import { WORKSPACES, PHONE, TABLET } from '../src/ui/workspaces.js';

const registry = (ids) => new Map(ids.map((id) => [id, { id, title: id.toUpperCase(), create: () => ({ el: document.createElement('div') }) }]));

describe('dock layout', () => {
  it('drops unknown panels and collapses empty frames and single-child splits', () => {
    const tree = { t: 'row', c: [{ t: 'group', tabs: ['x'] }, { t: 'col', c: [{ t: 'group', tabs: ['a', 'a', 'b'], a: 'z' }] }], s: [1, 2] };
    const out = normalize(tree, registry(['a', 'b']));
    expect(out).toEqual({ t: 'group', tabs: ['a', 'b'], a: 'a' });
  });

  it('flattens nested splits of the same direction keeping proportions', () => {
    const tree = { t: 'row', c: [{ t: 'group', tabs: ['a'] }, { t: 'row', c: [{ t: 'group', tabs: ['b'] }, { t: 'group', tabs: ['c'] }], s: [1, 3] }], s: [1, 1] };
    const out = normalize(tree, registry(['a', 'b', 'c']));
    expect(out.c.length).toBe(3);
    expect(out.s).toEqual([1, 0.25, 0.75]);
  });

  it('builds every workspace and opens, closes and maximizes panels', () => {
    const ids = ['editor', 'mixer', 'files', 'favorites', 'media', 'effects', 'markers', 'history', 'levels', 'selection', 'properties', 'assistant', 'frequency', 'amplitude', 'phase', 'loudness'];
    const root = document.createElement('div');
    document.body.append(root);
    const app = { openMenu() {} };
    const dock = new Dock(app, root, registry(ids));
    for (const make of [...Object.values(WORKSPACES), PHONE, TABLET]) {
      dock.setLayout(make());
      expect(dock.isOpen('editor')).toBe(true);
    }
    dock.setLayout(WORKSPACES.Default());
    expect(root.querySelectorAll('.panel-group').length).toBe(dock.groups().length);
    dock.closePanel('history');
    expect(dock.isOpen('history')).toBe(false);
    dock.openPanel('history', { focus: false });
    expect(dock.isVisible('history')).toBe(true);
    const g = dock.groupOf('editor');
    dock.toggleMaximize(g);
    expect(root.querySelectorAll('.panel-group').length).toBe(1);
    dock.toggleMaximize(g);
    expect(root.querySelectorAll('.panel-group').length).toBe(dock.groups().length);
    const tab = root.querySelector('#tab-mixer');
    tab.click();
    expect(dock.isVisible('mixer')).toBe(true);
  });
});
