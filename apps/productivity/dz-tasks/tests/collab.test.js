import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { installMockPuter, createMockPuter } from './helpers/mock-puter.js';

let Store;
let collab;
let alice, bob; // isolated mock accounts
let A, B;       // their stores

beforeAll(async () => {
  installMockPuter(); // browser globals + cross-account fetch mock
  ({ Store } = await import('../src/lib/store.js'));
  collab = await import('../src/lib/collab.js');
});

beforeEach(async () => {
  alice = createMockPuter({ username: 'alice' });
  bob = createMockPuter({ username: 'bob' });
  localStorage.clear();
  A = new Store();
  A.cloud = alice.puter;
  A.deviceId = 'dev-A';
  await A.init();
  localStorage.clear(); // the mirror is per-browser; don't leak A's into B
  B = new Store();
  B.cloud = bob.puter;
  B.deviceId = 'dev-B';
  await B.init();
  localStorage.clear();
});

/** Owner A invites, member B joins, A approves — the full handshake. */
async function connect({ approve = true } = {}) {
  const list = await A.addList({ name: 'Groceries', icon: 'shopping-cart', slot: 3 });
  const { invite } = await A.enableCollab(list.id);
  const manifestUrl = collab.parseJoinHash('#' + invite.split('#')[1]);
  expect(manifestUrl).toBeTruthy();

  const { confirm } = await B.joinCollab(manifestUrl);
  if (approve) {
    const payload = collab.parseConfirmHash('#' + confirm.split('#')[1]);
    expect(payload.member.id).toBe('bob');
    await A.approveMember(payload.listId, payload.member);
  }
  return list;
}

describe('handshake', () => {
  it('member joins, owner approves, and content flows both ways', async () => {
    const list = await connect();
    await A.addTask({ listId: list.id, title: 'Milk (from alice)' });

    await A.syncCollab();
    await B.syncCollab();
    expect(B.listById(list.id)?.name).toBe('Groceries');
    expect(B.listById(list.id)?.collab.approved).toBe(true);
    expect(B.tasks.some((t) => t.title === 'Milk (from alice)')).toBe(true);

    await B.addTask({ listId: list.id, title: 'Bread (from bob)' });
    await B.syncCollab();
    await A.syncCollab();
    expect(A.tasks.some((t) => t.title === 'Bread (from bob)')).toBe(true);
  });

  it('an unapproved member can pull but their edits stay invisible until approval', async () => {
    const list = await connect({ approve: false });
    await A.addTask({ listId: list.id, title: 'Owner task' });
    await A.syncCollab();

    await B.syncCollab();
    expect(B.tasks.some((t) => t.title === 'Owner task')).toBe(true);
    expect(B.listById(list.id).collab.approved).toBe(false);

    await B.addTask({ listId: list.id, title: 'Eager beaver' });
    await B.syncCollab();
    await A.syncCollab();
    expect(A.tasks.some((t) => t.title === 'Eager beaver')).toBe(false);

    // Approval later lets the queued work through.
    const link = await B.confirmLinkFor(list.id);
    const payload = collab.parseConfirmHash('#' + link.split('#')[1]);
    await A.approveMember(payload.listId, payload.member);
    await A.syncCollab();
    expect(A.tasks.some((t) => t.title === 'Eager beaver')).toBe(true);
  });

  it('rejects joining your own list', async () => {
    const list = await A.addList({ name: 'Mine' });
    const { invite } = await A.enableCollab(list.id);
    const manifestUrl = collab.parseJoinHash('#' + invite.split('#')[1]);
    await expect(A.joinCollab(manifestUrl)).rejects.toThrow(/your own list/i);
  });
});

describe('editing together', () => {
  it('completing and deleting propagate across members', async () => {
    const list = await connect();
    const t1 = await A.addTask({ listId: list.id, title: 'complete me' });
    const t2 = await A.addTask({ listId: list.id, title: 'delete me' });
    await A.syncCollab();
    await B.syncCollab();

    await B.completeTask(t1.id);
    await B.deleteTask(t2.id);
    await B.syncCollab();
    await A.syncCollab();

    expect(A.taskById(t1.id).done).toBe(true);
    expect(A.taskById(t2.id)).toBeNull();
  });

  it('concurrent edits of the same task converge to the newer one', async () => {
    const list = await connect();
    const t = await A.addTask({ listId: list.id, title: 'contested' });
    await A.syncCollab();
    await B.syncCollab();

    await A.updateTask(t.id, { title: 'alice version' });
    await new Promise((r) => setTimeout(r, 5));
    await B.updateTask(t.id, { title: 'bob version (newer)' });

    await A.syncCollab();
    await B.syncCollab();
    await A.syncCollab();
    expect(A.taskById(t.id).title).toBe('bob version (newer)');
    expect(B.taskById(t.id).title).toBe('bob version (newer)');
  });

  it('a member sanitizes hostile list meta from the manifest', async () => {
    const list = await connect();
    await A.syncCollab();
    await B.syncCollab();

    // Tamper with the owner's manifest file: 'constructor' would resolve
    // through the icon map's prototype chain if adopted unchecked, and the
    // slot styles var(--slot-N) lookups.
    const path = collab.manifestPath(list.id);
    const manifest = JSON.parse(alice.fileMap.get(path));
    manifest.icon = 'constructor';
    manifest.slot = 9999;
    alice.fileMap.set(path, JSON.stringify(manifest));

    await B.syncCollab();
    const mine = B.listById(list.id);
    expect(mine.icon).toBe('list');
    expect(mine.slot).toBe(8);
  });

  it("the owner's rename reaches members", async () => {
    const list = await connect();
    await A.updateList(list.id, { name: 'Groceries & household' });
    await A.syncCollab(); // owner refreshes the manifest
    await B.syncCollab();
    expect(B.listById(list.id).name).toBe('Groceries & household');
  });
});

describe('membership changes', () => {
  it('revoking a member converts their copy to a private list', async () => {
    const list = await connect();
    await A.addTask({ listId: list.id, title: 'was shared' });
    await A.syncCollab();
    await B.syncCollab();

    await A.removeMember(list.id, 'bob');
    let ended = null;
    B.addEventListener('collab-ended', (e) => { ended = e.detail; });
    await B.syncCollab();

    expect(B.listById(list.id).collab).toBeNull();
    expect(B.tasks.some((t) => t.title === 'was shared')).toBe(true); // kept
    expect(ended?.listId).toBe(list.id);

    // Bob's later edits stay local: alice no longer reads his replica.
    await B.addTask({ listId: list.id, title: 'private now' });
    await B.syncCollab();
    await A.syncCollab();
    expect(A.tasks.some((t) => t.title === 'private now')).toBe(false);
  });

  it('the owner stopping collaboration converts member copies too', async () => {
    const list = await connect();
    await A.syncCollab();
    await B.syncCollab();

    await A.disableCollab(list.id);
    expect(alice.fileMap.has(collab.manifestPath(list.id))).toBe(false);

    await B.syncCollab();
    expect(B.listById(list.id).collab).toBeNull();
  });

  it('leaving one shared list does not delete its tasks for others via another shared list', async () => {
    // Bob is in two of Alice's lists. Leaving the first tombstones its
    // tasks on his side; those tombstones must not ride along in his
    // replica for the second list and destroy the first for Alice.
    const l1 = await connect();
    const l2 = await (async () => {
      const list = await A.addList({ name: 'Second list', icon: 'star', slot: 4 });
      const { invite } = await A.enableCollab(list.id);
      const manifestUrl = collab.parseJoinHash('#' + invite.split('#')[1]);
      const { confirm } = await B.joinCollab(manifestUrl);
      const payload = collab.parseConfirmHash('#' + confirm.split('#')[1]);
      await A.approveMember(payload.listId, payload.member);
      return list;
    })();
    const t = await A.addTask({ listId: l1.id, title: 'important task in L1' });
    await A.addTask({ listId: l2.id, title: 'task in L2' });
    await A.syncCollab();
    await B.syncCollab();
    expect(B.taskById(t.id)).toBeTruthy();

    await new Promise((r) => setTimeout(r, 5));
    await B.leaveCollab(l1.id);
    await B.syncCollab();
    await A.syncCollab();
    await A.syncCollab(); // a later pass must not apply leaked tombstones

    expect(A.taskById(t.id)).toBeTruthy();
  });

  it('a member leaving stops their replica from being read', async () => {
    const list = await connect();
    await A.addTask({ listId: list.id, title: 'shared task' });
    await A.syncCollab();
    await B.syncCollab();

    await B.leaveCollab(list.id);
    expect(B.listById(list.id)).toBeNull();
    expect(bob.fileMap.has(collab.replicaPath(list.id, 'bob'))).toBe(false);

    // Owner keeps working; the missing replica is skipped quietly.
    await A.addTask({ listId: list.id, title: 'after departure' });
    await A.syncCollab();
    expect(A.tasks.some((t) => t.title === 'after departure')).toBe(true);
  });

  it('a leave landing mid-sync does not republish the replica with its tombstones', async () => {
    // Leaving deletes the member's replica and tombstones every task in
    // their copy. A sync pass already in flight (its manifest fetch on the
    // wire) must notice the list is gone when it resumes — publishing its
    // replica anyway would recreate the file with the leave's tombstones,
    // and the next merge would delete the whole list for everyone else.
    const list = await connect();
    const t = await A.addTask({ listId: list.id, title: 'must survive the leave' });
    await A.syncCollab();
    await B.syncCollab();
    expect(B.taskById(t.id)).toBeTruthy();

    await new Promise((r) => setTimeout(r, 5));
    const origFetch = globalThis.fetch;
    let left = null;
    globalThis.fetch = async (url, ...rest) => {
      const res = await origFetch(url, ...rest);
      // The sync's first fetch is the manifest; the user leaves while it
      // is still on the wire.
      if (!left && String(url).includes('manifest')) {
        left = B.leaveCollab(list.id);
        await left;
      }
      return res;
    };
    try {
      await B.syncCollab();
      await left;
    } finally {
      globalThis.fetch = origFetch;
    }

    expect(left).toBeTruthy(); // the interleave really happened
    expect(B.listById(list.id)).toBeNull();
    expect(bob.fileMap.has(collab.replicaPath(list.id, 'bob'))).toBe(false);

    await A.syncCollab();
    expect(A.taskById(t.id)).toBeTruthy();
  });

  it('a member can rejoin a list they kept as a private copy', async () => {
    const list = await connect();
    await A.addTask({ listId: list.id, title: 'shared task' });
    await A.syncCollab();
    await B.syncCollab();

    // Owner stops collaborating; the member's copy converts to private.
    await A.disableCollab(list.id);
    await B.syncCollab();
    expect(B.listById(list.id).collab).toBeNull();

    // Owner turns collaboration back on and re-invites the member.
    const { invite } = await A.enableCollab(list.id);
    const manifestUrl = collab.parseJoinHash('#' + invite.split('#')[1]);
    const { confirm } = await B.joinCollab(manifestUrl);
    expect(B.listById(list.id).collab?.role).toBe('member');

    const payload = collab.parseConfirmHash('#' + confirm.split('#')[1]);
    await A.approveMember(payload.listId, payload.member);
    await A.addTask({ listId: list.id, title: 'after the rejoin' });
    await A.syncCollab();
    await B.syncCollab();
    expect(B.tasks.some((t) => t.title === 'after the rejoin')).toBe(true);
  });

  it('leaving and rejoining the same list does not delete it for the others', async () => {
    const list = await connect();
    const t = await A.addTask({ listId: list.id, title: 'survives the rejoin' });
    await A.syncCollab();
    await B.syncCollab();
    expect(B.taskById(t.id)).toBeTruthy();

    // Leaving tombstones every task in bob's copy; those must not ride
    // back into the group when he rejoins through a fresh invite.
    await new Promise((r) => setTimeout(r, 5));
    await B.leaveCollab(list.id);
    const { invite } = await A.enableCollab(list.id);
    const manifestUrl = collab.parseJoinHash('#' + invite.split('#')[1]);
    const { confirm } = await B.joinCollab(manifestUrl);
    const payload = collab.parseConfirmHash('#' + confirm.split('#')[1]);
    await A.approveMember(payload.listId, payload.member);

    await B.syncCollab();
    await A.syncCollab();
    await B.syncCollab();
    expect(A.taskById(t.id)).toBeTruthy();
    expect(B.taskById(t.id)).toBeTruthy();
  });

  it('pre-join tombstones flowing back from another device stay void', async () => {
    const list = await connect();
    const t = await A.addTask({ listId: list.id, title: 'contested by a stale device' });
    await A.syncCollab();
    await B.syncCollab();

    // Simulate bob's other device syncing a leave that raced the rejoin:
    // a tombstone newer than the task (it would win any merge) but stamped
    // before the rejoin.
    await new Promise((r) => setTimeout(r, 5));
    const staleAt = Date.now();
    B.listById(list.id).collab.joinedAt = staleAt + 1;
    B.deletedTasks.push({ id: t.id, at: staleAt, listId: list.id });

    await B.syncCollab();
    await A.syncCollab();
    expect(A.taskById(t.id)).toBeTruthy(); // never shipped
    expect(B.taskById(t.id)).toBeTruthy(); // never applied locally
    expect(B.deletedTasks.some((d) => d.id === t.id)).toBe(false); // purged
  });

  it("ending collaboration from afar unpublishes the member's replica", async () => {
    const list = await connect();
    await B.syncCollab();
    expect(bob.fileMap.has(collab.replicaPath(list.id, 'bob'))).toBe(true);

    await A.removeMember(list.id, 'bob');
    await B.syncCollab();
    await new Promise((r) => setTimeout(r, 0)); // fs.delete is fire-and-forget
    expect(B.listById(list.id).collab).toBeNull();
    expect(bob.fileMap.has(collab.replicaPath(list.id, 'bob'))).toBe(false);
  });

  it('a failed enableCollab leaves no half-built collab state behind', async () => {
    const list = await A.addList({ name: 'Flaky network' });
    const orig = alice.puter.fs.getReadURL;
    alice.puter.fs.getReadURL = async () => { throw new Error('network down'); };
    await expect(A.enableCollab(list.id)).rejects.toThrow();
    expect(A.listById(list.id).collab).toBeNull();

    alice.puter.fs.getReadURL = orig;
    const { invite } = await A.enableCollab(list.id);
    expect(invite).toContain('#/join?m=');
  });

  it('a tampered replica cannot delete or hijack tasks outside its list', async () => {
    const list = await connect();
    const privateList = await A.addList({ name: 'Private' });
    const secret = await A.addTask({ listId: privateList.id, title: 'secret' });
    await A.syncCollab();
    await B.syncCollab();

    const path = collab.replicaPath(list.id, 'bob');
    const rep = JSON.parse(bob.fileMap.get(path));
    rep.deleted = [
      { id: secret.id, at: Date.now() + 60000, listId: privateList.id },
      { id: secret.id, at: Date.now() + 60000 }, // unstamped, task lives elsewhere
    ];
    rep.tasks = [...rep.tasks, { id: secret.id, title: 'hijacked', updatedAt: Date.now() + 60000 }];
    bob.fileMap.set(path, JSON.stringify(rep));

    await A.syncCollab();
    expect(A.taskById(secret.id).title).toBe('secret');
    expect(A.taskById(secret.id).listId).toBe(privateList.id);
    expect(A.deletedTasks.some((d) => d.id === secret.id)).toBe(false);
    expect(A.tasks.filter((x) => x.id === secret.id)).toHaveLength(1);
  });

  it('a crafted invite cannot adopt a list that was never in its group', async () => {
    // Bob knows a list id (any former member does) and hands Alice an
    // invite claiming it, with himself as owner.
    const priv = await A.addList({ name: 'Alice private' });
    const secret = await A.addTask({ listId: priv.id, title: 'not for bob' });

    const decoy = await B.addList({ name: 'Decoy' });
    await B.enableCollab(decoy.id);
    // Re-point the manifest at Alice's list id and republish it.
    const manifest = JSON.parse(bob.fileMap.get(collab.manifestPath(decoy.id)));
    manifest.listId = priv.id;
    bob.fileMap.set(collab.manifestPath(priv.id), JSON.stringify(manifest));
    const evilUrl = await bob.puter.fs.getReadURL(collab.manifestPath(priv.id), 3600);

    await expect(A.joinCollab(evilUrl)).rejects.toThrow(/does not match/i);
    // Nothing adopted, nothing published, no read URL handed out.
    expect(A.listById(priv.id).collab).toBeNull();
    expect(alice.fileMap.has(collab.replicaPath(priv.id, 'alice'))).toBe(false);
    expect(A.taskById(secret.id)).toBeTruthy();
  });

  it("an export imported by an outsider does not keep syncing with the group", async () => {
    const list = await connect();
    await A.addTask({ listId: list.id, title: 'before the export' });
    await A.syncCollab();
    await B.syncCollab();
    expect(B.tasks.some((t) => t.title === 'before the export')).toBe(true);

    // Carol was never invited; she imports Bob's export file.
    const carol = createMockPuter({ username: 'carol' });
    localStorage.clear();
    const C = new Store();
    C.cloud = carol.puter;
    C.deviceId = 'dev-C';
    await C.init();
    await C.importAll(JSON.parse(JSON.stringify(B.exportAll())));

    // Membership is publication state of Bob's account, not data to inherit:
    // keeping it left Carol pulling the group's replicas as "bob" forever.
    expect(C.listById(list.id).collab).toBeNull();
    expect(C.listById(list.id).shared).toBeNull();
    expect(C.tasks.some((t) => t.title === 'before the export')).toBe(true);

    await A.addTask({ listId: list.id, title: 'after the export' });
    await A.syncCollab();
    await C.syncCollab();
    expect(C.tasks.some((t) => t.title === 'after the export')).toBe(false);
    expect(carol.fileMap.has(collab.replicaPath(list.id, 'bob'))).toBe(false);
  });

  it('restoring your own export keeps the collaboration you were in', async () => {
    const list = await connect();
    const backup = JSON.parse(JSON.stringify(B.exportAll()));
    await B.importAll(backup);

    expect(B.listById(list.id).collab?.memberId).toBe('bob');
    await A.addTask({ listId: list.id, title: 'still shared' });
    await A.syncCollab();
    await B.syncCollab();
    expect(B.tasks.some((t) => t.title === 'still shared')).toBe(true);
  });

  it('an invite for a list I own is refused, not answered with a replica URL', async () => {
    const list = await connect();
    // Bob (a member) crafts a manifest for the same list naming himself owner.
    const manifest = JSON.parse(alice.fileMap.get(collab.manifestPath(list.id)));
    manifest.owner = { id: 'bob', name: 'bob', replicaUrl: 'https://x.test/r.json', addedAt: Date.now() };
    bob.fileMap.set(collab.manifestPath(list.id), JSON.stringify(manifest));
    const evilUrl = await bob.puter.fs.getReadURL(collab.manifestPath(list.id), 3600);

    await expect(A.joinCollab(evilUrl)).rejects.toThrow();
    expect(A.listById(list.id).collab.role).toBe('owner');
    expect(A.listById(list.id).collab.manifestUrl).not.toBe(evilUrl);
  });

  it("a lagging second device cannot gut the private copy once the group ends", async () => {
    const list = await connect();
    const t = await A.addTask({ listId: list.id, title: 'kept after the group ends' });
    await A.syncCollab();
    await B.syncCollab();
    expect(B.taskById(t.id)).toBeTruthy();

    // Bob's second device holds the tombstones from a leave he later undid
    // by rejoining: they postdate the task (so they win any merge) but
    // predate the membership, which is exactly what makes them void.
    const staleAt = B.taskById(t.id).updatedAt + 1000;
    B.listById(list.id).collab.joinedAt = staleAt + 1;
    await B.syncCollab();

    const B2 = new Store();
    B2.cloud = bob.puter;
    B2.deviceId = 'dev-B2';
    await B2.init();
    B2.deletedTasks.push({ id: t.id, at: staleAt, listId: list.id });

    // The owner ends the collaboration; bob's copy converts to private.
    await A.disableCollab(list.id);
    await B.syncCollab();
    expect(B.listById(list.id).collab).toBeNull();
    await B.addTask({ listId: list.id, title: 'added to the private copy' });

    // The lagging device syncs: its tombstones must not come back to life
    // just because the collaboration they predate is over.
    await B2.refreshFromCloud({ force: true });
    expect(B2.taskById(t.id)).toBeTruthy();
    // …nor travel back to the other device on the next write.
    await B2.addTask({ listId: list.id, title: 'from the lagging device' });
    await B.refreshFromCloud({ force: true });
    expect(B.taskById(t.id)).toBeTruthy();
  });

  it('two approvals landing together keep both members', async () => {
    const list = await connect(); // bob is a member
    // A second invitee's confirmation link, opened right after bob's.
    const carol = { id: 'carol', name: 'carol', replicaUrl: 'https://x.test/carol.json' };
    const dave = { id: 'dave', name: 'dave', replicaUrl: 'https://x.test/dave.json' };
    await Promise.all([
      A.approveMember(list.id, carol),
      A.approveMember(list.id, dave),
    ]);
    const { members } = await A.collabMembers(list.id);
    expect(members.map((m) => m.id).sort()).toEqual(['bob', 'carol', 'dave']);
  });

  it('a meta refresh does not rewrite away an approval it raced', async () => {
    const list = await connect();
    const carol = { id: 'carol', name: 'carol', replicaUrl: 'https://x.test/carol.json' };
    // Renaming the list makes the owner's sync rewrite the manifest's
    // meta. Hold its read open until an approval has landed, so the sync
    // is working from membership that is already out of date.
    await A.updateList(list.id, { name: 'Renamed' });

    const origRead = alice.puter.fs.read;
    let approved = null;
    alice.puter.fs.read = async (path, ...rest) => {
      if (path === collab.manifestPath(list.id) && !approved) {
        approved = A.approveMember(list.id, carol);
        await approved;
      }
      return origRead.call(alice.puter.fs, path, ...rest);
    };
    try {
      await A.syncCollab();
      await approved;
    } finally {
      alice.puter.fs.read = origRead;
    }

    const { members } = await A.collabMembers(list.id);
    expect(members.map((m) => m.id).sort()).toEqual(['bob', 'carol']);
  });

  it('members list reflects approvals and removals', async () => {
    const list = await connect();
    let { members } = await A.collabMembers(list.id);
    expect(members.map((m) => m.id)).toEqual(['bob']);

    await A.removeMember(list.id, 'bob');
    ({ members } = await A.collabMembers(list.id));
    expect(members).toHaveLength(0);
  });
});

describe('offline members', () => {
  it('edits queue and merge when the member comes back', async () => {
    const list = await connect();
    const t = await A.addTask({ listId: list.id, title: 'base' });
    await A.syncCollab();
    await B.syncCollab();

    // B goes "offline": edits locally, no syncs. A keeps working.
    await B.updateTask(t.id, { notes: 'note from bob' });
    await new Promise((r) => setTimeout(r, 5));
    await A.addTask({ listId: list.id, title: 'while bob was away' });
    await A.syncCollab();

    // B returns.
    await B.syncCollab();
    await A.syncCollab();
    expect(B.tasks.some((x) => x.title === 'while bob was away')).toBe(true);
    expect(A.taskById(t.id).notes).toBe('note from bob');
  });
});
