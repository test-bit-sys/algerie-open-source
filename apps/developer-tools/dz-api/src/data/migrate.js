/**
 * Moving work done while signed out into the account that signs in on this
 * browser.
 */
import { openDb, deleteDb } from './idb.js';
import { Workspace } from './workspace.js';
import { cloneWithNewIds } from '../core/model.js';
import { uid } from '../lib/ids.js';

/**
 * Copies work done while signed out into the account that just signed in.
 * Returns how many collections and environments moved, and which other parts
 * changed.
 */
export async function moveGuestData(ws, guestName) {
  let guest;
  try {
    guest = await openDb(guestName);
  } catch {
    return { count: 0 };
  }
  const gw = new Workspace(guest);
  await gw.load();
  // The workspace reports failed writes instead of throwing: any of them keeps the signed-out copy.
  let failed = null;
  const off = ws.on('storage-error', (err) => (failed ||= err));
  try {
    const { collections, environments, globals, history } = gw.snapshot();
    // New ids for the whole tree when any is taken: two collections sharing an item id would act on each other.
    // moved maps the old ids to the new ones, for the tabs and saved responses that refer to them.
    const moved = new Map();
    for (const c of collections) await ws.addCollection(ws.collides(c) ? { ...cloneWithNewIds(c, moved), type: 'collection' } : c);
    for (const e of environments) {
      if (ws.getEnvironment(e.id)) moved.set(e.id, uid());
      await ws.addEnvironment({ ...e, id: moved.get(e.id) || e.id });
    }
    const renamed = (id) => moved.get(id) || id;
    if (globals.variables.length) {
      await ws.updateGlobals((g) => {
        for (const v of globals.variables) if (!g.variables.some((x) => x.key === v.key)) g.variables.push(v);
      });
    }
    if (history.length) await ws.mergeHistory(history);
    const files = await guest.all('files');
    for (const [ref, blob] of files) await ws.db.put('files', ref, blob);
    for (const [key, value] of await guest.all('responses')) await ws.db.put('responses', renamed(key), value);
    // Open tabs, including unsaved requests, come along too.
    const guestTabs = await guest.get('meta', 'tabs');
    if (guestTabs?.tabs?.length) {
      const mine = (await ws.getMeta('tabs')) || { active: null, tabs: [] };
      // A draft keeps the id of the request it edits, so saving it reaches the moved request.
      const tabs = guestTabs.tabs.map((t) => ({ ...t, refId: t.refId && renamed(t.refId), draft: t.draft && { ...t.draft, id: renamed(t.draft.id) } }));
      await ws.setMeta('tabs', { active: guestTabs.active || mine.active, tabs: [...mine.tabs, ...tabs] });
    }
    if (failed) throw failed;
    const count = collections.length + environments.length;
    guest.close();
    // Not awaited: the delete waits until every other tab closes the guest
    // database, and boot must not hang on a signed-out tab left open elsewhere.
    deleteDb(guestName).catch(() => {});
    return { count, globals: globals.variables.length > 0, history: history.length > 0 };
  } finally {
    off();
    guest.close();
  }
}
