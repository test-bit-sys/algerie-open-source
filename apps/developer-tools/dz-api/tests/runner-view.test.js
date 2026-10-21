import { it, expect, vi } from 'vitest';
import { Workspace } from '../src/data/workspace.js';
import { MemoryDb } from './helpers/memory-db.js';
import { request as newRequest } from '../src/core/model.js';
import { RunnerView } from '../src/ui/runner-view.js';

vi.mock('../src/core/execute.js', () => ({
  execute: async (item) => ({
    request: item,
    resolved: { method: 'GET', url: 'https://x.test' },
    response: { status: 200, statusText: 'OK', timeMs: 1, size: { body: 1 }, body: new Uint8Array(1), headers: [] },
    tests: [{ name: 't', passed: !item.name.endsWith('1') }],
    logs: [],
    warnings: [],
    error: null,
    flow: null,
  }),
}));

async function setup() {
  const ws = new Workspace(new MemoryDb());
  await ws.load();
  const c = await ws.addCollection({ name: 'C' });
  for (let i = 0; i < 3; i++) await ws.addItem(c.id, c.id, newRequest({ name: `r${i}`, url: `https://x.test/${i}` }));
  const app = { ws, environmentId: null, sandbox: null, sendOptions: () => ({}), console: { add() {} }, setStatus() {}, openTab() {}, afterRelay() {} };
  const view = new RunnerView(app, { id: 't', kind: 'runner', refId: c.id });
  document.body.append(view.el, Object.assign(document.createElement('div'), { id: 'live-region' }));
  return { view, c };
}

it('reruns failed requests even after they were unchecked', async () => {
  const { view, c } = await setup();
  view.toggleRun();
  await vi.waitFor(() => expect(view.running).toBe(false));
  view.cfg.excluded.add(c.items[1].id);
  view.retryBtn.focus();
  view.retryBtn.click();
  // The button hides during the run; focus moves to Stop rather than the page.
  expect(document.activeElement).toBe(view.runBtn);
  await vi.waitFor(() => expect(view.running).toBe(false));
  expect(view.runErr.textContent).toBe('');
  expect(view.cfg.last.summary.totals.requests).toBe(1);
});

it('keeps the result filter buttons and their counts current during a run', async () => {
  const { view } = await setup();
  view.iterInput.value = '4';
  view.iterInput.dispatchEvent(new Event('input'));
  view.toggleRun();
  await vi.waitFor(() => expect(view.running).toBe(false));
  const first = view.filterEl.children[0];
  view.toggleRun();
  await vi.waitFor(() => expect(view.running).toBe(false));
  expect(view.filterEl.children[0]).toBe(first);
  const counts = [...view.filterEl.querySelectorAll('.runner-filter-count')].map((x) => x.textContent);
  expect(counts).toEqual(['12', '8', '4']);
});

it('shows how far a stopped run got', async () => {
  const { view } = await setup();
  // Stop as soon as the first request finishes.
  view.app.afterRelay = () => view.running && view.toggleRun();
  view.toggleRun();
  await vi.waitFor(() => expect(view.running).toBe(false));
  expect(view.progressText.textContent).toMatch(/^Stopped: 1 request/);
  expect(view.progressEl.getAttribute('aria-valuenow')).toBe('1');
  expect(view.progressEl.getAttribute('aria-valuemax')).toBe('3');
  expect(parseFloat(view.progressBar.style.width)).toBeCloseTo(100 / 3);
});

it('shows the finished run again when the tab is reopened', async () => {
  const { view } = await setup();
  view.toggleRun();
  await vi.waitFor(() => expect(view.running).toBe(false));
  const reopened = new RunnerView(view.app, { id: 't2', kind: 'runner', refId: view.tab.refId });
  expect(reopened.progressWrap.hidden).toBe(false);
  expect(reopened.progressText.textContent).toMatch(/^Finished: 3 requests in /);
  expect(reopened.progressEl.getAttribute('aria-valuenow')).toBe('3');
});

it('puts the iteration count back when the data file that set it is removed', async () => {
  const { view } = await setup();
  view.iterInput.value = '1';
  view.iterInput.dispatchEvent(new Event('input'));
  const drop = new Event('drop', { cancelable: true });
  drop.dataTransfer = { files: [new File(['id\n1\n2\n3\n4\n5'], 'rows.csv', { type: 'text/csv' })] };
  view.el.querySelector('.runner-drop').dispatchEvent(drop);
  await vi.waitFor(() => expect(view.iterInput.value).toBe('5'));
  view.el.querySelector('[aria-label="Remove data file rows.csv"]').click();
  expect(view.iterInput.value).toBe('1');
});

it('puts the iteration count back when a data file longer than the limit is removed', async () => {
  const { view } = await setup();
  const drop = new Event('drop', { cancelable: true });
  const rows = Array.from({ length: 10001 }, (_, i) => i).join('\n');
  drop.dataTransfer = { files: [new File([`id\n${rows}`], 'big.csv', { type: 'text/csv' })] };
  view.el.querySelector('.runner-drop').dispatchEvent(drop);
  await vi.waitFor(() => expect(view.iterInput.value).toBe('10000'));
  view.el.querySelector('[aria-label="Remove data file big.csv"]').click();
  expect(view.iterInput.value).toBe('1');
});

it('states the iteration limit instead of offering a row count it cannot use', async () => {
  const { view } = await setup();
  const drop = new Event('drop', { cancelable: true });
  drop.dataTransfer = { files: [new File([`id\n${Array.from({ length: 10001 }, (_, i) => i).join('\n')}`], 'rows.csv', { type: 'text/csv' })] };
  view.el.querySelector('.runner-drop').dispatchEvent(drop);
  await vi.waitFor(() => expect(view.iterInput.value).toBe('10000'));
  expect(view.iterHint.querySelector('button')).toBeNull();
  expect(view.iterHint.textContent).toBe('Uses the first 10000 rows of 10001. A run has at most 10000 iterations.');
  view.iterInput.value = '3';
  view.iterInput.dispatchEvent(new Event('input'));
  expect(view.iterHint.querySelector('button')).toBeNull();
  expect(view.iterHint.textContent).toMatch(/^Uses the first 3 rows of 10001\. A run has at most 10000 iterations\.$/);
});

it('keeps focus on an expanded result row when the run ends', async () => {
  const { view } = await setup();
  let seen = 0;
  // While the run is going: open the first result from the keyboard.
  view.app.afterRelay = () => {
    if (++seen !== 2) return;
    const toggle = view.listEl.querySelector('.run-row-toggle');
    toggle.focus();
    toggle.click();
  };
  view.toggleRun();
  await vi.waitFor(() => expect(view.running).toBe(false));
  const toggle = document.activeElement;
  expect(toggle.classList.contains('run-row-toggle')).toBe(true);
  expect(toggle.dataset.key).toBe('0:0');
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(view.listEl.contains(toggle)).toBe(true);
});

it('moves focus to the results when Show more shows the last of them', async () => {
  const { view } = await setup();
  view.iterInput.value = '101';
  view.iterInput.dispatchEvent(new Event('input'));
  view.toggleRun();
  // 101 runs take a while on a busy machine.
  await vi.waitFor(() => expect(view.running).toBe(false), { timeout: 15000 });
  expect(view.moreBtn.hidden).toBe(false);
  view.moreBtn.focus();
  view.moreBtn.click();
  expect(view.moreBtn.hidden).toBe(true);
  expect(document.activeElement).toBe(view.listEl);
});

it('says nothing failed yet, rather than waiting, once results are in', async () => {
  const { view } = await setup();
  const failedBtn = () => view.filterEl.querySelector('[data-key="failed"]');
  const empty = () => view.listEl.querySelector('.runner-results-empty')?.textContent;
  const seen = [];
  // The first request passes and the second fails.
  view.app.afterRelay = () => {
    if (seen.length === 0) {
      failedBtn().click();
      seen.push(empty());
    } else if (seen.length === 1) {
      seen.push(empty());
      failedBtn().click();
      seen.push(empty());
    }
  };
  view.toggleRun();
  await vi.waitFor(() => expect(view.running).toBe(false));
  expect(seen).toEqual(['Waiting for the first result...', 'Nothing failed yet.', 'Nothing failed yet.']);
});

it('keeps focus on the run button when a run starts from a settings field', async () => {
  const { view } = await setup();
  view.iterInput.focus();
  view.iterInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, metaKey: true, bubbles: true }));
  expect(view.running).toBe(true);
  expect(document.activeElement).toBe(view.runBtn);
  await vi.waitFor(() => expect(view.running).toBe(false));
  expect(document.activeElement).toBe(view.runBtn);
});

it('rebuilds the request list on a collection change only when the list itself changed', async () => {
  const { view, c } = await setup();
  const first = view.reqListEl.firstElementChild;
  // A script setting a collection variable during a run changes the collection, not the list.
  await view.app.ws.updateCollection(c.id, (col) => { col.variables = [{ key: 'n', value: '1', enabled: true }]; });
  view.onContextChanged({ kind: 'collection', id: c.id });
  expect(view.reqListEl.firstElementChild).toBe(first);
  await view.app.ws.updateItem(c.items[0].id, (r) => { r.name = 'renamed'; });
  view.onContextChanged({ kind: 'collection', id: c.id });
  expect(view.reqListEl.firstElementChild).not.toBe(first);
  expect(view.reqListEl.firstElementChild.textContent).toContain('renamed');
  expect(view.reqCountEl.textContent).toBe('3 of 3 selected');
});
