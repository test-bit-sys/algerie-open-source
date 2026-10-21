/**
 * Note tags. A tag marks a whole paragraph: it is stored as a
 * <span class="nt-tag" data-tag="todo" data-done="true"> at the start of the
 * block. "check" tags toggle between open and done; "highlight" tags also
 * shade the paragraph text.
 */
export const TAGS = [
  { id: 'todo', label: 'To Do', icon: 'todo', kind: 'check', color: '#2f6fd0', key: '1' },
  { id: 'important', label: 'Important', icon: 'star', kind: 'icon', color: '#d4a106', key: '2' },
  { id: 'question', label: 'Question', icon: 'question', kind: 'icon', color: '#7e2fa8', key: '3' },
  { id: 'remember', label: 'Remember for later', icon: 'highlight', kind: 'highlight', color: '#a07a00', shade: '#fff3a3', shadeDark: '#5c5000', key: '4' },
  { id: 'definition', label: 'Definition', icon: 'highlight', kind: 'highlight', color: '#2b8a3e', shade: '#c8f0c9', shadeDark: '#1f4d24', key: '5' },
  { id: 'highlight', label: 'Highlight', icon: 'highlight', kind: 'highlight', color: '#b8860b', shade: '#ffe58a', shadeDark: '#5a4a00', key: '6' },
  { id: 'contact', label: 'Contact', icon: 'user', kind: 'icon', color: '#2f6fd0', key: '7' },
  { id: 'address', label: 'Address', icon: 'house', kind: 'icon', color: '#2f6fd0', key: '8' },
  { id: 'phone', label: 'Phone number', icon: 'phone', kind: 'icon', color: '#2f6fd0', key: '9' },
  { id: 'website', label: 'Website to visit', icon: 'globe', kind: 'icon', color: '#2f6fd0' },
  { id: 'idea', label: 'Idea', icon: 'tellMe', kind: 'icon', color: '#d4a106' },
  { id: 'password', label: 'Password', icon: 'key', kind: 'icon', color: '#6b6b6b' },
  { id: 'critical', label: 'Critical', icon: 'critical', kind: 'icon', color: '#c42b1c' },
  { id: 'projectA', label: 'Project A', icon: 'flag', kind: 'icon', color: '#c42b1c' },
  { id: 'projectB', label: 'Project B', icon: 'flag', kind: 'icon', color: '#d4a106' },
  { id: 'movie', label: 'Movie to see', icon: 'film', kind: 'icon', color: '#6b6b6b' },
  { id: 'book', label: 'Book to read', icon: 'book', kind: 'icon', color: '#6b6b6b' },
  { id: 'music', label: 'Music to listen to', icon: 'music', kind: 'icon', color: '#6b6b6b' },
  { id: 'source', label: 'Source for article', icon: 'fileText', kind: 'icon', color: '#2f6fd0' },
  { id: 'discuss', label: 'Discuss with manager', icon: 'users', kind: 'icon', color: '#2b8a3e' },
  { id: 'email', label: 'Send in email', icon: 'mail', kind: 'icon', color: '#2f6fd0' },
  { id: 'meeting', label: 'Schedule meeting', icon: 'date', kind: 'check', color: '#2f6fd0' },
  { id: 'callback', label: 'Call back', icon: 'phoneCall', kind: 'check', color: '#2f6fd0' },
  { id: 'priority1', label: 'To Do priority 1', icon: 'todo', kind: 'check', color: '#c42b1c' },
  { id: 'priority2', label: 'To Do priority 2', icon: 'todo', kind: 'check', color: '#d4a106' },
  { id: 'client', label: 'Client request', icon: 'briefcase', kind: 'check', color: '#2f6fd0' },
];

export const TAG_BY_ID = new Map(TAGS.map((t) => [t.id, t]));

export function tagLabel(id) {
  return TAG_BY_ID.get(id)?.label || id;
}

/**
 * Reads the tagged paragraphs out of stored outline HTML.
 * Returns [{ tag, done, text, outlineId }].
 */
export function extractTags(outlines) {
  const out = [];
  const doc = document.implementation.createHTMLDocument('');
  for (const outline of outlines || []) {
    const div = doc.createElement('div');
    div.innerHTML = outline.html || '';
    [...div.querySelectorAll('span.nt-tag')].forEach((span, index) => {
      const block = span.closest('p, li, h1, h2, h3, h4, h5, h6, div, td, th, blockquote, pre') || span.parentElement;
      const clone = block.cloneNode(true);
      clone.querySelectorAll('.nt-tag').forEach((t) => t.remove());
      clone.querySelectorAll('ul, ol').forEach((l) => l.remove());
      out.push({
        tag: span.dataset.tag,
        done: span.dataset.done === 'true',
        text: clone.textContent.replace(/\s+/g, ' ').trim(),
        outlineId: outline.id,
        index,
      });
    });
  }
  return out;
}

/** Sets data-done on the index-th tag of an outline's stored HTML. */
export function setTagDoneInHtml(html, index, done) {
  const div = document.implementation.createHTMLDocument('').createElement('div');
  div.innerHTML = html || '';
  const span = div.querySelectorAll('span.nt-tag')[index];
  if (!span) return html;
  span.dataset.done = String(done);
  return div.innerHTML;
}
