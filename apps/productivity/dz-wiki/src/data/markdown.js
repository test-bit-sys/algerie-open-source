/**
 * Whole pages to and from Markdown (export, import, and pasting text), and
 * pasted HTML to blocks.
 */
import { deltaToMarkdown, markdownToDelta, deltaText, domToDelta, deltaToHtml } from './richtext.js';
import { safeUrl, escapeHtml } from '../lib/sanitize.js';
import { listNumber } from './page.js';

const PREFIX = { h1: '# ', h2: '## ', h3: '### ', bulleted: '- ', toggle: '- ' };

/** Blocks (from listBlocks) to Markdown. pageTitle(id) names linked pages. */
export function blocksToMarkdown(blocks, { pageTitle = () => 'Untitled', assetName = null } = {}) {
  const lines = [];
  let prevType = null;
  const list = blocks.map((b) => ({ type: b.type, indent: b.indent || 0 }));
  blocks.forEach((b, index) => {
    const pad = '  '.repeat(b.indent || 0);
    const text = deltaToMarkdown(b.delta || []);
    const isList = ['bulleted', 'numbered', 'todo', 'toggle'].includes(b.type);
    if (lines.length && !(isList && ['bulleted', 'numbered', 'todo', 'toggle'].includes(prevType))) lines.push('');
    switch (b.type) {
      case 'numbered':
        lines.push(`${pad}${listNumber(list, index)}. ${text}`);
        break;
      case 'todo':
        lines.push(`${pad}- [${b.checked ? 'x' : ' '}] ${text}`);
        break;
      case 'code':
        lines.push(`${pad}\`\`\`${b.language || ''}`, ...deltaText(b.delta || []).split('\n').map((l) => pad + l), `${pad}\`\`\``);
        break;
      case 'divider':
        lines.push(`${pad}---`);
        break;
      case 'quote':
      case 'callout':
        lines.push(`${pad}> ${text.replace(/\n/g, `\n${pad}> `)}`);
        break;
      case 'image': {
        const src = safeUrl(b.url) || (b.asset && assetName ? assetName(b.asset) : '');
        lines.push(`${pad}![${(b.caption || '').replace(/[[\]]/g, '')}](${src})`);
        break;
      }
      case 'bookmark':
        lines.push(`${pad}[${(b.name || b.url || '').replace(/[[\]]/g, '')}](${b.url || ''})`);
        break;
      case 'page':
        lines.push(`${pad}[${pageTitle(b.page).replace(/[[\]]/g, '')}](#${b.page})`);
        break;
      case 'table': {
        const rows = b.table?.rows || [];
        const cols = Math.max(1, ...rows.map((r) => r.length));
        const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
        if (rows.length) {
          lines.push(`${pad}| ${Array.from({ length: cols }, (_, i) => cell(rows[0][i])).join(' | ')} |`);
          lines.push(`${pad}| ${Array.from({ length: cols }, () => '---').join(' | ')} |`);
          for (const r of rows.slice(1)) lines.push(`${pad}| ${Array.from({ length: cols }, (_, i) => cell(r[i])).join(' | ')} |`);
        }
        break;
      }
      default:
        lines.push(`${pad}${PREFIX[b.type] || ''}${text}`);
    }
    prevType = b.type;
  });
  return `${lines.join('\n')}\n`;
}

/** Markdown to block specs for insertBlocks(). */
export function markdownToBlocks(md) {
  const out = [];
  const lines = String(md ?? '').replace(/\r\n?/g, '\n').split('\n');
  let para = null;
  const flush = () => {
    if (para !== null) {
      out.push({ type: 'paragraph', delta: markdownToDelta(para) });
      para = null;
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const indentMatch = /^(\s*)/.exec(raw)[1].replace(/\t/g, '  ');
    const indent = Math.min(6, Math.floor(indentMatch.length / 2));
    const line = raw.trim();
    let m;
    if (!line) {
      flush();
      continue;
    }
    if ((m = /^```\s*([\w+#.-]*)\s*$/.exec(line))) {
      flush();
      // Code lines carry the fence's indentation (export pads nested blocks).
      const fenceIndent = /^\s*/.exec(raw)[0].length;
      const body = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++].replace(/^\s+/, (ws) => ws.slice(fenceIndent)));
      out.push({ type: 'code', language: m[1] || '', text: body.join('\n'), indent });
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      flush();
      out.push({ type: 'divider', indent });
      continue;
    }
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
      flush();
      out.push({ type: `h${Math.min(3, m[1].length)}`, delta: markdownToDelta(m[2]), indent });
      continue;
    }
    if ((m = /^[-*+]\s+\[([ xX])\]\s*(.*)$/.exec(line))) {
      flush();
      out.push({ type: 'todo', checked: m[1] !== ' ', delta: markdownToDelta(m[2]), indent });
      continue;
    }
    if ((m = /^[-*+]\s+(.*)$/.exec(line))) {
      flush();
      out.push({ type: 'bulleted', delta: markdownToDelta(m[1]), indent });
      continue;
    }
    if ((m = /^\d+[.)]\s+(.*)$/.exec(line))) {
      flush();
      out.push({ type: 'numbered', delta: markdownToDelta(m[1]), indent });
      continue;
    }
    if ((m = /^>\s?(.*)$/.exec(line))) {
      flush();
      const body = [m[1]];
      while (i + 1 < lines.length && /^\s*>/.test(lines[i + 1])) body.push(lines[++i].trim().replace(/^>\s?/, ''));
      out.push({ type: 'quote', delta: markdownToDelta(body.join('\n')), indent });
      continue;
    }
    if ((m = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(line))) {
      flush();
      const url = safeUrl(m[2]);
      if (url) out.push({ type: 'image', url, caption: m[1], indent });
      continue;
    }
    if (/^\|.*\|$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      flush();
      const split = (l) => l.trim().slice(1, -1).split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
      const rows = [split(line)];
      i++;
      while (i + 1 < lines.length && /^\s*\|.*\|\s*$/.test(lines[i + 1])) rows.push(split(lines[++i]));
      out.push({ type: 'table', table: { rows, header: true }, indent });
      continue;
    }
    // Hard line breaks (two trailing spaces) keep paragraphs together.
    if (para !== null && /\s{2}$/.test(lines[i - 1] || '')) para += `\n${line}`;
    else {
      flush();
      para = line;
    }
  }
  flush();
  return out;
}

const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'HR', 'TABLE', 'FIGURE', 'IMG', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'NAV', 'DL', 'DT', 'DD']);

/** Pasted HTML to block specs. Inline formatting is kept, styling is not. */
export function htmlToBlocks(html) {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html');
  for (const el of doc.querySelectorAll('script, style, template, iframe, object, embed, noscript, head, meta, link')) el.remove();
  const out = [];
  const hasBlock = (el) => [...el.children].some((c) => BLOCK_TAGS.has(c.tagName));
  const textBlock = (type, el, indent, extra = {}) => {
    const delta = domToDelta(el);
    if (!deltaText(delta).trim() && type === 'paragraph') return;
    // Leading and trailing whitespace from HTML formatting is not content.
    if (delta.length) {
      delta[0] = { ...delta[0], insert: delta[0].insert.replace(/^\s+/, '') };
      const last = delta.length - 1;
      delta[last] = { ...delta[last], insert: delta[last].insert.replace(/\s+$/, '') };
    }
    out.push({ type, delta: delta.filter((op) => op.insert), indent, ...extra });
  };
  const walk = (node, indent, listType = null) => {
    let inline = [];
    const flushInline = () => {
      if (!inline.length) return;
      const wrap = doc.createElement('div');
      for (const n of inline) wrap.append(n.cloneNode(true));
      textBlock('paragraph', wrap, indent);
      inline = [];
    };
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 3) {
        if (child.data.trim()) inline.push(child);
        continue;
      }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName;
      if (!BLOCK_TAGS.has(tag)) {
        if (tag === 'BR' && !inline.length) continue;
        inline.push(child);
        continue;
      }
      flushInline();
      if (/^H[1-6]$/.test(tag)) textBlock(`h${Math.min(3, Number(tag[1]))}`, child, indent);
      else if (tag === 'UL' || tag === 'OL') walk(child, listType ? indent + 1 : indent, tag === 'OL' ? 'numbered' : 'bulleted');
      else if (tag === 'LI') {
        const box = child.querySelector(':scope > input[type="checkbox"]');
        const nested = [...child.children].filter((c) => c.tagName === 'UL' || c.tagName === 'OL');
        const own = child.cloneNode(true);
        for (const c of [...own.children]) if (c.tagName === 'UL' || c.tagName === 'OL' || c.tagName === 'INPUT') c.remove();
        if (box) textBlock('todo', own, indent, { checked: box.checked });
        else textBlock(listType || 'bulleted', own, indent);
        for (const n of nested) walk(n, indent + 1, n.tagName === 'OL' ? 'numbered' : 'bulleted');
      } else if (tag === 'BLOCKQUOTE') {
        if (hasBlock(child)) walk(child, indent);
        else textBlock('quote', child, indent);
      } else if (tag === 'PRE') out.push({ type: 'code', text: child.textContent.replace(/\n$/, ''), indent });
      else if (tag === 'HR') out.push({ type: 'divider', indent });
      else if (tag === 'IMG') {
        const url = safeUrl(child.getAttribute('src'));
        if (url && /^https?:/i.test(url)) out.push({ type: 'image', url, caption: child.getAttribute('alt') || '', indent });
      } else if (tag === 'TABLE') {
        const rows = [...child.querySelectorAll('tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim()));
        if (rows.length) out.push({ type: 'table', table: { rows, header: !!child.querySelector('th') }, indent });
      } else if (tag === 'FIGURE') walk(child, indent);
      else if (hasBlock(child)) walk(child, indent, listType);
      else textBlock('paragraph', child, indent);
    }
    flushInline();
  };
  walk(doc.body, 0);
  return out;
}

/** Blocks to simple HTML (copying, and export as a web page). */
export function blocksToHtml(blocks, { pageTitle = () => 'Untitled', assetSrc = () => '' } = {}) {
  let html = '';
  const open = [];
  const closeLists = (depth = 0, type = null) => {
    while (open.length > depth || (open.length && open.length === depth && type && open.at(-1) !== type)) html += `</${open.pop()}>`;
  };
  for (const b of blocks) {
    const inner = deltaToHtml(b.delta || []);
    const listTag = b.type === 'numbered' ? 'ol' : ['bulleted', 'todo', 'toggle'].includes(b.type) ? 'ul' : null;
    if (listTag) {
      const depth = (b.indent || 0) + 1;
      closeLists(depth, listTag);
      while (open.length < depth) {
        html += `<${listTag}>`;
        open.push(listTag);
      }
      html += b.type === 'todo' ? `<li><input type="checkbox" disabled${b.checked ? ' checked' : ''}> ${inner}</li>` : `<li>${inner}</li>`;
      continue;
    }
    closeLists();
    switch (b.type) {
      case 'h1':
      case 'h2':
      case 'h3':
        html += `<${b.type}>${inner}</${b.type}>`;
        break;
      case 'quote':
        html += `<blockquote>${inner}</blockquote>`;
        break;
      case 'callout':
        html += `<aside class="callout">${inner}</aside>`;
        break;
      case 'code':
        html += `<pre><code>${escapeHtml(deltaText(b.delta || []))}</code></pre>`;
        break;
      case 'divider':
        html += '<hr>';
        break;
      case 'image': {
        const src = (b.url && /^https?:/i.test(safeUrl(b.url) || '') ? safeUrl(b.url) : '') || assetSrc(b.asset) || '';
        html += `<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(b.caption || '')}">${b.caption ? `<figcaption>${escapeHtml(b.caption)}</figcaption>` : ''}</figure>`;
        break;
      }
      case 'bookmark':
        html += `<p><a href="${escapeHtml(safeUrl(b.url) || '')}">${escapeHtml(b.name || b.url || '')}</a></p>`;
        break;
      case 'page':
        html += `<p><a href="#${/^[a-z0-9]{1,40}$/.test(b.page || '') ? b.page : ''}">${escapeHtml(pageTitle(b.page))}</a></p>`;
        break;
      case 'table': {
        const rows = b.table?.rows || [];
        html += '<table>';
        rows.forEach((r, i) => {
          const tag = i === 0 && b.table?.header ? 'th' : 'td';
          html += `<tr>${r.map((c) => `<${tag}>${escapeHtml(c)}</${tag}>`).join('')}</tr>`;
        });
        html += '</table>';
        break;
      }
      default:
        html += `<p>${inner || '<br>'}</p>`;
    }
  }
  closeLists();
  return html;
}
