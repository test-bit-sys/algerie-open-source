// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '../src/lib/store.js';
import { openEntryForm } from '../src/ui/entryform.js';
import { createPuterMock } from './puter-mock.js';

let billableProject;
let internalProject;

beforeEach(async () => {
  vi.stubGlobal('puter', createPuterMock());
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.innerHTML = '<main id="app"></main>';
  await store.init();
  const client = await store.addClient({ name: 'Acme' });
  billableProject = await store.addProject({ clientId: client.id, name: 'Delivery', billable: true });
  internalProject = await store.addProject({ clientId: client.id, name: 'Internal', billable: false });
});

afterEach(() => {
  // Close through the real UI so dialog listeners are removed too.
  document.querySelector('.modal-root:not(.closing) [aria-label="Close"]')?.click();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function control(label) {
  const node = [...document.querySelectorAll('label')].find((node) => node.textContent === label);
  return document.getElementById(node.htmlFor);
}

function selectProject(project) {
  const select = control('Project');
  select.value = project.id;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('manual entry billing', () => {
  it('uses the selected project default and saves non-billable work as non-billable', async () => {
    const saved = vi.spyOn(store, 'addEntry').mockResolvedValue({});
    openEntryForm();
    selectProject(internalProject);
    expect(control('Billable').checked).toBe(false);
    selectProject(billableProject);
    expect(control('Billable').checked).toBe(true);
    selectProject(internalProject);
    control('Duration').value = '1:30';
    document.querySelector('form').requestSubmit();
    await vi.waitFor(() => expect(saved).toHaveBeenCalledWith(expect.objectContaining({
      projectId: internalProject.id, seconds: 5400, billable: false,
    })));
  });

  it('allows a deliberate billing override on a new entry', async () => {
    const saved = vi.spyOn(store, 'addEntry').mockResolvedValue({});
    openEntryForm();
    selectProject(internalProject);
    control('Billable').click();
    control('Duration').value = '1';
    document.querySelector('form').requestSubmit();
    await vi.waitFor(() => expect(saved).toHaveBeenCalledWith(expect.objectContaining({ billable: true })));
  });

  it.each(['edit', 'duplicate'])('preserves the source billing choice on %s', (mode) => {
    const entry = {
      id: 'source', date: '2026-08-03', projectId: internalProject.id,
      seconds: 3600, billable: true, task: '', notes: '',
    };
    openEntryForm(mode === 'edit' ? { entry } : { prefill: entry });
    expect(control('Billable').checked).toBe(true);
    selectProject(billableProject);
    selectProject(internalProject);
    expect(control('Billable').checked).toBe(true);
  });
});

describe('editing timed entries', () => {
  it.each([3618, 27 * 3600])('preserves exact clock times for a %i-second entry when only the task changes', async (seconds) => {
    const startedAt = new Date(2026, 7, 3, 9, 0, 37, 123).getTime();
    const endedAt = startedAt + seconds * 1000;
    const entry = {
      id: 'timed', date: '2026-08-03', projectId: billableProject.id,
      seconds, startedAt, endedAt, billable: true, task: 'Old task', notes: '',
    };
    const saved = vi.spyOn(store, 'updateEntry').mockResolvedValue({});
    openEntryForm({ entry });
    control('Task').value = 'New task';
    document.querySelector('form').requestSubmit();
    await vi.waitFor(() => expect(saved).toHaveBeenCalledWith(entry.id, entry.date,
      expect.objectContaining({ task: 'New task', seconds, startedAt, endedAt })));
  });

  it('still clears optional times when the user removes them', async () => {
    const startedAt = new Date(2026, 7, 3, 9, 0, 37).getTime();
    const entry = {
      id: 'timed', date: '2026-08-03', projectId: billableProject.id,
      seconds: 3600, startedAt, endedAt: startedAt + 3600000, billable: true,
    };
    const saved = vi.spyOn(store, 'updateEntry').mockResolvedValue({});
    openEntryForm({ entry });
    control('Start').value = '';
    control('Start').dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('form').requestSubmit();
    await vi.waitFor(() => expect(saved).toHaveBeenCalledWith(entry.id, entry.date,
      expect.objectContaining({ seconds: 3600, startedAt: null, endedAt: null })));
  });

  it('uses the new date when moving timed work to another day', async () => {
    const startedAt = new Date(2026, 7, 3, 9).getTime();
    const entry = {
      id: 'timed', date: '2026-08-03', projectId: billableProject.id,
      seconds: 3600, startedAt, endedAt: startedAt + 3600000, billable: true,
    };
    const saved = vi.spyOn(store, 'updateEntry').mockResolvedValue({});
    openEntryForm({ entry });
    control('Date').value = '2026-08-04';
    control('Date').dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('form').requestSubmit();
    await vi.waitFor(() => expect(saved).toHaveBeenCalledWith(entry.id, entry.date,
      expect.objectContaining({
        date: '2026-08-04', seconds: 3600,
        startedAt: new Date(2026, 7, 4, 9).getTime(), endedAt: new Date(2026, 7, 4, 10).getTime(),
      })));
  });
});
