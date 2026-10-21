/**
 * The app's own export format: plain model data wrapped with a format tag.
 * Ids are kept so a round trip reproduces the same tree.
 */
import { normalizeCollection, normalizeEnvironment } from '../model.js';
import { arr, isObj, pretty } from './util.js';

export const NATIVE_FORMAT = 'api-client';
export const NATIVE_VERSION = 1;

export function exportNative({ collections = [], environments = [], globals = null } = {}) {
  return pretty({
    format: NATIVE_FORMAT,
    version: NATIVE_VERSION,
    exportedAt: new Date().toISOString(),
    // Sharing belongs to this account's cloud files; a copy in a file is the user's own.
    collections: arr(collections).map(({ shared, ...c }) => c),
    environments: arr(environments),
    ...(globals?.variables?.length ? { globals: { variables: globals.variables } } : {}),
  });
}

export function exportCollectionNative(collection) {
  return exportNative({ collections: [collection] });
}

export function isNative(obj) {
  if (!isObj(obj)) return false;
  if (obj.format === NATIVE_FORMAT) return true;
  return obj.type === 'collection' && Array.isArray(obj.items);
}

export function importNative(obj) {
  const warnings = [];
  if (obj.type === 'collection' && obj.format !== NATIVE_FORMAT) {
    return { collections: [unshared(normalizeCollection(obj))], environments: [], warnings };
  }
  const version = Number(obj.version) || 1;
  if (version > NATIVE_VERSION) warnings.push(`This file was written by a newer version (format ${version}); some data may be missing.`);
  const collections = arr(obj.collections).filter(isObj).map(normalizeCollection).map(unshared);
  const environments = arr(obj.environments).filter(isObj).map(normalizeEnvironment);
  const globals = isObj(obj.globals) ? normalizeEnvironment({ id: 'globals', name: 'Globals', variables: obj.globals.variables }).variables.filter((v) => v.key) : [];
  return { collections, environments, globals, warnings };
}

/** Imported collections are the user's own, even if the file was exported from a shared copy. */
function unshared({ shared, ...c }) {
  return c;
}
