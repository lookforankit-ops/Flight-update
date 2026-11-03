import { extractFlights, mergeFlights, upcomingFlights, AIRLINES } from './parser.js';
import { DEFAULT_QUERY, listMessageIds, getMessages } from './gmail.js';
import { sampleMessages } from './samples.js';
import { buildEvent, eventHash, upsertEvent, deleteEvent } from './calendar.js';

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
function calendarState(f, map = synced()) {
  if (isDemo(f)) return 'demo';
  const entry = map[flightKey(f)];
  if (f.cancelled) return entry ? 'remove' : 'none';
  if (daysUntil(f.date) < 0) return entry ? 'synced' : 'none';
  if (!entry) return 'add';
  return entry.hash === eventHash(buildEvent(f)) ? 'synced' : 'update';
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

function relative(days) {
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 0) return `${-days} days ago`;
  if (days < 14) return `In ${days} days`;
  if (days < 60) return `In ${Math.round(days / 7)} weeks`;
  return `In ${Math.round(days / 30)} months`;
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function gmailLink(id) {
  return id.startsWith('demo-') ? null : `https://mail.google.com/mail/u/0/#all/${id}`;
}

function render() {
  const showPast = $('#show-past').checked;
  const showCancelled = $('#show-cancelled').checked;
  let list = showPast
    ? [...allFlights].sort((a, b) => `${a.date}${a.departureTime}`.localeCompare(`${b.date}${b.departureTime}`))
    : upcomingFlights(allFlights, new Date(), { includeCancelled: true });
  if (!showCancelled) list = list.filter((f) => !f.cancelled);

  const container = $('#flights');
  const map = synced();
  const pending = allFlights.filter((f) => ['add', 'update', 'remove'].includes(calendarState(f, map)));
  $('#cal-all').hidden = pending.length === 0;
  $('#cal-all').disabled = calendarBusy;
  $('#cal-all').textContent = `📅 Sync ${pending.length} flight${pending.length === 1 ? '' : 's'} to Google Calendar`;

  const upcomingCount = upcomingFlights(allFlights).length;
  $('#summary').textContent = allFlights.length
    ? `${upcomingCount} upcoming flight${upcomingCount === 1 ? '' : 's'} · ${allFlights.length} found in total`
    : '';

  if (!list.length) {
    container.innerHTML = allFlights.length
      ? '<p class="empty">No upcoming flights found. Toggle “Show past flights” to see older trips.</p>'
      : '';
    return;
  }

  container.innerHTML = list.map((f) => {
    const days = daysUntil(f.date);
    const airline = f.airline || AIRLINES[f.flightNumber.slice(0, 2)] || '';
    const email = f.emails[f.emails.length - 1];
    const link = gmailLink(email.id);
    const arrivalNote = f.arrivalDate && f.arrivalDate !== f.date ? ` <span class="plus">+${daysUntil(f.arrivalDate) - days}</span>` : '';
    return `
      <article class="card ${f.cancelled ? 'cancelled' : ''} ${days < 0 ? 'past' : ''}">
        <header>
          <div>
            <div class="date">${escapeHtml(formatDate(f.date))}</div>
            <div class="when">${f.cancelled ? 'Cancelled' : relative(days)}</div>
          </div>
          <div class="flightno">
            <strong>${escapeHtml(f.flightNumber)}</strong>
            <span>${escapeHtml(airline)}</span>
          </div>
        </header>
        <div class="route">
          <div class="end">
            <div class="code">${escapeHtml(f.from)}</div>
            <div class="time">${escapeHtml(f.departureTime || '--:--')}</div>
            <div class="name">${escapeHtml(f.fromName || '')}</div>
          </div>
          <div class="line" aria-hidden="true"><span>✈</span></div>
          <div class="end right">
            <div class="code">${escapeHtml(f.to)}</div>
            <div class="time">${escapeHtml(f.arrivalTime || '--:--')}${arrivalNote}</div>
            <div class="name">${escapeHtml(f.toName || '')}</div>
          </div>
        </div>
        <footer>
          ${f.confirmation ? `<span class="chip">Ref <b>${escapeHtml(f.confirmation)}</b></span>` : ''}
          ${f.passenger ? `<span class="chip">${escapeHtml(f.passenger)}</span>` : ''}
          ${f.seat ? `<span class="chip">Seat ${escapeHtml(f.seat)}</span>` : ''}
          ${calendarControl(f, map)}
          ${f.source === 'text' ? '<span class="chip muted" title="Read from the email text rather than structured booking data, so double-check the details.">Read from email text</span>' : ''}
          <span class="src">${link ? `<a href="${link}" target="_blank" rel="noopener">` : ''}${escapeHtml(email.subject || '(no subject)')}${link ? '</a>' : ''}</span>
        </footer>
      </article>`;
  }).join('');
}

function processMessages(messages) {
  const flights = messages.flatMap((m) => {
    try { return extractFlights(m); } catch (e) { console.warn('Parse failed', m.id, e); return []; }
  });
  allFlights = mergeFlights(flights);
  store.set('lastResults', JSON.stringify({ at: Date.now(), flights: allFlights }));
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
  $('#signin').hidden = !!accessToken;
  $('#scan').hidden = !accessToken;
  $('#signout').hidden = !accessToken;
}

// Ask Google for an access token with the given scope. Must be called from a click handler (opens a popup).
function requestToken(scope) {
  return new Promise((resolve, reject) => {
    if (!clientId()) {
      $('#settings').open = true;
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
async function syncToCalendar(flights) {
  if (calendarBusy) return;
  const real = flights.filter((f) => !isDemo(f));
  if (!real.length) return setStatus('Demo flights can’t be added to your calendar. Sign in with Google to use your real flights.', 'warn');
  calendarBusy = true;
  document.querySelectorAll('button.cal, #cal-all').forEach((b) => { b.disabled = true; });
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
  $('#query').value = store.get('query', DEFAULT_QUERY);
  $('#max-emails').value = store.get('maxEmails', '300');
  $('#origin').textContent = location.origin;

  $('#save-settings').addEventListener('click', () => {
    store.set('clientId', $('#client-id').value.trim());
    store.set('query', $('#query').value.trim() || DEFAULT_QUERY);
    store.set('maxEmails', String(Math.max(10, Math.min(2000, Number($('#max-emails').value) || 300))));
    $('#settings').open = false;
    setStatus('Settings saved.', 'ok');
  });
  $('#reset-query').addEventListener('click', () => { $('#query').value = DEFAULT_QUERY; });
  $('#signin').addEventListener('click', signIn);
  $('#signout').addEventListener('click', signOut);
  $('#scan').addEventListener('click', scan);
  $('#demo').addEventListener('click', () => {
    processMessages(sampleMessages());
    setStatus('Showing demo data. Sign in with Google to see your real flights.', 'ok');
  });
  $('#cal-all').addEventListener('click', () => {
    const map = synced();
    syncToCalendar(allFlights.filter((f) => ['add', 'update', 'remove'].includes(calendarState(f, map))));
  });
  $('#flights').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-cal]');
    if (!btn) return;
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
}

init();
