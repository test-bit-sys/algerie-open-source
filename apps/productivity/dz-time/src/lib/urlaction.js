/**
 * URL actions: a tiny vocabulary on the hash so the app can be addressed
 * from outside itself — an installed-icon shortcut, a home-screen link, an
 * OS or launcher shortcut the user wires up themselves.
 *
 *   #/?action=log                     open the Log time sheet
 *   #/?action=stop                    stop the running timer
 *   #/?action=start&project=<id>      start a timer on that project
 *                  [&task=<text>]     ...optionally tagged with a task
 *
 * The route itself is the part before the query, which the router already
 * ignores, so an action never changes which view an action lands on.
 * Parsing lives here, apart from the DOM, so the vocabulary is testable
 * and the runner (src/ui/actions.js) only has to act.
 */

const ACTION_PARAMS = ['action', 'project', 'task'];

/** The query part of a hash ("#/?a=1" -> "a=1"), or ''. */
function queryOf(hash) {
  const i = String(hash ?? '').indexOf('?');
  return i === -1 ? '' : String(hash).slice(i + 1);
}

/**
 * The action a hash asks for, or null. Unknown verbs are null (nothing
 * happens rather than a guess), and both `task` and `project` are
 * optional so a malformed link still degrades to a named no-op.
 */
export function parseAction(hash) {
  const params = new URLSearchParams(queryOf(hash));
  const action = (params.get('action') || '').trim().toLowerCase();
  if (!['log', 'stop', 'start'].includes(action)) return null;
  return {
    action,
    projectId: (params.get('project') || '').trim() || null,
    task: (params.get('task') || '').trim(),
  };
}

/**
 * The same hash with the action stripped, so a reload cannot re-fire it.
 * Any other query parameter is kept (nothing else uses one today, but a
 * link the user built by hand may), and a hash that held nothing else
 * collapses back to its bare route.
 */
export function withoutAction(hash) {
  const raw = String(hash ?? '');
  const i = raw.indexOf('?');
  const route = (i === -1 ? raw : raw.slice(0, i)) || '#/';
  if (i === -1) return route;
  const params = new URLSearchParams(raw.slice(i + 1));
  for (const key of ACTION_PARAMS) params.delete(key);
  const rest = params.toString();
  return rest ? `${route}?${rest}` : route;
}

/** The shareable link that starts a timer on a project. */
export function startLinkFor(projectId, { origin = location.origin, path = location.pathname } = {}) {
  return `${origin}${path}#/?action=start&project=${encodeURIComponent(projectId)}`;
}
