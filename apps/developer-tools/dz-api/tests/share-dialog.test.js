import { it, expect } from 'vitest';
import { openShareDialog } from '../src/ui/share-dialog.js';

it('keeps focus in the share dialog after removing someone', async () => {
  let shares = [{ holder: { username: 'bob' }, mode: 'read' }];
  const app = {
    ws: { getCollection: () => ({ id: 'c', name: 'C' }) },
    shared: {
      shares: async () => shares,
      unshare: async () => {
        shares = [];
      },
    },
  };
  const dlg = openShareDialog(app, 'c');
  await new Promise((r) => setTimeout(r, 0));
  const remove = dlg.el.querySelector('[aria-label="Remove access for bob"]');
  remove.focus();
  remove.click();
  await new Promise((r) => setTimeout(r, 0));
  expect(dlg.el.contains(document.activeElement)).toBe(true);
  expect(dlg.el.querySelector('.share-empty')).not.toBeNull();
  dlg.close();
});

it('warns that the people it is shared with can see its secrets', async () => {
  const shareApp = (c) => ({ ws: { getCollection: () => c }, shared: { shares: async () => [] } });
  const plain = { id: 'c', name: 'C', variables: [{ key: 'host', value: 'x' }], auth: { type: 'bearer', bearer: { token: '{{token}}' } }, items: [] };
  let dlg = openShareDialog(shareApp(plain), 'c');
  expect(dlg.el.querySelector('.callout')).toBeNull();
  dlg.close();
  const secret = {
    ...plain,
    variables: [{ key: 'key', value: 'abc', secret: true }],
    items: [{ id: 'r', type: 'request', name: 'R', auth: { type: 'inherit', basic: { username: 'u', password: 'pw' } } }],
  };
  dlg = openShareDialog(shareApp(secret), 'c');
  expect(dlg.el.querySelector('.callout').textContent).toMatch(/can see its 2 secret values .*even if they can only view/);
  dlg.close();
});
