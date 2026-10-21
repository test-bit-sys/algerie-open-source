/** Display formatting for sizes, durations and times. */
export function formatBytes(n) {
  if (n == null || Number.isNaN(n)) return '';
  if (n < 1024) return `${n} B`;
  // Units are picked after rounding, so 1048575 B reads "1.00 MB", not "1024.0 KB".
  const kb = (n / 1024).toFixed(n < 10240 ? 2 : 1);
  if (Number(kb) < 1024) return `${kb} KB`;
  return `${(n / 1048576).toFixed(n < 10485760 ? 2 : 1)} MB`;
}

export function formatMs(ms) {
  if (ms == null || Number.isNaN(ms)) return '';
  if (Math.round(ms) < 1000) return `${Math.round(ms)} ms`;
  const s = (ms / 1000).toFixed(2);
  if (Number(s) < 60) return `${s} s`;
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)} m ${total % 60} s`;
}

const STATUS_TEXT = {
  100: 'Continue', 101: 'Switching Protocols', 103: 'Early Hints', 200: 'OK', 201: 'Created', 202: 'Accepted',
  203: 'Non-Authoritative Information', 204: 'No Content', 205: 'Reset Content', 206: 'Partial Content', 207: 'Multi-Status',
  300: 'Multiple Choices', 301: 'Moved Permanently', 302: 'Found', 303: 'See Other', 304: 'Not Modified', 307: 'Temporary Redirect',
  308: 'Permanent Redirect', 400: 'Bad Request', 401: 'Unauthorized', 402: 'Payment Required', 403: 'Forbidden', 404: 'Not Found',
  405: 'Method Not Allowed', 406: 'Not Acceptable', 408: 'Request Timeout', 409: 'Conflict', 410: 'Gone', 411: 'Length Required',
  412: 'Precondition Failed', 413: 'Content Too Large', 414: 'URI Too Long', 415: 'Unsupported Media Type', 416: 'Range Not Satisfiable',
  418: "I'm a Teapot", 422: 'Unprocessable Content', 425: 'Too Early', 426: 'Upgrade Required', 428: 'Precondition Required',
  429: 'Too Many Requests', 431: 'Request Header Fields Too Large', 451: 'Unavailable For Legal Reasons', 500: 'Internal Server Error',
  501: 'Not Implemented', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout', 505: 'HTTP Version Not Supported',
};

export function statusText(code, given = '') {
  return given || STATUS_TEXT[code] || '';
}

/** 'info' | 'success' | 'redirect' | 'client' | 'server' | 'none' */
export function statusClass(code) {
  if (!code) return 'none';
  if (code < 200) return 'info';
  if (code < 300) return 'success';
  if (code < 400) return 'redirect';
  if (code < 500) return 'client';
  return 'server';
}

export function relativeDay(ts, now = Date.now()) {
  const d = new Date(ts);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: diff < 7 ? 'long' : undefined, month: 'long', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

export function timeOfDay(ts) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
