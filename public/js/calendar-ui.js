// Calendar views shared by the Intelligence Feed and the Calendar page:
// - monthCalendar: a month grid with month / year switching and the chosen day's events underneath.
// - weekCalendar: a week time-grid (all-day row, hours down the side, events placed by time).
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
export function openEvent(e, ask) {
  const when = e.allDay ? new Date(e.start).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) + ' · all day'
    : `${new Date(e.start).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })} · ${fmtTime(e.start)} – ${fmtTime(e.end)}`;
  const desc = String(e.description || (e.notes && !/^[\w -]+\/[\w .'&-]+$/.test(e.notes) ? e.notes : '')).replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/Created by Maestro/i, '').trim();
  modal(`${modalHead(esc(e.title), `<span class="cal-src" style="--c:${eventColor(e)}"><i></i>${esc(calName(e))}</span>`)}
    <div class="ev-detail">
      <div>${icon('clock')} ${esc(when)}${e.recurring ? ` <span class="tag">${icon('repeat')} repeats</span>` : ''}</div>
      ${e.location ? `<div>${icon('map-pin')} ${esc(e.location)}</div>` : ''}
      ${e.attendees && e.attendees.length ? `<div>${icon('users-round')} ${esc(e.attendees.join(', '))}</div>` : ''}
      ${desc ? `<p>${esc(desc).replace(/\n/g, '<br>')}</p>` : ''}
    </div>
    <div class="modal-foot">${e.notes && /\//.test(e.notes) && !desc ? `<button class="btn ghost" id="ev-note">${icon('file-text')} Prep notes</button>` : ''}<button class="btn ghost" data-close>Close</button>${ask ? `<button class="btn primary" id="ev-ask">${icon('sparkles')} Ask Maestro about it</button>` : ''}</div>`, {
    onMount: (m, close) => {
      const n = m.querySelector('#ev-note'); if (n) n.onclick = () => { close(); openNote(e.notes); };
      const a = m.querySelector('#ev-ask'); if (a) a.onclick = () => { close(); ask(`What is ${e.title} about?`); };
    },
  });
}

// ------------------------------------------------------------------ month
// opts: { filter(e) → bool, ask(text), title }
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
    host.innerHTML = `<div class="mc">
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
      </div></div>`;
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
export function weekCalendar(host, opts = {}) {
  const today = midnight(new Date());
  const st = { start: addDays(today, -today.getDay()), events: [] }; // weeks start on Sunday
  let scrolled = false;
  const load = async () => {
    try { st.events = await fetchRange(st.start, addDays(st.start, 7), opts.filter); } catch { st.events = []; }
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
  const draw = () => {
    const days = [...Array(7)].map((_, i) => addDays(st.start, i));
    const end = addDays(st.start, 7);
    const allDay = st.events.filter((e) => e.allDay || new Date(e.end) - new Date(e.start) >= 86400000);
    const timed = st.events.filter((e) => !allDay.includes(e));
    const sameMonth = days[0].getMonth() === days[6].getMonth();
    const title = sameMonth ? `<b>${MONTHS[days[0].getMonth()]}</b> ${days[0].getFullYear()}` : `<b>${MONTHS[days[0].getMonth()].slice(0, 3)} – ${MONTHS[days[6].getMonth()].slice(0, 3)}</b> ${days[6].getFullYear()}`;
    const sources = [...new Map(st.events.map((e) => [calName(e), eventColor(e)])).entries()];
    const now = new Date();
    host.innerHTML = `<div class="wk">
      <div class="wk-top"><h2 class="wk-title">${title}</h2>
        <div class="wk-legend">${sources.map(([n, c]) => `<span class="cal-src" style="--c:${c}"><i></i>${esc(n)}</span>`).join('')}</div>
        <div class="wk-nav"><button class="mc-nav" data-step="-7" title="Previous week">${icon('chevron-left')}</button><button class="wk-today" data-step="0">Today</button><button class="mc-nav" data-step="7" title="Next week">${icon('chevron-right')}</button></div></div>
      <div class="wk-head"><span></span>${days.map((d) => `<div class="wk-dh ${dayKey(d) === dayKey(today) ? 'today' : ''} ${d.getDay() % 6 === 0 ? 'wkend' : ''}">${d.toLocaleDateString([], { weekday: 'short' })} <b>${d.getDate()}</b></div>`).join('')}</div>
      <div class="wk-allday"><span>all-day</span>${days.map((d) => `<div class="${d.getDay() % 6 === 0 ? 'wkend' : ''}">${allDay.filter((e) => midnight(e.start) <= d && new Date(e.end) > d).map((e) => `<button class="wk-chip" data-id="${st.events.indexOf(e)}" style="--c:${eventColor(e)}">${esc(e.title)}</button>`).join('')}</div>`).join('')}</div>
      <div class="wk-scroll" id="wk-scroll"><div class="wk-grid" style="height:${24 * HOUR}px">
        <div class="wk-hours">${[...Array(24)].map((_, h) => `<span style="top:${h * HOUR}px">${h === 0 ? '' : h === 12 ? 'Noon' : `${h % 12} ${h < 12 ? 'AM' : 'PM'}`}</span>`).join('')}</div>
        ${days.map((d) => {
          const evs = lanes(timed.filter((e) => new Date(e.start) < addDays(d, 1) && new Date(e.end) > d));
          const isToday = dayKey(d) === dayKey(today);
          return `<div class="wk-col ${d.getDay() % 6 === 0 ? 'wkend' : ''}">${isToday ? `<div class="wk-now" style="top:${(now.getHours() * 60 + now.getMinutes()) * HOUR / 60}px"></div>` : ''}${evs.map((e) => {
            const s = Math.max(0, (new Date(e.start) - d) / 60000), en = Math.min(1440, (new Date(e.end) - d) / 60000);
            const h = Math.max(22, (en - s) * HOUR / 60 - 3);
            const w = 100 / e._cols;
            return `<button class="wk-ev ${new Date(e.end) < now ? 'past' : ''} ${h < 40 ? 'short' : ''}" data-id="${st.events.indexOf(e)}" style="--c:${eventColor(e)};top:${s * HOUR / 60 + 1}px;height:${h}px;left:calc(${e._col * w}% + 3px);width:calc(${w}% - 6px)">
              <b>${esc(e.title)}</b>${e.recurring ? `<span class="wk-rep">${icon('repeat')}</span>` : ''}
              ${h >= 40 ? `<small>${icon('clock')} ${fmtRange(e.start, e.end)}</small>` : ''}${h >= 58 && e.location ? `<small>${icon('map-pin')} ${esc(e.location)}</small>` : ''}
            </button>`;
          }).join('')}</div>`;
        }).join('')}
      </div></div></div>`;
    host.querySelectorAll('[data-step]').forEach((b) => b.onclick = () => { const n = Number(b.dataset.step); st.start = n ? addDays(st.start, n) : addDays(today, -today.getDay()); load(); });
    host.querySelectorAll('[data-id]').forEach((b) => b.onclick = () => openEvent(st.events[Number(b.dataset.id)], opts.ask));
    const sc = host.querySelector('#wk-scroll');
    if (!scrolled) { // open at 7 AM, or earlier if something starts before that
      const first = Math.min(7 * 60, ...timed.map((e) => { const x = new Date(e.start); return x.getHours() * 60 + x.getMinutes(); }));
      sc.scrollTop = Math.max(0, first * HOUR / 60 - 12);
      scrolled = st.events.length > 0;
    }
    void end;
  };
  draw();
  load();
  return { reload: load };
}
