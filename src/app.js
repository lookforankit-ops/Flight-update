import { extractFlights, mergeFlights, upcomingFlights, AIRLINES } from './parser.js';
import { DEFAULT_QUERY, listMessageIds, getMessages } from './gmail.js';
import { sampleMessages } from './samples.js';

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const $ = (sel) => document.querySelector(sel);

const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

let allFlights = [];
let accessToken = null;
let tokenClient = null;

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

function initTokenClient() {
  if (tokenClient || !clientId() || !window.google?.accounts?.oauth2) return !!tokenClient;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId(),
    scope: SCOPE,
    callback: (resp) => {
      if (resp.error) return setStatus(`Sign-in failed: ${resp.error}`, 'error');
      accessToken = resp.access_token;
      updateAuthUi();
      scan();
    },
    error_callback: (err) => setStatus(`Sign-in was not completed (${err.type}).`, 'warn'),
  });
  return true;
}

function signIn() {
  if (!clientId()) {
    $('#settings').open = true;
    $('#client-id').focus();
    return setStatus('First add your Google OAuth client ID in Settings (see the README for the 5-minute setup).', 'warn');
  }
  if (!initTokenClient()) return setStatus('Google sign-in is still loading. Try again in a moment.', 'warn');
  tokenClient.requestAccessToken({ prompt: '' });
}

function signOut() {
  if (accessToken) google.accounts.oauth2.revoke(accessToken, () => {});
  accessToken = null;
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
    tokenClient = null;
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
