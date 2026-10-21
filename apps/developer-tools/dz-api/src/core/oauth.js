/**
 * OAuth 2.0 token requests for the client credentials and password grants.
 * The token endpoint is called with the app's normal transport.
 */
import { send } from './send.js';

function b64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Builds the resolved token request. cfg values must already be resolved. */
export function tokenRequest(cfg) {
  const fields = [{ key: 'grant_type', value: cfg.grantType === 'password' ? 'password' : 'client_credentials' }];
  if (cfg.grantType === 'password') {
    fields.push({ key: 'username', value: cfg.username }, { key: 'password', value: cfg.password });
  }
  if (cfg.scope) fields.push({ key: 'scope', value: cfg.scope });
  const headers = [{ key: 'Accept', value: 'application/json' }, { key: 'Content-Type', value: 'application/x-www-form-urlencoded' }];
  if (cfg.clientAuth === 'body') {
    fields.push({ key: 'client_id', value: cfg.clientId });
    if (cfg.clientSecret) fields.push({ key: 'client_secret', value: cfg.clientSecret });
  } else {
    headers.push({ key: 'Authorization', value: `Basic ${b64(`${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`)}` });
  }
  return { method: 'POST', url: cfg.tokenUrl, headers, body: { mode: 'urlencoded', fields } };
}

/** Returns { accessToken, tokenType, expiresIn, raw } or throws with the server's message. */
export async function fetchToken(cfg, sendOptions = {}) {
  if (!cfg.tokenUrl) throw new Error('Enter the token URL.');
  if (!cfg.clientId) throw new Error('Enter the client ID.');
  const res = await send(tokenRequest(cfg), sendOptions);
  const text = new TextDecoder().decode(res.body);
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = Object.fromEntries(new URLSearchParams(text));
  }
  if (res.status >= 400 || !data?.access_token) {
    const reason = data?.error_description || data?.error || `${res.status} ${res.statusText}`.trim();
    throw new Error(`The token request failed: ${reason}`);
  }
  return { accessToken: data.access_token, tokenType: data.token_type || 'Bearer', expiresIn: data.expires_in ?? null, raw: data, transport: res.transport };
}
