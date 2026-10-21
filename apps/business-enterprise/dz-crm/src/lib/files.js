/**
 * Thin wrapper around puter.fs, the way store.js wraps puter.kv.
 *
 * Attachments are the app's first use of the file system: the bytes live
 * under an attachments/ directory in the user's own Puter cloud (relative
 * paths resolve inside the app's directory), while KV keeps only the
 * metadata. No server, no third-party bucket - the file's fate stays in
 * the user's account.
 */

import { uid } from './util.js';

/** Per-file cap. Proposals and order forms fit; disk images don't. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

const DIR = 'attachments';

/**
 * The shape uploadFile writes, and the only shape this module will read or
 * delete: one file directly inside the attachments directory.
 *
 * A path is the one field of an attachment that names something outside the
 * app's own data, and an import supplies it verbatim - so a hand-edited or
 * hostile export could list a "proposal.pdf" whose path is a backup file, a
 * sibling app's data, or anything else the account can address, and the
 * orphan purge at boot would delete it. Paths are checked here, at the
 * filesystem edge, so no caller can be the one that forgot.
 */
const APP_FILE_PATH = /^attachments\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Is this a path this app wrote, and may therefore read or reclaim? */
export function isAppFilePath(path) {
  return typeof path === 'string' && APP_FILE_PATH.test(path) && !path.includes('..');
}

/** "Q3 proposal (final).pdf" → "q3-proposal-final.pdf", bounded. */
export function safeFileName(name) {
  const raw = String(name || 'file');
  const dot = raw.lastIndexOf('.');
  const ext = dot > 0 ? raw.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) : '';
  const base = (dot > 0 ? raw.slice(0, dot) : raw)
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'file';
  return ext ? `${base}.${ext}` : base;
}

/** Human-readable size: "412 KB", "2.4 MB". */
export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(Math.round((n / (1024 * 1024)) * 10) / 10)} MB`;
}

/**
 * Write a picked file into the attachments directory. The stored path
 * carries a uid so two "proposal.pdf"s never fight over one name.
 */
export async function uploadFile(file) {
  const path = `${DIR}/${uid()}-${safeFileName(file.name)}`;
  await puter.fs.write(path, file, { createMissingParents: true });
  return path;
}

/** The file's bytes back, as a Blob. Only ever from the app's own directory. */
export function readFile(path) {
  if (!isAppFilePath(path)) return Promise.reject(new Error('Not an attachment path'));
  return puter.fs.read(path);
}

/**
 * Best-effort delete for cleanup paths (trash expiry, orphan purge).
 * A file already gone must never block the boot or the purge that found it.
 */
export async function deleteStoredFile(path) {
  if (!isAppFilePath(path) || typeof puter === 'undefined' || !puter.fs?.delete) return;
  try {
    await puter.fs.delete(path);
  } catch {
    // Already gone, or offline - either way nothing actionable.
  }
}
