/**
 * Rolling automatic backups to the user's own Puter cloud.
 *
 * The whole book of business lives in a handful of KV keys; the trash
 * covers deletes for 30 days, but a corrupt write or a bad bulk edit
 * discovered on day 31 needs a real copy. So: on app open, if the newest
 * backup in backups/ is older than the configured interval, write a full
 * JSON export there and prune to the last few. No scheduler, no service
 * worker, no external destination - the data's fate stops depending on
 * the single live copy in KV, and never leaves the user's account.
 */

export const BACKUP_KEEP = 8;
export const DEFAULT_BACKUP_DAYS = 7;

const DIR = 'backups';
const DAY = 86400000;

/** "crm-backup-2026-08-05T21-30-00Z.json" - readable in the file manager,
    lexicographically chronological, parseable back to a timestamp. */
function backupName(at = Date.now()) {
  const stamp = new Date(at).toISOString().slice(0, 19).replace(/:/g, '-');
  return `crm-backup-${stamp}Z.json`;
}

/** The timestamp a backup file name carries, or null for foreign files. */
export function parseBackupName(name) {
  const m = String(name || '').match(/^crm-backup-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z\.json$/);
  if (!m) return null;
  const at = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`);
  return Number.isFinite(at) ? at : null;
}

/**
 * Does this error mean the folder isn't there yet, rather than that we
 * couldn't ask? The two answers are opposites - one is "you have no
 * backups", the other is "we don't know" - and only the first is safe to
 * report as an empty list.
 */
function isMissingDir(err) {
  const text = `${err?.code ?? ''} ${err?.name ?? ''} ${err?.message ?? err ?? ''}`;
  return /not[ _-]?found|does[ _-]?not[ _-]?exist|no such/i.test(text);
}

/**
 * Backups on file, newest first: [{ name, path, at, size }]. A missing
 * directory is simply "no backups yet"; files we didn't write are left
 * alone and unlisted.
 *
 * Anything else - offline, a refused read - throws. Swallowing it into an
 * empty list told a user with eight backups in their cloud that they had
 * none, which is the one wrong answer to give about the copies that exist
 * to be relied on. Callers that must stay quiet (the boot hook, the prune)
 * catch it themselves.
 */
export async function listBackups() {
  let items;
  try {
    items = await puter.fs.readdir(DIR);
  } catch (err) {
    if (isMissingDir(err)) return [];
    throw err;
  }
  return (Array.isArray(items) ? items : [])
    .map((f) => ({
      name: f.name,
      path: f.path || `${DIR}/${f.name}`,
      at: parseBackupName(f.name),
      size: Number(f.size) || 0,
    }))
    .filter((f) => f.at !== null)
    .sort((a, b) => b.at - a.at);
}

/** The stored JSON of one backup, parsed. */
export async function readBackup(path) {
  const blob = await puter.fs.read(path);
  const text = typeof blob === 'string' ? blob : await blob.text();
  return JSON.parse(text);
}

/**
 * Write a backup now and prune to the newest BACKUP_KEEP. Returns the
 * new entry. The prune is best-effort: a file that refuses to die must
 * not fail the backup that just succeeded.
 */
export async function writeBackup(store) {
  const at = Date.now();
  const name = backupName(at);
  const payload = JSON.stringify(store.exportAll());
  await puter.fs.write(`${DIR}/${name}`, payload, { createMissingParents: true });
  // Best-effort, and that now includes the listing: the backup is already
  // written, so a folder we can't read is no reason to report a failure.
  const all = await listBackups().catch(() => []);
  for (const old of all.slice(BACKUP_KEEP)) {
    try {
      await puter.fs.delete(old.path);
    } catch {}
  }
  return { name, path: `${DIR}/${name}`, at, size: payload.length };
}

/**
 * The boot hook: back up if the newest copy is older than the configured
 * interval. Quiet by design - a failed backup must never break the boot,
 * and an account with nothing in it has nothing worth copying.
 */
export async function runBackupIfDue(store) {
  const days = Number(store.settings.autoBackupDays);
  const every = Number.isFinite(days) ? days : DEFAULT_BACKUP_DAYS;
  if (every <= 0) return null;
  if (!store.hasData()) return null;
  try {
    const backups = await listBackups();
    if (backups[0] && Date.now() - backups[0].at < every * DAY) return null;
    return await writeBackup(store);
  } catch {
    return null;
  }
}
