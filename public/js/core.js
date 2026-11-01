// Shared helpers: API client, app state, toasts, modals and the note drawer.
import { icon } from './icons.js';
import { renderMarkdown, esc } from './md.js';

export const S = { state: null, feed: [], route: 'dashboard', conversationId: null, agent: null, livePaused: false, category: 'all', source: 'all' };

export async function api(path, body, method) {
  const res = await fetch('/api' + path, {
    method: method || (body ? 'POST' : 'GET'),
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}

export async function refreshState() {
  S.state = await api('/state');
  return S.state;
}

export function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), type === 'error' ? 6000 : 3500);
}

export function timeAgo(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export function modal(html, { wide = false, onMount } = {}) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  ov.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  document.addEventListener('keydown', onKey);
  document.body.appendChild(ov);
  if (onMount) onMount(ov.querySelector('.modal'), close);
  return { el: ov.querySelector('.modal'), close };
}

export function modalHead(title, sub = '') {
  return `<div class="modal-head"><div><h3>${title}</h3>${sub ? `<p>${sub}</p>` : ''}</div><button class="icon-btn" data-close title="Close" style="width:36px;height:36px;font-size:18px">${icon('x')}</button></div>`;
}

let drawerEl = null;
export function closeDrawer() { if (drawerEl) { drawerEl.remove(); drawerEl = null; } }

export function obsidianUrl(relPath) {
  const st = S.state;
  if (!st) return '#';
  return `obsidian://open?vault=${encodeURIComponent(st.vaultName)}&file=${encodeURIComponent(relPath.replace(/\.md$/, ''))}`;
}

// Open a vault note in a side drawer (used by wikilinks, the brain map and chat sources).
export async function openNote(ref) {
  let rel = ref;
  if (!/\.md$/i.test(rel)) {
    const tree = await api('/vault/tree');
    const t = ref.toLowerCase();
    const hit = tree.find((n) => n.title.toLowerCase() === t || n.path.toLowerCase() === t + '.md' || n.path.toLowerCase().endsWith('/' + t + '.md'));
    if (!hit) return toast(`No note called "${ref}" yet`, 'error');
    rel = hit.path;
  }
  let note;
  try { note = await api('/vault/note?path=' + encodeURIComponent(rel)); } catch (e) { return toast(e.message, 'error'); }
  closeDrawer();
  drawerEl = document.createElement('div');
  drawerEl.className = 'drawer';
  drawerEl.innerHTML = `
    <div class="drawer-head"><div><h3>${esc(note.title)}</h3><div class="note-toolbar"><span class="path">${esc(rel)}</span></div></div>
      <div style="display:flex;gap:8px"><a class="btn ghost small" href="${obsidianUrl(rel)}">${icon('external-link')} Obsidian</a><button class="icon-btn" style="width:36px;height:36px;font-size:18px" data-x>${icon('x')}</button></div></div>
    <div class="drawer-body md">${renderMarkdown(note.raw)}</div>`;
  drawerEl.querySelector('[data-x]').onclick = closeDrawer;
  wireWikilinks(drawerEl);
  document.body.appendChild(drawerEl);
}

export function wireWikilinks(root) {
  root.querySelectorAll('a.wikilink').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); openNote(a.dataset.note); }));
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
