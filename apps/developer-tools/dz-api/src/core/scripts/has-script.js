/** False for empty, whitespace-only or comment-only code, so the sandbox can be skipped cheaply. */
export function hasScript(code) {
  if (typeof code !== 'string') return false;
  // Naive comment stripping is safe here: it can only remove text after real
  // code (for example "//" inside a string), so the answer stays true.
  return code.replace(/\/\*[\s\S]*?(\*\/|$)/g, '').replace(/\/\/[^\n]*/g, '').trim() !== '';
}
