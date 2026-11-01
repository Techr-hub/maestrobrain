// Small, safe Markdown renderer (escapes HTML first). Supports Obsidian [[wikilinks]] and - [ ] tasks.
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s);
  s = s.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, t, a) => `<a class="wikilink" data-note="${esc(t.trim())}">${esc((a || t).trim())}</a>`);
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/(^|\W)_([^_\n]+)_(?=\W|$)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
  return s;
}

export function renderMarkdown(src = '') {
  src = src.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, ''); // hide frontmatter
  const lines = src.replace(/\r/g, '').split('\n');
  const out = [];
  let i = 0;
  let list = null; // 'ul' | 'ol'
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      closeList();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      i++; continue;
    }
    if (/^\s*$/.test(line)) { closeList(); i++; continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { closeList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { closeList(); out.push('<hr>'); i++; continue; }
    if (/^>\s?/.test(line)) {
      closeList();
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${buf.map(inline).join('<br>')}</blockquote>`);
      continue;
    }
    if (/^\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\|?\s*:?-+/.test(lines[i + 1])) {
      closeList();
      const row = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = row(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) rows.push(row(lines[i++]));
      out.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    const li = line.match(/^\s*([-*+]|\d+\.)\s+(.*)$/);
    if (li) {
      const type = /\d/.test(li[1]) ? 'ol' : 'ul';
      if (list !== type) { closeList(); out.push(`<${type}>`); list = type; }
      const task = li[2].match(/^\[( |x|X)\]\s+(.*)$/);
      if (task) out.push(`<li class="task-li"><input type="checkbox" disabled ${task[1] !== ' ' ? 'checked' : ''}> ${inline(task[2])}</li>`);
      else out.push(`<li>${inline(li[2])}</li>`);
      i++; continue;
    }
    closeList();
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|>|```|\s*([-*+]|\d+\.)\s|\|)/.test(lines[i])) buf.push(lines[i++]);
    out.push(`<p>${buf.map(inline).join('<br>')}</p>`);
  }
  closeList();
  return out.join('\n');
}

export function stripMarkdown(s = '') {
  return s.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, t, a) => a || t).replace(/[*_`>#]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\n{2,}/g, '. ').replace(/\n-\s*/g, '. ').replace(/\s+/g, ' ').trim();
}

export { esc };
