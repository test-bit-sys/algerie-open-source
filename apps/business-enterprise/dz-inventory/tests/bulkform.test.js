// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { store } from '../src/lib/store.js';
import { openBulkEditForm } from '../src/ui/bulkform.js';

vi.mock('../src/ui/modal.js', () => ({
  openModal: ({ content }) => {
    document.body.append(content);
    return { close: () => content.remove() };
  },
}));
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

beforeEach(async () => {
  const data = new Map();
  vi.stubGlobal('puter', {
    auth: { getUser: async () => ({ username: 'tester' }) },
    kv: {
      list: async (prefix) => [...data.keys()].filter((key) => key.startsWith(prefix.replace(/\*$/, ''))),
      get: async (key) => data.get(key) ?? null,
      set: async (key, value) => data.set(key, structuredClone(value)),
    },
  });
  document.body.replaceChildren();
  await store.init();
});
afterEach(() => vi.unstubAllGlobals());

it('submits a decimal threshold for a mixed selection and rounds it per product', async () => {
  const beans = await store.addProduct({ name: 'Beans', unit: 'kg' });
  const cups = await store.addProduct({ name: 'Cups' });
  openBulkEditForm([beans.id, cups.id]);
  const input = document.getElementById('bulk-threshold');
  input.value = '2.5';
  const form = input.form;
  expect(form.checkValidity()).toBe(true);
  form.requestSubmit();
  await vi.waitFor(() => expect(form.isConnected).toBe(false));
  await store.init();
  expect(store.productById(beans.id).lowStock).toBe(2.5);
  expect(store.productById(cups.id).lowStock).toBe(3);
});

it('keeps whole-number validation for a selection of counted products', async () => {
  const cups = await store.addProduct({ name: 'Cups' });
  openBulkEditForm([cups.id]);
  const input = document.getElementById('bulk-threshold');
  input.value = '2.5';
  expect(input.checkValidity()).toBe(false);
  input.value = '-1';
  expect(input.checkValidity()).toBe(false);
  input.value = '0';
  expect(input.checkValidity()).toBe(true);
});
