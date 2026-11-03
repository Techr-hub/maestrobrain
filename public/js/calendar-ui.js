// Calendar views shared by the Intelligence Feed and the Calendar page:
// - monthCalendar: a month grid with month / year switching and the chosen day's events underneath.
// - weekCalendar: the Calendar page, with Day / Week time-grids and a Month grid.
import { icon } from './icons.js';
import { esc } from './md.js';
import { S, api, openNote, modal, modalHead } from './core.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dayKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`; };
const midnight = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
// "10:30–11:30 AM", "11 AM–1 PM": short enough for a narrow event block.
const fmtRange = (a, b) => {
  const p = (iso) => { const d = new Date(iso); const h = d.getHours(), m = d.getMinutes(); return { t: `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''}`, ap: h < 12 ? 'AM' : 'PM' }; };
  const x = p(a), y = p(b);
  return x.ap === y.ap ? `${x.t}–${y.t} ${y.ap}` : `${x.t} ${x.ap}–${y.t} ${y.ap}`;
};
const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?([ap])\.?m\.?/i, (m, a) => ` ${a.toUpperCase()}M`);

// The colour of an event: its calendar's colour (Maestro-created events use Maestro green).
export function eventColor(e) {
  if (e.source === 'maestro' || (e.created && !e.calendarFor)) return '#00f2af';
  const c = S.state && S.state.connectors.find((x) => x.id === e.source);
  return (c && c.color) || '#00e5ff';
}
const calName = (e) => { const c = S.state && S.state.connectors.find((x) => x.id === e.source); return e.calendarName || (c ? c.name.replace(/ \/.*$/, '').replace(/ \(.*\)/, '') : e.source === 'maestro' ? 'Maestro' : e.source); };

async function fetchRange(from, to, filter) {
  const list = await api(`/calendar?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`);
  return filter ? list.filter(filter) : list;
}

// Event details, with a button to ask Maestro about it.
export function openEvent(e, ask, createTask) {
  const when = e.allDay ? new Date(e.start).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) + ' · all day'
    : `${new Date(e.start).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })} · ${fmtTime(e.start)} – ${fmtTime(e.end)}`;
  const desc = String(e.description || (e.notes && !/^[\w -]+\/[\w .'&-]+$/.test(e.notes) ? e.notes : '')).replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/Created by Maestro/i, '').trim();
  modal(`${modalHead(esc(e.title), `<span class="cal-src" style="--c:${eventColor(e)}"><i></i>${esc(calName(e))}</span>`)}
    <div class="ev-detail">
      <div>${icon('clock')} ${esc(when)}${e.recurring ? ` <span class="tag">${icon('repeat')} repeats</span>` : ''}</div>
      ${e.location ? `<div>${icon('map-pin')} ${esc(e.location)}</div>` : ''}
      ${e.attendees && e.attendees.length ? `<div>${icon('users-round')} ${esc(e.attendees.join(', '))}</div>` : ''}
      ${desc ? `<div class="ev-desc">${esc(desc.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')).replace(/https?:\/\/[^\s<]+[^\s<.,;:)!?'"]/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`).replace(/\n/g, '<br>')}</div>` : ''}
    </div>
    <div class="modal-foot">${e.notes && /\//.test(e.notes) && !desc ? `<button class="btn ghost" id="ev-note">${icon('file-text')} Prep notes</button>` : ''}<button class="btn ghost" data-close>Close</button>${createTask ? `<button class="btn ghost" id="ev-task">${icon('clipboard-check')} Create Task</button>` : ''}${ask ? `<button class="btn primary" id="ev-ask">${icon('sparkles')} Ask Maestro about it</button>` : ''}</div>`, {
    onMount: (m, close) => {
      const n = m.querySelector('#ev-note'); if (n) n.onclick = () => { close(); openNote(e.notes); };
      const t = m.querySelector('#ev-task'); if (t) t.onclick = () => { close(); createTask({ title: e.title, category: 'MEETING', eventKey: e.uid || e.title }); };
      const a = m.querySelector('#ev-ask'); if (a) a.onclick = () => { close(); ask(`What is ${e.title} about?`); };
    },
  });
}

// ------------------------------------------------------------------ month
// opts: { filter(e) → bool, ask(text), title }
// The month view folds up like an accordion (Ryan, 2026-11-03); open or closed is remembered in maestro.feedMonthOpen.
let monthOpen = true;
try { monthOpen = localStorage.getItem('maestro.feedMonthOpen') !== '0'; } catch { /* storage blocked */ }
export function monthCalendar(host, opts = {}) {
  const today = midnight(new Date());
  const st = { y: today.getFullYear(), m: today.getMonth(), sel: today, events: [], cache: new Map() };
  const gridStart = () => { const first = new Date(st.y, st.m, 1); return addDays(first, -((first.getDay() + 6) % 7)); }; // Monday first
  const load = async () => {
    const key = `${st.y}-${st.m}`;
    if (!st.cache.has(key)) {
      const from = gridStart();
      try { st.cache.set(key, await fetchRange(from, addDays(from, 42), opts.filter)); } catch { st.cache.set(key, []); }
    }
    st.events = st.cache.get(key);
    draw();
  };
  const draw = () => {
    const from = gridStart();
    const byDay = new Map();
    for (const e of st.events) {
      // multi-day events show on each day they cover
      for (let d = midnight(e.start); d < new Date(e.end) || dayKey(d) === dayKey(e.start); d = addDays(d, 1)) {
        const k = dayKey(d); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(e);
        if (byDay.size > 400) break;
      }
    }
    const years = []; for (let y = today.getFullYear() - 2; y <= today.getFullYear() + 3; y++) years.push(y);
    let cells = '';
    for (let i = 0; i < 42; i++) {
      const d = addDays(from, i), k = dayKey(d), evs = byDay.get(k) || [];
      const cls = ['mc-day', d.getMonth() !== st.m ? 'out' : '', k === dayKey(today) ? 'today' : '', k === dayKey(st.sel) ? 'sel' : '', evs.length ? 'has' : ''].join(' ');
      const dots = [...new Set(evs.map(eventColor))].slice(0, 3).map((c) => `<i style="background:${c}"></i>`).join('');
      cells += `<button class="${cls}" data-d="${d.toISOString()}" title="${evs.length ? `${evs.length} event${evs.length > 1 ? 's' : ''}` : ''}"><span>${d.getDate()}</span>${dots ? `<em>${dots}</em>` : ''}</button>`;
    }
    const sel = (byDay.get(dayKey(st.sel)) || []).slice().sort((a, b) => new Date(a.start) - new Date(b.start));
    const selLabel = dayKey(st.sel) === dayKey(today) ? 'Today' : dayKey(st.sel) === dayKey(addDays(today, 1)) ? 'Tomorrow' : st.sel.toLocaleDateString([], { weekday: 'long' });
    const now = Date.now();
    const todayCount = (byDay.get(dayKey(today)) || []).length;
    host.innerHTML = `<div class="mc ${monthOpen ? 'open' : ''}">
      <button class="mc-acc" id="mc-acc" aria-expanded="${monthOpen}" aria-controls="mc-body">
        ${icon('calendar-days')}<b>Month view</b><span>${MONTHS[st.m]} ${st.y}</span>
        <small>${todayCount ? `${todayCount} today` : 'Nothing today'}</small>${icon('chevron-down', 'mc-chev')}
      </button>
      <div class="mc-body" id="mc-body" ${monthOpen ? '' : 'inert'}><div class="mc-inner">
      <div class="mc-head">
        <button class="mc-nav" data-step="-1" title="Previous month">${icon('chevron-left')}</button>
        <div class="mc-tabs"><select class="mc-tab" id="mc-m" aria-label="Month">${MONTHS.map((n, i) => `<option value="${i}" ${i === st.m ? 'selected' : ''}>${n.slice(0, 3)}</option>`).join('')}</select><select class="mc-tab" id="mc-y" aria-label="Year">${years.map((y) => `<option ${y === st.y ? 'selected' : ''}>${y}</option>`).join('')}</select></div>
        <button class="mc-nav" data-step="1" title="Next month">${icon('chevron-right')}</button>
      </div>
      <div class="mc-week">${['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => `<span>${d}</span>`).join('')}</div>
      <div class="mc-grid">${cells}</div>
      <div class="mc-agenda">
        <div class="mc-agenda-head"><b>${selLabel}</b><span>${st.sel.toLocaleDateString([], { month: 'long', day: 'numeric' })}</span>${dayKey(st.sel) !== dayKey(today) || st.m !== today.getMonth() ? `<button class="mc-today" id="mc-today">Today</button>` : ''}</div>
        ${sel.length ? sel.map((e, i) => {
          const past = new Date(e.end) < now, nowOn = new Date(e.start) <= now && new Date(e.end) >= now;
          return `<button class="mc-ev ${past ? 'past' : ''} ${nowOn ? 'now' : ''}" data-i="${i}" style="--c:${eventColor(e)}">
            <span class="mc-ev-time">${e.allDay ? 'All day' : fmtTime(e.start)}${e.allDay ? '' : `<small>${Math.round((new Date(e.end) - new Date(e.start)) / 60000)} min</small>`}</span>
            <span class="mc-ev-body"><b>${esc(e.title)}${e.recurring ? ` ${icon('repeat')}` : ''}</b>${e.location ? `<small>${icon('map-pin')} ${esc(e.location)}</small>` : ''}<small class="cal-src" style="--c:${eventColor(e)}"><i></i>${esc(calName(e))}</small></span>
          </button>`;
        }).join('') : `<div class="mc-free">Nothing on this day.</div>`}
      </div></div></div></div>`;
    host.querySelector('#mc-acc').onclick = () => {
      monthOpen = !monthOpen;
      try { localStorage.setItem('maestro.feedMonthOpen', monthOpen ? '1' : '0'); } catch { /* storage blocked */ }
      const mc = host.querySelector('.mc'), body = host.querySelector('#mc-body');
      mc.classList.toggle('open', monthOpen);
      host.querySelector('#mc-acc').setAttribute('aria-expanded', String(monthOpen));
      body.toggleAttribute('inert', !monthOpen);
    };
    host.querySelectorAll('.mc-nav').forEach((b) => b.onclick = () => { const d = new Date(st.y, st.m + Number(b.dataset.step), 1); st.y = d.getFullYear(); st.m = d.getMonth(); load(); });
    host.querySelector('#mc-m').onchange = (e) => { st.m = Number(e.target.value); load(); };
    host.querySelector('#mc-y').onchange = (e) => { st.y = Number(e.target.value); load(); };
    const t = host.querySelector('#mc-today'); if (t) t.onclick = () => { st.y = today.getFullYear(); st.m = today.getMonth(); st.sel = today; load(); };
    host.querySelectorAll('.mc-day').forEach((b) => b.onclick = () => {
      const d = midnight(b.dataset.d); st.sel = d;
      if (d.getMonth() !== st.m) { st.y = d.getFullYear(); st.m = d.getMonth(); load(); } else draw();
    });
    host.querySelectorAll('.mc-ev').forEach((b) => b.onclick = () => openEvent(sel[Number(b.dataset.i)], opts.ask));
  };
  draw();
  load();
  return { reload: () => { st.cache.clear(); load(); } };
}

// ------------------------------------------------------------------ week
const HOUR = 52; // px per hour
// The Calendar page (Ryan, 2026-11-02): Day, Week and Month views. Day and Week are time grids (all-day row, hours
// down the side, overlapping events side by side); Month is a grid of days with each day's events. Clicking an
// event opens its full details.
const VIEWS = { day: 'Day', week: 'Week', month: 'Month' };
let lastView = 'week';
try { lastView = localStorage.getItem('maestro.calView') || 'week'; } catch { /* storage blocked */ }
export function weekCalendar(host, opts = {}) {
  const today = midnight(new Date());
  const st = { view: VIEWS[lastView] ? lastView : 'week', date: today, events: [] };
  let scrolled = false;
  const range = () => {
    if (st.view === 'day') return [midnight(st.date), addDays(midnight(st.date), 1)];
    if (st.view === 'week') { const a = addDays(midnight(st.date), -st.date.getDay()); return [a, addDays(a, 7)]; } // weeks start on Sunday
    const first = new Date(st.date.getFullYear(), st.date.getMonth(), 1);
    const a = addDays(first, -first.getDay());
    return [a, addDays(a, 42)];
  };
  const load = async () => {
    const [a, b] = range();
    try { st.events = await fetchRange(a, b, opts.filter); } catch { st.events = []; }
    draw();
  };
  // Side-by-side columns for overlapping events in one day.
  const lanes = (evs) => {
    const sorted = evs.slice().sort((a, b) => new Date(a.start) - new Date(b.start) || new Date(b.end) - new Date(a.end));
    const out = []; let group = [], groupEnd = 0;
    const flush = () => { const cols = []; for (const e of group) { let c = cols.findIndex((end) => end <= new Date(e.start)); if (c < 0) { c = cols.length; cols.push(0); } cols[c] = new Date(e.end); e._col = c; } group.forEach((e) => { e._cols = cols.length; out.push(e); }); group = []; };
    for (const e of sorted) { if (group.length && new Date(e.start) >= groupEnd) flush(); group.push(e); groupEnd = Math.max(groupEnd, +new Date(e.end)); }
    flush();
    return out;
  };
  const isAllDay = (e) => e.allDay || new Date(e.end) - new Date(e.start) >= 86400000;
  const onDay = (e, d) => new Date(e.start) < addDays(d, 1) && new Date(e.end) > d;
  const title = () => {
    const [a] = range();
    if (st.view === 'day') return `<b>${st.date.toLocaleDateString([], { weekday: 'long' })}</b> ${MONTHS[st.date.getMonth()]} ${st.date.getDate()}, ${st.date.getFullYear()}`;
    if (st.view === 'month') return `<b>${MONTHS[st.date.getMonth()]}</b> ${st.date.getFullYear()}`;
    const z = addDays(a, 6);
    return a.getMonth() === z.getMonth() ? `<b>${MONTHS[a.getMonth()]}</b> ${a.getFullYear()}` : `<b>${MONTHS[a.getMonth()].slice(0, 3)} – ${MONTHS[z.getMonth()].slice(0, 3)}</b> ${z.getFullYear()}`;
  };
  const timeGrid = (days) => {
    const now = new Date();
    const evIn = st.events.filter((e) => days.some((d) => onDay(e, d)));
    const allDay = evIn.filter(isAllDay), timed = evIn.filter((e) => !isAllDay(e));
    const cls = (d) => `${dayKey(d) === dayKey(today) ? 'today' : ''} ${d.getDay() % 6 === 0 && days.length > 1 ? 'wkend' : ''}`;
    return `<div class="wk-head"><span></span>${days.map((d) => `<button class="wk-dh ${cls(d)}" data-day="${+d}" title="Open this day">${d.toLocaleDateString([], { weekday: days.length > 1 ? 'short' : 'long' })} <b>${d.getDate()}</b></button>`).join('')}</div>
      <div class="wk-allday"><span>all-day</span>${days.map((d) => `<div class="${cls(d)}">${allDay.filter((e) => onDay(e, d)).map((e) => `<button class="wk-chip" data-id="${st.events.indexOf(e)}" style="--c:${eventColor(e)}">${esc(e.title)}</button>`).join('')}</div>`).join('')}</div>
      <div class="wk-scroll" id="wk-scroll"><div class="wk-grid" style="height:${24 * HOUR}px">
        <div class="wk-hours">${[...Array(24)].map((_, h) => `<span style="top:${h * HOUR}px">${h === 0 ? '' : h === 12 ? 'Noon' : `${h % 12} ${h < 12 ? 'AM' : 'PM'}`}</span>`).join('')}</div>
        ${days.map((d) => {
          const evs = lanes(timed.filter((e) => onDay(e, d)));
          return `<div class="wk-col ${cls(d)}">${dayKey(d) === dayKey(today) ? `<div class="wk-now" style="top:${(now.getHours() * 60 + now.getMinutes()) * HOUR / 60}px"></div>` : ''}${evs.map((e) => {
            const s0 = Math.max(0, (new Date(e.start) - d) / 60000), en = Math.min(1440, (new Date(e.end) - d) / 60000);
            const h = Math.max(22, (en - s0) * HOUR / 60 - 3);
            const w = 100 / e._cols;
            const wide = days.length === 1;
            return `<button class="wk-ev ${new Date(e.end) < now ? 'past' : ''} ${h < 40 ? 'short' : ''} ${wide ? 'wide' : ''}" data-id="${st.events.indexOf(e)}" style="--c:${eventColor(e)};top:${s0 * HOUR / 60 + 1}px;height:${h}px;left:calc(${e._col * w}% + 3px);width:calc(${w}% - 6px)">
              <b>${esc(e.title)}</b>${e.recurring ? `<span class="wk-rep">${icon('repeat')}</span>` : ''}
              ${h >= 40 || wide ? `<small>${icon('clock')} ${fmtRange(e.start, e.end)}</small>` : ''}${(h >= 58 || wide) && e.location ? `<small>${icon('map-pin')} ${esc(e.location)}</small>` : ''}
              ${wide && h >= 76 && e.description ? `<small class="wk-desc">${esc(String(e.description).replace(/\\n/g, ' ').replace(/<[^>]+>/g, ' ').slice(0, 180))}</small>` : ''}
            </button>`;
          }).join('')}</div>`;
        }).join('')}
      </div></div>`;
  };
  const monthGrid = () => {
    const [a] = range();
    const days = [...Array(42)].map((_, i) => addDays(a, i));
    const sorted = st.events.slice().sort((x, y) => isAllDay(y) - isAllDay(x) || new Date(x.start) - new Date(y.start));
    return `<div class="mv-head">${days.slice(0, 7).map((d) => `<span>${d.toLocaleDateString([], { weekday: 'short' })}</span>`).join('')}</div>
      <div class="mv-grid">${days.map((d) => {
        const evs = sorted.filter((e) => onDay(e, d));
        const other = d.getMonth() !== st.date.getMonth();
        return `<div class="mv-day ${other ? 'other' : ''} ${dayKey(d) === dayKey(today) ? 'today' : ''} ${d.getDay() % 6 === 0 ? 'wkend' : ''}">
          <button class="mv-num" data-day="${+d}" title="Open this day">${d.getDate() === 1 ? MONTHS[d.getMonth()].slice(0, 3) + ' ' : ''}${d.getDate()}</button>
          ${evs.slice(0, 3).map((e) => `<button class="mv-ev ${isAllDay(e) ? 'allday' : ''}" data-id="${st.events.indexOf(e)}" style="--c:${eventColor(e)}">${isAllDay(e) ? '' : `<i>${fmtTime(e.start).replace(':00', '').replace(' ', '').toLowerCase()}</i>`}${esc(e.title)}</button>`).join('')}
          ${evs.length > 3 ? `<button class="mv-more" data-day="${+d}">+${evs.length - 3} more</button>` : ''}
        </div>`;
      }).join('')}</div>`;
  };
  const draw = () => {
    const [a] = range();
    const sources = [...new Map(st.events.map((e) => [calName(e), eventColor(e)])).entries()];
    const days = st.view === 'day' ? [midnight(st.date)] : [...Array(7)].map((_, i) => addDays(a, i));
    const unit = { day: 'day', week: 'week', month: 'month' }[st.view];
    host.innerHTML = `<div class="wk view-${st.view}" style="--cols:${days.length}">
      <div class="wk-top"><h2 class="wk-title">${title()}</h2>
        <div class="wk-legend">${sources.map(([n, c]) => `<span class="cal-src" style="--c:${c}"><i></i>${esc(n)}</span>`).join('')}</div>
        <div class="wk-nav">
          <div class="wk-views" role="tablist">${Object.entries(VIEWS).map(([k, v]) => `<button role="tab" class="${k === st.view ? 'on' : ''}" aria-selected="${k === st.view}" data-view="${k}">${v}</button>`).join('')}</div>
          <button class="mc-nav" data-step="-1" title="Previous ${unit}">${icon('chevron-left')}</button><button class="wk-today" data-step="0">Today</button><button class="mc-nav" data-step="1" title="Next ${unit}">${icon('chevron-right')}</button>
        </div></div>
      ${st.view === 'month' ? monthGrid() : timeGrid(days)}</div>`;
    host.querySelectorAll('[data-step]').forEach((b) => b.onclick = () => {
      const n = Number(b.dataset.step);
      if (!n) st.date = today;
      else if (st.view === 'day') st.date = addDays(st.date, n);
      else if (st.view === 'week') st.date = addDays(st.date, 7 * n);
      else st.date = new Date(st.date.getFullYear(), st.date.getMonth() + n, 1);
      scrolled = false; load();
    });
    host.querySelectorAll('[data-view]').forEach((b) => b.onclick = () => { st.view = b.dataset.view; lastView = st.view; try { localStorage.setItem('maestro.calView', st.view); } catch { /* storage blocked */ } scrolled = false; load(); });
    host.querySelectorAll('[data-day]').forEach((b) => b.onclick = () => { st.date = new Date(Number(b.dataset.day)); st.view = 'day'; scrolled = false; load(); });
    host.querySelectorAll('[data-id]').forEach((b) => b.onclick = () => openEvent(st.events[Number(b.dataset.id)], opts.ask, opts.createTask));
    const sc = host.querySelector('#wk-scroll');
    if (sc && !scrolled) { // open at 7 AM, or earlier if something starts before that
      const shown = st.events.filter((e) => !isAllDay(e) && days.some((d) => onDay(e, d)));
      const first = Math.min(7 * 60, ...shown.map((e) => { const x = new Date(e.start); return x.getHours() * 60 + x.getMinutes(); }));
      sc.scrollTop = Math.max(0, first * HOUR / 60 - 12);
      scrolled = st.events.length > 0;
    }
  };
  draw();
  load();
  return { reload: load };
}
