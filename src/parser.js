// Flight extraction from email content.
// Pure functions with no browser dependencies, so they can be unit-tested in Node.

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

// Three-letter uppercase words that are NOT airports but show up in emails.
const NOT_AIRPORTS = new Set([
  'PNR', 'THE', 'AND', 'FOR', 'YOU', 'USD', 'EUR', 'GBP', 'INR', 'AED', 'SGD', 'AUD', 'CAD',
  'GST', 'VAT', 'TAX', 'FEE', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN', 'JAN', 'FEB',
  'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC', 'ETA', 'ETD', 'NEW',
  'NON', 'REF', 'APP', 'FAQ', 'PDF', 'URL', 'WEB', 'HRS', 'MIN', 'ADT', 'CHD', 'INF', 'BAG',
  'ALL', 'ANY', 'NOT', 'ARE', 'OUR', 'HAS', 'WAS', 'CAN', 'GET', 'VIA', 'OFF', 'ONE', 'TWO',
  'IST', 'GMT', 'UTC', 'PST', 'EST', 'CET', 'MRS', 'MR', 'DOB', 'SSR', 'TKT', 'NRI', 'EMI',
]);

const AIRLINES = {
  '6E': 'IndiGo', AI: 'Air India', UK: 'Vistara', SG: 'SpiceJet', QP: 'Akasa Air', IX: 'Air India Express',
  I5: 'AIX Connect', EK: 'Emirates', EY: 'Etihad', QR: 'Qatar Airways', SQ: 'Singapore Airlines',
  BA: 'British Airways', LH: 'Lufthansa', AF: 'Air France', KL: 'KLM', UA: 'United', AA: 'American',
  DL: 'Delta', WN: 'Southwest', B6: 'JetBlue', AS: 'Alaska', AC: 'Air Canada', TK: 'Turkish Airlines',
  CX: 'Cathay Pacific', NH: 'ANA', JL: 'Japan Airlines', QF: 'Qantas', VS: 'Virgin Atlantic',
  FR: 'Ryanair', U2: 'easyJet', LX: 'Swiss', TG: 'Thai Airways', MH: 'Malaysia Airlines', FZ: 'flydubai',
  G9: 'Air Arabia', WY: 'Oman Air', GF: 'Gulf Air', SV: 'Saudia', KU: 'Kuwait Airways', NZ: 'Air New Zealand',
};

const pad = (n) => String(n).padStart(2, '0');

export function decodeEntities(s) {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&rarr;/gi, '→')
    .replace(/&ndash;/gi, '–')
    .replace(/&mdash;/gi, '—')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

export function htmlToText(html) {
  if (!html) return '';
  return decodeEntities(
    html
      .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|li|h\d|table|section)>/gi, '\n')
      .replace(/<\/(td|th)>/gi, ' \t ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

// ---------- schema.org JSON-LD (used by most airlines & OTAs; it is what Gmail itself reads) ----------

function asArray(x) {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

function typeIs(node, name) {
  return asArray(node && node['@type']).some((t) => String(t).replace(/^.*[/#]/, '') === name);
}

function collectReservations(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.forEach((n) => collectReservations(n, out));
  if (typeIs(node, 'FlightReservation')) out.push(node);
  for (const key of ['@graph', 'subReservation', 'reservation', 'itemListElement', 'item']) {
    if (node[key]) collectReservations(node[key], out);
  }
}

function splitIso(value) {
  if (!value) return { date: null, time: null, iso: null };
  const m = String(value).match(/(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return { date: null, time: null, iso: null };
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: m[4] ? `${m[4]}:${m[5]}` : null, iso: String(value) };
}

function airportFrom(a) {
  if (!a) return { code: null, name: null };
  if (typeof a === 'string') return { code: /^[A-Z]{3}$/.test(a) ? a : null, name: a };
  return { code: a.iataCode || null, name: a.name || a.address?.addressLocality || null };
}

export function parseJsonLd(html) {
  const results = [];
  if (!html) return results;
  const re = /<script[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    let data;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      try {
        data = JSON.parse(decodeEntities(m[1].trim()));
      } catch {
        continue;
      }
    }
    const reservations = [];
    collectReservations(data, reservations);
    for (const r of reservations) {
      for (const f of asArray(r.reservationFor)) {
        const airline = f.airline || {};
        const code = airline.iataCode || f.airline?.code || '';
        const num = String(f.flightNumber || '').replace(/\s+/g, '');
        const flightNumber = /^([A-Z]{2}|[A-Z]\d|\d[A-Z])\d/.test(num) ? num : `${code}${num}`;
        const dep = splitIso(f.departureTime);
        const arr = splitIso(f.arrivalTime);
        const from = airportFrom(f.departureAirport);
        const to = airportFrom(f.arrivalAirport);
        const seat = r.airplaneSeat || r.reservedTicket?.ticketedSeat?.seatNumber || null;
        results.push({
          source: 'schema',
          flightNumber: normalizeFlightNumber(flightNumber),
          airline: airline.name || AIRLINES[code] || AIRLINES[flightNumber.slice(0, 2)] || null,
          from: from.code,
          fromName: from.name,
          to: to.code,
          toName: to.name,
          date: dep.date,
          departureTime: dep.time,
          departureIso: dep.iso,
          arrivalDate: arr.date,
          arrivalTime: arr.time,
          arrivalIso: arr.iso,
          confirmation: r.reservationNumber || null,
          passenger: asArray(r.underName).map((u) => (typeof u === 'string' ? u : u?.name)).filter(Boolean).join(', ') || null,
          seat,
          cancelled: /cancel/i.test(String(r.reservationStatus || '')),
        });
      }
    }
  }
  return results;
}

// ---------- Heuristic text parser (fallback for emails without structured data) ----------

const FLIGHT_RE = /\b([A-Z][A-Z0-9]|[0-9][A-Z])\s?-?\s?(\d{2,4})\b/g;

export function normalizeFlightNumber(s) {
  return String(s || '').toUpperCase().replace(/[\s-]+/g, '');
}

function monthNum(name) {
  return MONTHS[String(name).toLowerCase().replace(/\.$/, '')] || null;
}

function inferYear(month, day, refDate) {
  // A date without a year: assume it is the next occurrence on/after the email date.
  const ref = refDate ? new Date(refDate) : new Date();
  let y = ref.getFullYear();
  const candidate = new Date(y, month - 1, day);
  if (candidate < new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - 1)) y += 1;
  return y;
}

export function findDates(text, refDate) {
  const found = [];
  const MON = '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?';
  const patterns = [
    // 2026-11-20
    [/\b(20\d{2})-(\d{2})-(\d{2})\b/g, (m) => [+m[1], +m[2], +m[3]]],
    // 20 Nov 2026 / 20th November, 2026 / 20-Nov-2026 / 20 Nov '26
    [new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s-]+${MON}[\\s,-]+'?(20\\d{2}|\\d{2})\\b`, 'gi'),
      (m) => [m[3].length === 2 ? 2000 + +m[3] : +m[3], monthNum(m[2]), +m[1]]],
    // Nov 20, 2026
    [new RegExp(`\\b${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d{2})\\b`, 'gi'), (m) => [+m[3], monthNum(m[1]), +m[2]]],
    // Fri, 20 Nov  (no year)
    [new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MON}(?![\\s,-]+'?\\d)`, 'gi'), (m) => [null, monthNum(m[2]), +m[1]]],
    // Nov 20 (no year)
    [new RegExp(`\\b${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?!,?\\s+\\d)`, 'gi'), (m) => [null, monthNum(m[1]), +m[2]]],
  ];
  for (const [re, fn] of patterns) {
    let m;
    while ((m = re.exec(text))) {
      let [y, mo, d] = fn(m);
      if (!mo || d < 1 || d > 31) continue;
      if (y == null) y = inferYear(mo, d, refDate);
      found.push({ index: m.index, end: m.index + m[0].length, date: `${y}-${pad(mo)}-${pad(d)}` });
    }
  }
  // Drop matches nested inside a longer match.
  return found
    .sort((a, b) => a.index - b.index || b.end - a.end)
    .filter((f, i, arr) => !arr.slice(0, i).some((o) => f.index >= o.index && f.end <= o.end));
}

export function findTimes(text) {
  const out = [];
  const re = /\b([01]?\d|2[0-3])[:.h]([0-5]\d)\s*(am|pm|a\.m\.|p\.m\.)?(?![\d.])/gi;
  let m;
  while ((m = re.exec(text))) {
    let h = +m[1];
    const ap = (m[3] || '').toLowerCase();
    if (ap.startsWith('p') && h < 12) h += 12;
    if (ap.startsWith('a') && h === 12) h = 0;
    out.push({ index: m.index, time: `${pad(h)}:${m[2]}` });
  }
  return out;
}

function findAirports(text) {
  const codes = [];
  const push = (code, index) => {
    if (!NOT_AIRPORTS.has(code)) codes.push({ code, index });
  };
  let m;
  // "New Delhi (DEL)"
  const paren = /\(([A-Z]{3})\)/g;
  while ((m = paren.exec(text))) push(m[1], m.index);
  if (codes.length >= 2) return codes;
  // "DEL → BOM", "DEL - BOM", "DEL to BOM"
  const pair = /\b([A-Z]{3})\s*(?:→|->|–|—|-|\bto\b|✈|>)\s*([A-Z]{3})\b/g;
  while ((m = pair.exec(text))) {
    push(m[1], m.index);
    push(m[2], m.index + m[0].length - 3);
  }
  if (codes.length >= 2) return codes;
  // Codes on their own line / next to times in boarding-pass style layouts.
  const lone = /(?:^|\n|\t|\s{2})([A-Z]{3})(?=\s*(?:\n|\t|\s{2}|$|\d{1,2}[:.]\d{2}))/g;
  while ((m = lone.exec(text))) push(m[1], m.index + m[0].length - 3);
  return codes;
}

export function findConfirmation(text) {
  const re = /(?:PNR|booking\s*(?:reference|ref\.?|code|id|number)|confirmation\s*(?:code|number|no\.?|#)|record\s*locator|reservation\s*(?:code|number)|airline\s*ref(?:erence)?)\s*(?:no\.?|number|is|:|#|-)*\s*([A-Za-z0-9]{5,8})\b/gi;
  let m;
  while ((m = re.exec(text))) {
    const c = m[1];
    if (c === c.toUpperCase() && /[A-Z]/.test(c)) return c;
  }
  return null;
}

export function parseHeuristic(text, { refDate, subject = '' } = {}) {
  if (!text) return [];
  const results = [];
  const matches = [];
  let m;
  FLIGHT_RE.lastIndex = 0;
  while ((m = FLIGHT_RE.exec(text))) {
    // Skip things like times "10 30", years or postcodes glued to words.
    const code = m[1];
    if (/^\d/.test(code) && /^\d+$/.test(code)) continue;
    const before = text.slice(Math.max(0, m.index - 1), m.index);
    if (/[A-Za-z0-9]/.test(before)) continue;
    matches.push({ index: m.index, end: m.index + m[0].length, code, number: m[2] });
  }

  const confirmation = findConfirmation(text);
  const cancelled = /cancell?ed|cancellation/i.test(subject);

  matches.forEach((fm, i) => {
    const prevEnd = i > 0 ? matches[i - 1].end : 0;
    const nextStart = i < matches.length - 1 ? matches[i + 1].index : text.length;
    // Details usually follow the flight number; look forward first, then backward if needed.
    let windowText = text.slice(fm.index, Math.min(nextStart, fm.end + 450));
    const backText = text.slice(Math.max(prevEnd, fm.index - 160), fm.index);

    let airports = findAirports(windowText);
    if (new Set(airports.map((a) => a.code)).size < 2) {
      const back = findAirports(backText);
      airports = [...back.slice(-2), ...airports];
      windowText = backText + windowText;
    }
    let dates = findDates(windowText, refDate);
    if (dates.length === 0) dates = findDates(backText, refDate).slice(-1);
    if (airports.length < 2 || dates.length === 0) return;

    const from = airports[0].code;
    const to = airports.find((a) => a.code !== from)?.code;
    if (!to) return;

    const times = findTimes(windowText);
    const flightNumber = normalizeFlightNumber(fm.code + fm.number);
    results.push({
      source: 'text',
      flightNumber,
      airline: AIRLINES[fm.code] || null,
      from,
      fromName: null,
      to,
      toName: null,
      date: dates[0].date,
      departureTime: times[0]?.time || null,
      departureIso: null,
      arrivalDate: dates[1]?.date || null,
      arrivalTime: times[1]?.time || null,
      arrivalIso: null,
      confirmation,
      passenger: null,
      seat: null,
      cancelled,
    });
  });
  // Same flight mentioned several times in one email (summary + details): keep first.
  const seen = new Set();
  return results.filter((r) => {
    const k = `${r.flightNumber}|${r.date}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------- Message-level extraction, merging, filtering ----------

export function extractFlights(message) {
  const { html = '', text = '', subject = '', date } = message;
  let flights = parseJsonLd(html);
  if (flights.length === 0) {
    const body = (text && text.trim()) || htmlToText(html);
    flights = parseHeuristic(`${subject}\n${body}`, { refDate: date, subject });
  }
  return flights
    .filter((f) => f.flightNumber && f.date && f.from && f.to)
    .map((f) => ({
      ...f,
      emails: [{ id: message.id, subject, from: message.from || '', date: date || null }],
      emailDate: date ? new Date(date).getTime() : 0,
    }));
}

export function mergeFlights(flights) {
  const byKey = new Map();
  // Oldest email first so newer emails (changes, cancellations) win.
  const sorted = [...flights].sort((a, b) => (a.emailDate || 0) - (b.emailDate || 0));
  for (const f of sorted) {
    const key = `${f.flightNumber}|${f.date}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...f });
      continue;
    }
    const preferNew = f.source === 'schema' || prev.source !== 'schema';
    const merged = { ...prev };
    for (const [k, v] of Object.entries(f)) {
      if (k === 'emails' || k === 'cancelled') continue;
      if (v != null && (merged[k] == null || preferNew)) merged[k] = v;
    }
    merged.source = prev.source === 'schema' || f.source === 'schema' ? 'schema' : 'text';
    merged.cancelled = f.cancelled || (prev.cancelled && !preferNew);
    merged.emails = [...prev.emails, ...f.emails.filter((e) => !prev.emails.some((p) => p.id === e.id))];
    byKey.set(key, merged);
  }
  return [...byKey.values()];
}

export function sortKey(f) {
  return `${f.date}T${f.departureTime || '00:00'}`;
}

export function upcomingFlights(flights, now = new Date(), { includeCancelled = false } = {}) {
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return flights
    .filter((f) => f.date >= today)
    .filter((f) => includeCancelled || !f.cancelled)
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}

export { AIRLINES };
