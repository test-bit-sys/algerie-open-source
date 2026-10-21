/**
 * Where the app is running. Inside Puter (env 'app') the platform owns the
 * session, so the app must not offer sign-out; on the open web it must.
 * https://docs.puter.com/Utils/env/
 */
export function isPuterApp() {
  return typeof puter !== 'undefined' && puter.env === 'app';
}
