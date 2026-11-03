// Minimal Gmail REST client that runs in the browser with an OAuth access token.

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

// Booking phrases and travel sites, rather than any mention of "flight", so adverts and newsletters
// don't use up the scan limit and push older bookings out.
export const DEFAULT_QUERY =
  'newer_than:1y -in:spam {PNR "booking reference" "booking ref" "booking id" "booking confirmation" "booking confirmed" "booking is confirmed" "e-ticket" eticket itinerary "boarding pass" "flight booking" "flight ticket" "your flight" "confirmation code" "record locator" "trip id" "web check-in" smartbuy goibibo makemytrip cleartrip yatra easemytrip ixigo}';
export const DEFAULT_MAX_EMAILS = 600;

// Earlier defaults, so a saved copy of one can be upgraded to the current default.
export const OLD_DEFAULT_QUERIES = [
  'newer_than:1y -in:spam {flight flights itinerary e-ticket eticket "boarding pass" PNR "booking reference" "confirmation code" "record locator"}',
  'newer_than:1y -in:spam {flight flights itinerary e-ticket eticket "boarding pass" PNR "booking reference" "confirmation code" "record locator" "booking id" "booking confirmation" "trip id" smartbuy from:smartbuy}',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Gmail answers bursts of requests with 429 / 403 "rate limit exceeded" (and sometimes 5xx).
// Those are temporary: wait and retry instead of losing the email.
function isRetryable(status, body) {
  return status === 429 || status >= 500 || (status === 403 && /rate ?limit|quota|backend/i.test(body));
}

async function api(token, path, attempts = 6) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    } catch (netErr) {
      if (attempt + 1 >= attempts) throw netErr; // offline / connection dropped
      await sleep(500 * 2 ** attempt);
      continue;
    }
    if (res.ok) return res.json();
    const body = await res.text();
    if (isRetryable(res.status, body) && attempt + 1 < attempts) {
      const retryAfter = Number(res.headers.get('Retry-After'));
      await sleep(retryAfter > 0 ? retryAfter * 1000 : 400 * 2 ** attempt + Math.random() * 300);
      continue;
    }
    const err = new Error(`Gmail API ${res.status}: ${body.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
}

// Newest first. `ids.truncated` is true when more emails matched than `max` (older ones were left out).
export async function listMessageIds(token, query, max = DEFAULT_MAX_EMAILS) {
  const ids = [];
  let pageToken = '';
  let truncated = false;
  while (ids.length < max) {
    const params = new URLSearchParams({ q: query, maxResults: String(Math.min(500, max - ids.length)) });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await api(token, `/messages?${params}`);
    (data.messages || []).forEach((m) => ids.push(m.id));
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
    if (ids.length >= max) truncated = true;
  }
  return Object.assign(ids.slice(0, max), { truncated });
}

function decodeBase64Url(data) {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

function walkParts(part, out) {
  if (!part) return;
  const mime = (part.mimeType || '').toLowerCase();
  if (part.body?.data) {
    if (mime === 'text/html') out.html += decodeBase64Url(part.body.data);
    else if (mime === 'text/plain') out.text += decodeBase64Url(part.body.data);
  }
  (part.parts || []).forEach((p) => walkParts(p, out));
}

export async function getMessage(token, id) {
  const msg = await api(token, `/messages/${id}?format=full`);
  const headers = Object.fromEntries((msg.payload?.headers || []).map((h) => [h.name.toLowerCase(), h.value]));
  const out = { html: '', text: '' };
  walkParts(msg.payload, out);
  return {
    id,
    subject: headers.subject || '',
    from: headers.from || '',
    date: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : headers.date,
    html: out.html,
    text: out.text,
  };
}

// Fetch many messages with limited concurrency, reporting progress.
// Fetch many messages with limited concurrency, reporting progress. Emails that still fail after
// retries get one more, slower pass; anything left is reported in `failed` so the app can say so.
export async function getMessages(token, ids, onProgress, concurrency = 4) {
  const results = new Array(ids.length);
  let done = 0;
  async function run(indexes, workers) {
    let next = 0;
    async function worker() {
      while (next < indexes.length) {
        const i = indexes[next++];
        try {
          results[i] = await getMessage(token, ids[i]);
        } catch (e) {
          if (e.status === 401) throw e;
          results[i] = null;
        }
        if (workers > 1) onProgress?.(++done, ids.length);
      }
    }
    await Promise.all(Array.from({ length: Math.min(workers, indexes.length) }, worker));
  }
  await run(ids.map((_, i) => i), concurrency);
  const retry = ids.map((_, i) => i).filter((i) => !results[i]);
  if (retry.length) {
    await sleep(1500);
    await run(retry, 1);
  }
  const failed = ids.filter((_, i) => !results[i]);
  return Object.assign(results.filter(Boolean), { failed });
}
