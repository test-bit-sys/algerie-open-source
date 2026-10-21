/**
 * Import entry point: detects the format of a file (or pasted text) and turns
 * it into model data. Every importer returns { collections, environments,
 * warnings }, and the result is normalized again here so callers always get
 * valid Collections and Environments.
 */
import { normalizeCollection, normalizeEnvironment, normalizeRequest } from '../model.js';
import { looksLikeCurl, parseCurl } from '../curl.js';
import { isNative, importNative } from './native.js';
import { collectionV2Version, importCollectionV2, importEnvironmentV2, isEnvironmentV2 } from './collection-v2.js';
import { importOpenApi, openApiKind } from './openapi.js';
import { importHar, isHar } from './har.js';
import { importInsomnia, isInsomnia } from './insomnia.js';
import { isObj, parseStructured } from './util.js';

export { exportNative, exportCollectionNative } from './native.js';
export { exportCollectionV2, exportEnvironmentV2 } from './collection-v2.js';

export const FORMATS = [
  { id: 'native', label: 'API Client export', extensions: ['.json'] },
  { id: 'collection-v2.1', label: 'Postman Collection v2.1', extensions: ['.json'] },
  { id: 'collection-v2.0', label: 'Postman Collection v2.0', extensions: ['.json'] },
  { id: 'environment-v2', label: 'Postman Environment', extensions: ['.json'] },
  { id: 'openapi', label: 'OpenAPI 3.x', extensions: ['.json', '.yaml', '.yml'] },
  { id: 'swagger', label: 'Swagger 2.0', extensions: ['.json', '.yaml', '.yml'] },
  { id: 'har', label: 'HAR (HTTP Archive)', extensions: ['.har', '.json'] },
  { id: 'insomnia', label: 'Insomnia export (v4)', extensions: ['.json', '.yaml', '.yml'] },
  { id: 'curl', label: 'curl command', extensions: ['.sh', '.txt'] },
];

function detectObject(obj) {
  if (!isObj(obj)) return null;
  if (isNative(obj)) return 'native';
  const v2 = collectionV2Version(obj);
  if (v2) return `collection-${v2}`;
  const oa = openApiKind(obj);
  if (oa) return oa;
  if (isHar(obj)) return 'har';
  if (isInsomnia(obj)) return 'insomnia';
  if (isEnvironmentV2(obj)) return 'environment-v2';
  return null;
}

/** Format id for text or an already parsed object, or null when unknown. */
export function detectFormat(input) {
  if (typeof input === 'string') {
    if (looksLikeCurl(input)) return 'curl';
    return detectObject(parseStructured(input));
  }
  return detectObject(input);
}

const baseName = (fileName) => (fileName ? String(fileName).split(/[\\/]/).pop().replace(/\.[^.]+$/, '') : '');

/**
 * Imports JSON or YAML text (or a curl command).
 * Returns { format, collections, environments, warnings }; throws an Error
 * with a message suitable for showing to the user when nothing can be read.
 */
export async function importData(input, { fileName } = {}) {
  if (input == null || (typeof input === 'string' && !input.trim())) throw new Error('The file is empty.');
  const name = baseName(fileName);

  if (typeof input === 'string' && looksLikeCurl(input)) {
    let partial;
    try {
      partial = parseCurl(input);
    } catch (err) {
      throw new Error(`Could not read the curl command: ${err.message}`);
    }
    const req = normalizeRequest({ ...partial, name: partial?.name || requestName(partial) });
    const col = normalizeCollection({ name: 'Imported request', items: [req] });
    return { format: 'curl', collections: [col], environments: [], warnings: partial.warnings || [] };
  }

  let reason = '';
  const obj = parseStructured(input, (err) => {
    reason = String(err?.message || '').split('\n')[0].replace(/:$/, '');
  });
  if (obj === undefined) throw new Error(`This file is not valid JSON or YAML, and it is not a curl command.${reason ? ` ${reason}.` : ''}`);
  const format = detectObject(obj);
  if (!format) {
    if (isObj(obj?.info) && /collection\/v1/.test(String(obj.info.schema || ''))) {
      throw new Error('Collection format v1 is not supported. Re-export the collection as v2.1 and try again.');
    }
    const labels = FORMATS.map((f) => f.label).join(', ');
    throw new Error(`This file is not in a supported format. Supported formats: ${labels}.`);
  }

  let result;
  switch (format) {
    case 'native':
      result = importNative(obj);
      break;
    case 'collection-v2.0':
    case 'collection-v2.1':
      result = importCollectionV2(obj);
      break;
    case 'environment-v2':
      result = importEnvironmentV2(obj);
      break;
    case 'openapi':
    case 'swagger':
      result = importOpenApi(obj);
      break;
    case 'har':
      result = importHar(obj, { name });
      break;
    case 'insomnia':
      result = importInsomnia(obj, { name });
      break;
    default:
      throw new Error('This file is not in a supported format.');
  }

  const collections = result.collections.map(normalizeCollection);
  const environments = result.environments.map(normalizeEnvironment);
  const globals = result.globals || [];
  if (!collections.length && !environments.length && !globals.length) throw new Error('The file was read, but it contains nothing to import.');
  return { format, collections, environments, globals, warnings: result.warnings || [] };
}

function requestName(r) {
  const method = String(r?.method || 'GET').toUpperCase();
  const url = String(r?.url || '');
  try {
    return `${method} ${new URL(url).pathname}`;
  } catch {
    return url ? `${method} ${url}` : 'Imported request';
  }
}
