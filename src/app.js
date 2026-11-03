import { extractFlights, mergeFlights, upcomingFlights, AIRLINES, htmlToText } from './parser.js?v=202611031634';
import { DEFAULT_QUERY, OLD_DEFAULT_QUERIES, listMessageIds, getMessages } from './gmail.js?v=202611031634';
import { sampleMessages } from './samples.js?v=202611031634';
import { buildEvent, eventHash, upsertEvent, deleteEvent, zonedToUtc } from './calendar.js?v=202611031634';
import { AIRPORT_TZ, CITIES } from './airports.js?v=202611031634';

const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const $ = (sel) => document.querySelector(sel);

const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

let allFlights = [];
let accessToken = null;
let calendarToken = null; // { token, expires }
let calendarBusy = false;
const openKeys = new Set(); // flights whose details are expanded

function clientId() {
  return store.get('clientId', '') || window.FLIGHT_UPDATE_CONFIG?.googleClientId || '';
}

function setStatus(msg, kind = '') {
  const el = $('#status');
  el.textContent = msg;
  el.className = `status ${kind}`;
  el.hidden = !msg;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const flightKey = (f) => `${f.flightNumber}|${f.date}`;
const isDemo = (f) => f.emails.every((e) => e.id.startsWith('demo-'));

function synced() {
  try { return JSON.parse(store.get('calendarSynced', '') || '{}'); } catch { return {}; }
}
function saveSynced(map) { store.set('calendarSynced', JSON.stringify(map)); }

// What, if anything, needs to happen in Google Calendar for this flight.
// Calendar events this app created for upcoming flights that the latest scan no longer finds
// (e.g. an advert or refund email was read as a booking before). Only after a real Gmail scan.
function orphanEvents(map = synced()) {
  if (!allFlights.length || allFlights.every(isDemo)) return [];
  const known = new Set(allFlights.map(flightKey));
  return Object.keys(map).filter((key) => !known.has(key) && daysUntil(key.split('|')[1] || '') >= 0);
}

function calendarState(f, map = synced()) {
  if (isDemo(f)) return 'demo';
  const entry = map[flightKey(f)];
  if (f.cancelled) return entry ? 'remove' : 'none';
  if (daysUntil(f.date) < 0) return entry ? 'synced' : 'none';
  if (!entry) return 'add';
  return entry.hash === eventHash(buildEvent(f)) ? 'synced' : 'update';
}

const DEFAULT_AGENT_URL = 'http://localhost:8787';

function checkinLink(f) {
  if (f.cancelled || daysUntil(f.date) < 0) return '';
  const data = {
    flightNumber: f.flightNumber, airline: f.airline, from: f.from, to: f.to, fromName: f.fromName, toName: f.toName,
    date: f.date, departureTime: f.departureTime, departureIso: f.departureIso, confirmation: f.confirmation, passenger: f.passenger,
  };
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(data)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const base = (store.get('agentUrl', '') || DEFAULT_AGENT_URL).replace(/\/+$/, '');
  return `<a class="chip action" href="${escapeHtml(base)}/#flight=${b64}" target="_blank" rel="noopener" title="Opens the check-in agent running on your computer">🛂 Web check-in</a>`;
}

const CAL_ADD = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4M12 13v5M9.5 15.5h5"/></svg>';
const CAL_OK = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4M9 15l2 2 4-4"/></svg>';
const CAL_DEL = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4M9.5 15.5h5"/></svg>';

// Small round calendar button shown on every flight row.
function calendarIcon(f, map) {
  const state = calendarState(f, map);
  const key = escapeHtml(flightKey(f));
  const entry = map[flightKey(f)];
  switch (state) {
    case 'demo':
    case 'add': return `<button class="cal-btn" data-cal="${key}" title="Add to Google Calendar" aria-label="Add ${escapeHtml(f.flightNumber)} to Google Calendar">${CAL_ADD}</button>`;
    case 'update': return `<button class="cal-btn update" data-cal="${key}" title="Flight details changed: update in Google Calendar" aria-label="Update ${escapeHtml(f.flightNumber)} in Google Calendar">${CAL_ADD}</button>`;
    case 'remove': return `<button class="cal-btn remove" data-cal="${key}" title="Cancelled: remove from Google Calendar" aria-label="Remove ${escapeHtml(f.flightNumber)} from Google Calendar">${CAL_DEL}</button>`;
    case 'synced': return entry?.link
      ? `<a class="cal-btn synced" href="${escapeHtml(entry.link)}" target="_blank" rel="noopener" title="In Google Calendar (open event)" aria-label="Open ${escapeHtml(f.flightNumber)} in Google Calendar">${CAL_OK}</a>`
      : `<span class="cal-btn synced" title="In Google Calendar">${CAL_OK}</span>`;
    default: return '';
  }
}

// Airline logo from public logo services; falls back to a coloured code badge (see the error handler in init).
const LOGO_SOURCES = [
  (c) => `https://pics.avs.io/64/64/${c}@2x.png`,
  (c) => `https://images.kiwi.com/airlines/64/${c}.png`,
];
function airlineLogo(code, airline) {
  if (!/^[A-Z0-9]{2}$/.test(code)) return airlineBadge(code, airline);
  return `<span class="logo" title="${escapeHtml(airline || code)}"><img src="${LOGO_SOURCES[0](code)}" data-code="${code}" data-step="0" alt="${escapeHtml(airline || code)}" loading="lazy" referrerpolicy="no-referrer"></span>`;
}
function airlineBadge(code, airline) {
  return `<span class="badge" style="--h:${airlineHue(code)}" title="${escapeHtml(airline || code)}">${escapeHtml(code)}</span>`;
}

function calendarControl(f, map) {
  const state = calendarState(f, map);
  const key = escapeHtml(flightKey(f));
  const entry = map[flightKey(f)];
  switch (state) {
    case 'demo':
    case 'add': return `<button class="cal" data-cal="${key}">📅 Add to Google Calendar</button>`;
    case 'update': return `<button class="cal" data-cal="${key}">📅 Update in Calendar</button>`;
    case 'remove': return `<button class="cal" data-cal="${key}">Remove from Calendar</button>`;
    case 'synced': return entry?.link
      ? `<a class="chip ok" href="${escapeHtml(entry.link)}" target="_blank" rel="noopener">✓ In Calendar</a>`
      : '<span class="chip ok">✓ In Calendar</span>';
    default: return '';
  }
}

function daysUntil(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86400000);
}

function formatDate(dateStr, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (y !== new Date().getFullYear()) opts = { ...opts, year: 'numeric' };
  return date.toLocaleDateString(undefined, opts);
}

function formatClock(hhmm) {
  if (!hhmm) return '--:--';
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// Departure moment in UTC ms (null if no time is known).
function departureMs(f) {
  if (f.departureIso && /(Z|[+-]\d{2}:?\d{2})$/.test(f.departureIso)) return Date.parse(f.departureIso);
  if (!f.departureTime) return null;
  const tz = AIRPORT_TZ[f.from];
  if (tz) return zonedToUtc(f.date, f.departureTime, tz);
  const [y, m, d] = f.date.split('-').map(Number);
  const [h, mi] = f.departureTime.split(':').map(Number);
  return new Date(y, m - 1, d, h, mi).getTime();
}

// Big number + caption on the left of each row ("7 / DAYS", "3h / 8 MINUTES").
function countdown(f) {
  if (f.cancelled) return { big: '–', unit: 'Cancelled' };
  const dep = departureMs(f);
  const days = daysUntil(f.date);
  if (dep != null) {
    const mins = Math.round((dep - Date.now()) / 60000);
    if (mins < 0 && mins > -24 * 60) return { big: `${Math.floor(-mins / 60) || -mins}${-mins >= 60 ? 'h' : ''}`, unit: -mins >= 60 ? 'ago' : 'min ago', word: false };
    if (mins >= 0 && mins < 60) return { big: String(mins), unit: mins === 1 ? 'Minute' : 'Minutes', soon: true };
    if (mins >= 60 && mins < 24 * 60) {
      const m = mins % 60;
      return { big: `${Math.floor(mins / 60)}h`, unit: `<b>${m}</b> ${m === 1 ? 'Minute' : 'Minutes'}`, soon: true };
    }
  }
  if (days === 0) return { big: 'Today', unit: '', word: true, soon: true };
  if (days < 0) return { big: String(-days), unit: -days === 1 ? 'Day ago' : 'Days ago' };
  return { big: String(days), unit: days === 1 ? 'Day' : 'Days' };
}

function rightLabel(f, cd) {
  if (f.cancelled) return { text: 'Cancelled', cls: 'bad' };
  const days = daysUntil(f.date);
  if (cd.soon && f.departureTime) return { text: `Departs ${days === 0 ? 'today' : 'tomorrow'}`, cls: 'soon' };
  if (days < 0) return { text: formatDate(f.date), cls: 'done' };
  return { text: formatDate(f.date), cls: '' };
}

function cityOf(code, name) {
  return CITIES[code] || (name ? name.split(/\s+(?:International|Intl|Airport|Chhatrapati|Indira|Kempegowda)\b/)[0] : code);
}

function airlineHue(code) {
  let h = 0;
  for (const c of code) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

function arrivalDayOffset(f) {
  if (f.arrivalDate && f.arrivalDate !== f.date) return Math.round((Date.parse(f.arrivalDate) - Date.parse(f.date)) / 86400000);
  if (!f.arrivalDate && f.arrivalTime && f.departureTime && f.arrivalTime < f.departureTime) return 1;
  return 0;
}

const ICON_DEP = '<svg viewBox="0 0 12 12"><path d="M3.5 8.5l5-5M4.5 3.5h4v4"/></svg>';
const ICON_ARR = '<svg viewBox="0 0 12 12"><path d="M3.5 3.5l5 5M8.5 4.5v4h-4"/></svg>';

function gmailLink(id) {
  return id.startsWith('demo-') ? null : `https://mail.google.com/mail/u/0/#all/${id}`;
}

function render() {
  const showPast = $('#show-past').checked;
  const showCancelled = $('#show-cancelled').checked;
  let list = showPast
    ? [...allFlights].filter((f) => daysUntil(f.date) < 0).sort((a, b) => `${b.date}${b.departureTime}`.localeCompare(`${a.date}${a.departureTime}`))
    : upcomingFlights(allFlights, new Date(), { includeCancelled: true });
  if (!showCancelled) list = list.filter((f) => !f.cancelled);

  const container = $('#flights');
  const map = synced();
  const orphans = orphanEvents(map);
  const pending = [...allFlights.filter((f) => ['add', 'update', 'remove'].includes(calendarState(f, map))), ...orphans];
  const syncable = allFlights.filter((f) => !['none', 'demo'].includes(calendarState(f, map)) || (isDemo(f) && daysUntil(f.date) >= 0 && !f.cancelled));
  $('#cal-all').hidden = syncable.length === 0 && !orphans.length;
  $('#cal-all').disabled = calendarBusy;
  $('#cal-count').hidden = pending.length === 0;
  $('#cal-count').textContent = String(pending.length);
  const calTitle = orphans.length
    ? `Update Google Calendar (${orphans.length} event${orphans.length === 1 ? '' : 's'} to remove for flights no longer found)`
    : pending.length
    ? `Sync ${pending.length} flight${pending.length === 1 ? '' : 's'} to Google Calendar`
    : 'All flights are in Google Calendar';
  $('#cal-all').title = calTitle;
  $('#cal-all').setAttribute('aria-label', calTitle);
  $('#toolbar').hidden = allFlights.length === 0;
  $('#welcome').hidden = allFlights.length > 0 || !!accessToken;

  const upcomingCount = upcomingFlights(allFlights).length;
  $('#summary').textContent = allFlights.length ? `${upcomingCount} upcoming` : '';

  if (!list.length) {
    container.innerHTML = allFlights.length
      ? `<p class="empty">${showPast ? 'No past flights found.' : 'No upcoming flights. Tap “Past” to see earlier trips.'}</p>`
      : '';
    return;
  }

  container.innerHTML = list.map((f) => {
    const key = flightKey(f);
    const cd = countdown(f);
    const label = rightLabel(f, cd);
    const code = f.flightNumber.slice(0, 2);
    const airline = f.airline || AIRLINES[code] || '';
    const email = f.emails[f.emails.length - 1];
    const link = gmailLink(email.id);
    const plus = arrivalDayOffset(f);
    const fromCity = cityOf(f.from, f.fromName);
    const toCity = cityOf(f.to, f.toName);
    const fact = (k, v) => (v ? `<div class="fact"><div class="k">${k}</div><div class="v" title="${escapeHtml(v)}">${escapeHtml(v)}</div></div>` : '');
    const classes = ['flight', f.cancelled && 'cancelled', daysUntil(f.date) < 0 && 'past', cd.soon && !f.cancelled && 'soon', openKeys.has(key) && 'open'].filter(Boolean).join(' ');
    return `
      <article class="${classes}" data-key="${escapeHtml(key)}" tabindex="0" aria-expanded="${openKeys.has(key)}"
        aria-label="${escapeHtml(`${f.flightNumber}, ${fromCity} to ${toCity}, ${formatDate(f.date)}`)}">
        <div class="count"><div class="big${cd.word ? ' word' : ''}">${escapeHtml(cd.big)}</div><div class="unit">${cd.unit}</div></div>
        <div class="body">
          <div class="meta">
            ${airlineLogo(code, airline)}
            <span class="fno">${escapeHtml(`${code} ${f.flightNumber.slice(2)}`)}</span>
            <span class="when ${label.cls}">${escapeHtml(label.text)}</span>
            ${calendarIcon(f, map)}
          </div>
          <div class="cities"><b>${escapeHtml(fromCity)}</b> <span class="to">to</span> <b>${escapeHtml(toCity)}</b></div>
          <div class="times">
            <span class="t"><i class="ic" aria-label="Departs">${ICON_DEP}</i><span class="code">${escapeHtml(f.from)}</span><span class="clock">${escapeHtml(formatClock(f.departureTime))}</span></span>
            <span class="t"><i class="ic" aria-label="Arrives">${ICON_ARR}</i><span class="code">${escapeHtml(f.to)}</span><span class="clock">${escapeHtml(formatClock(f.arrivalTime))}</span>${plus ? `<sup>+${plus}</sup>` : ''}</span>
          </div>
          <div class="details">
            <div class="facts">
              ${fact('Airline', airline)}
              ${fact('Booking ref', f.confirmation)}
              ${fact('Passenger', f.passenger)}
              ${fact('Seat', f.seat)}
              ${fact('Date', formatDate(f.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))}
            </div>
            <div class="actions">
              ${calendarControl(f, map)}
              ${checkinLink(f)}
            </div>
            <div class="src">✉️ ${link ? `<a href="${link}" target="_blank" rel="noopener">` : ''}${escapeHtml(email.subject || '(no subject)')}${link ? '</a>' : ''}</div>
            ${f.source === 'text' ? '<div class="note">Read from the email text rather than structured booking data, so double-check the details.</div>' : ''}
          </div>
        </div>
      </article>`;
  }).join('');
}

// Emails from the last scan where no flight was found (kept in memory only, for the Settings panel).
let skipped = [];

function renderSkipped() {
  const box = $('#skipped');
  if (!skipped.length) { box.hidden = true; return; }
  box.hidden = false;
  box.querySelector('summary').textContent = `Emails with no flights found (${skipped.length})`;
  box.querySelector('ul').innerHTML = skipped.map((m, i) => `
    <li>
      <div class="sk-subj">${escapeHtml(m.subject || '(no subject)')}</div>
      <div class="sk-from">${escapeHtml(m.from)}</div>
      <div class="row">
        ${m.id.startsWith('demo-') ? '' : `<a href="https://mail.google.com/mail/u/0/#all/${escapeHtml(m.id)}" target="_blank" rel="noopener">Open in Gmail</a>`}
        <button type="button" class="link" data-copy="${i}">Copy email text</button>
      </div>
    </li>`).join('');
}

function processMessages(messages) {
  skipped = [];
  const flights = messages.flatMap((m) => {
    let found = [];
    try { found = extractFlights(m); } catch (e) { console.warn('Parse failed', m.id, e); }
    if (!found.length) skipped.push({ id: m.id, subject: m.subject, from: m.from, body: (m.text && m.text.trim()) || htmlToText(m.html || '') });
    return found;
  });
  renderSkipped();
  allFlights = mergeFlights(flights);
  store.set('lastResults', JSON.stringify({ at: Date.now(), flights: allFlights }));
  const orphans = orphanEvents();
  if (orphans.length) {
    setTimeout(() => setStatus(`${orphans.length} calendar event${orphans.length === 1 ? ' is' : 's are'} for flights no longer found in your email. Tap the calendar button at the top to remove ${orphans.length === 1 ? 'it' : 'them'}.`, 'warn'), 0);
  }
  render();
}

async function scan() {
  const query = store.get('query', DEFAULT_QUERY);
  const max = Number(store.get('maxEmails', '300'));
  $('#scan').disabled = true;
  try {
    setStatus('Searching your Gmail for flight emails…');
    const ids = await listMessageIds(accessToken, query, max);
    if (!ids.length) {
      setStatus('No matching emails found. Try widening the search in Settings.', 'warn');
      processMessages([]);
      return;
    }
    const messages = await getMessages(accessToken, ids, (done, total) => setStatus(`Reading emails… ${done}/${total}`));
    processMessages(messages);
    setStatus(`Scanned ${messages.length} emails.`, 'ok');
  } catch (e) {
    console.error(e);
    if (e.status === 401) {
      accessToken = null;
      updateAuthUi();
      setStatus('Your Google session expired. Please sign in again.', 'error');
    } else {
      setStatus(e.message, 'error');
    }
  } finally {
    $('#scan').disabled = false;
  }
}

function updateAuthUi() {
  $('#signout').hidden = !accessToken;
  const btn = $('#scan');
  btn.title = accessToken ? 'Rescan Gmail for flights' : 'Sign in with Gmail';
  btn.setAttribute('aria-label', btn.title);
  $('#welcome').hidden = allFlights.length > 0 || !!accessToken;
}

function toggleSettings(open = !$('#settings').open) {
  $('#settings').open = open;
  $('#settings-btn').setAttribute('aria-expanded', String(open));
}

// Ask Google for an access token with the given scope. Must be called from a click handler (opens a popup).
function requestToken(scope) {
  return new Promise((resolve, reject) => {
    if (!clientId()) {
      toggleSettings(true);
      $('#client-id').focus();
      return reject(new Error('First add your Google OAuth client ID in Settings (see the README for the 5-minute setup).'));
    }
    if (!window.google?.accounts?.oauth2) return reject(new Error('Google sign-in is still loading. Try again in a moment.'));
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId(),
      scope,
      callback: (resp) => {
        if (resp.error) return reject(new Error(`Sign-in failed: ${resp.error}`));
        if (!google.accounts.oauth2.hasGrantedAllScopes(resp, scope)) {
          return reject(new Error('Permission was not granted. Please allow access when Google asks.'));
        }
        resolve({ token: resp.access_token, expires: Date.now() + (Number(resp.expires_in) || 3600) * 1000 - 60000 });
      },
      error_callback: (err) => reject(new Error(`Sign-in was not completed (${err.type}).`)),
    });
    client.requestAccessToken({ prompt: '' });
  });
}

function signIn() {
  requestToken(GMAIL_SCOPE).then(
    ({ token }) => { accessToken = token; updateAuthUi(); scan(); },
    (e) => setStatus(e.message, 'warn'),
  );
}

function getCalendarToken() {
  if (calendarToken && calendarToken.expires > Date.now()) return Promise.resolve(calendarToken.token);
  return requestToken(CALENDAR_SCOPE).then((t) => { calendarToken = t; return t.token; });
}

// Add/update/remove the given flights in Google Calendar.
async function syncToCalendar(flights, orphanKeys = []) {
  if (calendarBusy) return;
  const real = flights.filter((f) => !isDemo(f));
  if (!real.length && !orphanKeys.length) return setStatus('Demo flights can’t be added to your calendar. Sign in with Google to use your real flights.', 'warn');
  calendarBusy = true;
  document.querySelectorAll('button.cal, button.cal-btn, #cal-all').forEach((b) => { b.disabled = true; });
  const tokenPromise = getCalendarToken(); // start the popup synchronously, inside the click
  let ok = 0;
  const failed = [];
  try {
    const token = await tokenPromise;
    const map = synced();
    for (const f of real) {
      const key = flightKey(f);
      setStatus(`Updating Google Calendar… ${ok + failed.length + 1}/${real.length}`);
      try {
        if (f.cancelled) {
          if (map[key]) await deleteEvent(token, map[key].id);
          delete map[key];
        } else {
          const event = buildEvent(f);
          const saved = await upsertEvent(token, event);
          map[key] = { id: event.id, hash: eventHash(event), link: saved?.htmlLink || null };
        }
        ok++;
        saveSynced(map);
      } catch (e) {
        if (e.status === 401) { calendarToken = null; throw new Error('Google Calendar session expired. Please try again.'); }
        if (e.status === 403 && /has not been used|disabled/i.test(e.message)) {
          throw new Error('The Google Calendar API is not enabled for your Google Cloud project. Enable it (see README) and try again.');
        }
        failed.push(`${f.flightNumber}: ${e.message}`);
      }
    }
    for (const key of orphanKeys) {
      try {
        if (map[key]) await deleteEvent(token, map[key].id);
        delete map[key];
        saveSynced(map);
        ok++;
      } catch (e) {
        failed.push(`${key.split('|')[0]}: ${e.message}`);
      }
    }
    if (failed.length) setStatus(`Calendar updated for ${ok} flight(s). Failed: ${failed.join('; ')}`, 'error');
    else setStatus(`✓ Google Calendar updated for ${ok} flight${ok === 1 ? '' : 's'}.`, 'ok');
  } catch (e) {
    setStatus(e.message, 'error');
  } finally {
    calendarBusy = false;
    render();
  }
}

function signOut() {
  if (accessToken) google.accounts.oauth2.revoke(accessToken, () => {});
  if (calendarToken) google.accounts.oauth2.revoke(calendarToken.token, () => {});
  accessToken = null;
  calendarToken = null;
  allFlights = [];
  store.set('lastResults', '');
  updateAuthUi();
  render();
  setStatus('Signed out. Cached results cleared.');
}

function init() {
  $('#client-id').value = clientId();
  if (OLD_DEFAULT_QUERIES.includes(store.get('query', ''))) store.set('query', DEFAULT_QUERY);
  $('#app-version').textContent = document.querySelector('meta[name=app-version]')?.content || 'dev';
  $('#hard-reload').addEventListener('click', (e) => {
    e.preventDefault();
    location.replace(`${location.pathname}?reload=${Date.now()}`);
  });
  $('#query').value = store.get('query', DEFAULT_QUERY);
  $('#skipped').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-copy]');
    if (!btn) return;
    const m = skipped[Number(btn.dataset.copy)];
    const text = `Subject: ${m.subject}\nFrom: ${m.from}\n\n${m.body}`.slice(0, 20000);
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = 'Copied ✓';
    } catch {
      window.prompt('Copy this text:', text.slice(0, 2000));
    }
  });
  $('#max-emails').value = store.get('maxEmails', '300');
  $('#agent-url').value = store.get('agentUrl', '') || DEFAULT_AGENT_URL;
  $('#origin').textContent = location.origin;

  $('#save-settings').addEventListener('click', () => {
    store.set('clientId', $('#client-id').value.trim());
    store.set('query', $('#query').value.trim() || DEFAULT_QUERY);
    store.set('maxEmails', String(Math.max(10, Math.min(2000, Number($('#max-emails').value) || 300))));
    store.set('agentUrl', $('#agent-url').value.trim() || DEFAULT_AGENT_URL);
    render();
    toggleSettings(false);
    setStatus('Settings saved.', 'ok');
  });
  $('#reset-query').addEventListener('click', () => { $('#query').value = DEFAULT_QUERY; });
  $('#signin').addEventListener('click', signIn);
  $('#signout').addEventListener('click', signOut);
  $('#scan').addEventListener('click', () => (accessToken ? scan() : signIn()));
  $('#settings-btn').addEventListener('click', () => toggleSettings());
  $('#demo-2').addEventListener('click', () => { toggleSettings(false); $('#demo').click(); });
  $('#demo').addEventListener('click', () => {
    processMessages(sampleMessages());
    setStatus('Showing demo data. Sign in with Google to see your real flights.', 'ok');
  });
  $('#cal-all').addEventListener('click', () => {
    const map = synced();
    const todo = allFlights.filter((f) => ['add', 'update', 'remove', 'demo'].includes(calendarState(f, map)) && !(isDemo(f) && (f.cancelled || daysUntil(f.date) < 0)));
    let orphans = orphanEvents(map);
    if (orphans.length) {
      const list = orphans.map((k) => { const [fn, d] = k.split('|'); return `• ${fn} on ${formatDate(d)}`; }).join('\n');
      const ok = window.confirm(`These flights are in your Google Calendar but no booking for them was found in your email any more (for example, an advert or a refunded booking):\n\n${list}\n\nRemove them from your calendar?`);
      if (!ok) orphans = [];
    }
    if (!todo.length && !orphans.length) return setStatus('✓ All your upcoming flights are already in Google Calendar.', 'ok');
    syncToCalendar(todo, orphans);
  });
  // Logo didn't load: try the next source, then fall back to the code badge.
  $('#flights').addEventListener('error', (ev) => {
    const img = ev.target;
    if (!(img instanceof HTMLImageElement) || !img.dataset.code) return;
    const next = Number(img.dataset.step) + 1;
    if (LOGO_SOURCES[next]) {
      img.dataset.step = String(next);
      img.src = LOGO_SOURCES[next](img.dataset.code);
    } else {
      img.parentElement.outerHTML = airlineBadge(img.dataset.code, img.alt);
    }
  }, true);
  const toggleRow = (row) => {
    const key = row.dataset.key;
    if (openKeys.has(key)) openKeys.delete(key); else openKeys.add(key);
    row.classList.toggle('open', openKeys.has(key));
    row.setAttribute('aria-expanded', String(openKeys.has(key)));
  };
  $('#flights').addEventListener('keydown', (ev) => {
    const row = ev.target.closest?.('article.flight');
    if (row && ev.target === row && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); toggleRow(row); }
  });
  $('#flights').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-cal]');
    if (!btn) {
      const row = ev.target.closest('article.flight');
      if (row && !ev.target.closest('a, button, .details')) toggleRow(row);
      return;
    }
    const f = allFlights.find((x) => flightKey(x) === btn.dataset.cal);
    if (f) syncToCalendar([f]);
  });
  $('#show-past').addEventListener('change', render);
  $('#show-cancelled').addEventListener('change', render);

  try {
    const cached = JSON.parse(store.get('lastResults', '') || 'null');
    if (cached?.flights?.length) {
      allFlights = cached.flights;
      render();
      setStatus(`Showing results from your last scan (${new Date(cached.at).toLocaleString()}). Sign in to refresh.`);
    }
  } catch { /* ignore */ }

  updateAuthUi();
  render();
  setInterval(render, 30000); // keep countdowns fresh
}

init();
