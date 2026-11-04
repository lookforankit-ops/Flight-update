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

import { AIRPORT_TZ, CITIES } from './airports.js?v=202611040025';

const pad = (n) => String(n).padStart(2, '0');

// Known airport codes that are also common uppercase words; only trusted in clearer contexts.
const AMBIGUOUS_CODES = new Set(['CAN', 'ADD', 'MAN', 'PER', 'SIN', 'MED', 'PAT', 'MAD', 'LOS', 'SAN', 'DAD', 'HEL', 'BER', 'LIS', 'ARN', 'RAJ', 'NAG', 'AUS', 'MEL', 'ORD', 'DEN', 'OAK', 'ATL', 'BOS', 'MIA']);

// City name -> main airport, for emails that only say "Delhi to Mumbai".
const CITY_TO_CODE = (() => {
  const m = {};
  for (const [code, city] of Object.entries(CITIES)) {
    const k = city.toLowerCase();
    if (!(k in m)) m[k] = code;
  }
  Object.assign(m, {
    'new delhi': 'DEL', bangalore: 'BLR', bombay: 'BOM', calcutta: 'CCU', madras: 'MAA', cochin: 'COK',
    trivandrum: 'TRV', mangalore: 'IXE', vizag: 'VTZ', baroda: 'BDQ', trichy: 'TRZ', calicut: 'CCJ', hubli: 'HBX',
    gurgaon: 'DEL', gurugram: 'DEL', noida: 'DEL', 'port blair': 'IXZ', mysore: 'MYQ', varanasi: 'VNS', benaras: 'VNS',
  });
  return m;
})();
const CITY_RE = new RegExp(`\\b(${Object.keys(CITY_TO_CODE).sort((a, b) => b.length - a.length).map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi');

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

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// "AUG 27, THU" has no year but a weekday: pick the nearby year (last, this, next) on which it falls.
function yearFromWeekday(text, start, end, month, day, refDate) {
  // The weekday right after the date ("AUG 27, THU"), or right before it ("Thu, 27 Aug").
  const after = text.slice(end, end + 12).match(/^[\s,]*(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/i);
  const before = text.slice(Math.max(0, start - 14), start).match(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?[\s,]*$/i);
  const w = after || before;
  if (!w) return null;
  const base = inferYear(month, day, refDate);
  const years = [base, base - 1, base + 1];
  return years.find((y) => new Date(y, month - 1, day).getDay() === WEEKDAYS.indexOf(w[1].toLowerCase())) ?? null;
}

export function findDates(text, refDate) {
  const found = [];
  const MON = '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?';
  const patterns = [
    // 2026-11-20
    [/\b(20\d{2})-(\d{2})-(\d{2})\b/g, (m) => [+m[1], +m[2], +m[3]]],
    // 20 Nov 2026 / 20th November, 2026 / 20-Nov-2026. (?<![:.\d]) keeps "19:30 Aug…" from reading 30 as a day.
    [new RegExp(`(?<![:.\\d])\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s-]*${MON}[\\s,-]*(20\\d{2})\\b`, 'gi'),
      (m) => [+m[3], monthNum(m[2]), +m[1]]],
    // Two-digit years only in unambiguous forms: 20 Nov'26, 20 Nov '26, 20-Nov-26 (never "30 AUG 27").
    [new RegExp(`(?<![:.\\d])\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*|-)${MON}(?:\\s*[’']|-)(\\d{2})\\b`, 'gi'),
      (m) => [2000 + +m[3], monthNum(m[2]), +m[1]]],
    // Nov 20, 2026
    [new RegExp(`\\b${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d{2})\\b`, 'gi'), (m) => [+m[3], monthNum(m[1]), +m[2]]],
    // 20/11/2026, 20-11-2026, 20.11.26 (day first, as on Indian tickets; month first only when unambiguous)
    [/\b(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2}|\d{2})\b/g, (m) => {
      let [a, b] = [+m[1], +m[2]];
      if (b > 12 && a <= 12) [a, b] = [b, a];
      return [m[3].length === 2 ? 2000 + +m[3] : +m[3], b <= 12 ? b : null, a];
    }],
    // Fri, 20 Nov  (no year)
    [new RegExp(`(?<![:.\\d])\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MON}(?![\\s,-]*(?:[’']\\d|-\\d|20\\d{2}))`, 'gi'), (m) => [null, monthNum(m[2]), +m[1]]],
    // Nov 20 (no year)
    [new RegExp(`\\b${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?![:.]\\d)(?!,?\\s+20\\d{2})`, 'gi'), (m) => [null, monthNum(m[1]), +m[2]]],
  ];
  for (const [re, fn] of patterns) {
    let m;
    while ((m = re.exec(text))) {
      let [y, mo, d] = fn(m);
      if (!mo || d < 1 || d > 31) continue;
      if (y == null) y = yearFromWeekday(text, m.index, m.index + m[0].length, mo, d, refDate) ?? inferYear(mo, d, refDate);
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
  const hrs = /\b([01]\d|2[0-3])([0-5]\d)\s*(?:hrs|hours|h)\b/gi;
  let h;
  while ((h = hrs.exec(text))) out.push({ index: h.index, time: `${h[1]}:${h[2]}` });
  const re = /\b([01]?\d|2[0-3])[:.h]([0-5]\d)\s*(am|pm|a\.m\.|p\.m\.)?(?![\d.])/gi;
  let m;
  while ((m = re.exec(text))) {
    let h = +m[1];
    const ap = (m[3] || '').toLowerCase();
    if (ap.startsWith('p') && h < 12) h += 12;
    if (ap.startsWith('a') && h === 12) h = 0;
    out.push({ index: m.index, time: `${pad(h)}:${m[2]}` });
  }
  return out.sort((a, b) => a.index - b.index);
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
  // Any known airport code written in capitals ("DEL 12 Nov", "BLR, Terminal 1").
  const known = /\b([A-Z]{3})\b/g;
  while ((m = known.exec(text))) {
    if (AIRPORT_TZ[m[1]] && !AMBIGUOUS_CODES.has(m[1]) && !codes.some((c) => c.index === m.index)) push(m[1], m.index);
  }
  codes.sort((a, b) => a.index - b.index);
  if (new Set(codes.map((c) => c.code)).size >= 2) return codes;
  // Last resort: city names ("Delhi to Mumbai").
  CITY_RE.lastIndex = 0;
  while ((m = CITY_RE.exec(text))) codes.push({ code: CITY_TO_CODE[m[1].toLowerCase()], index: m.index });
  return codes.sort((a, b) => a.index - b.index);
}

const NOT_CODES = new Set(['STATUS', 'NUMBER', 'DETAILS', 'CONFIRMED', 'BOOKED', 'BOOKING', 'AIRLINE', 'TICKET', 'PENDING', 'ISSUED', 'ONWARD', 'RETURN', 'ADULT', 'EMAIL', 'MOBILE']);

// Booking reference / PNR. Handles "PNR: ABC123", "Booking Reference (PNR): ABC123", "PNR/Booking Ref.: ABC123",
// "Airline PNR \t ABC123", "Confirmation code is ABC123", and the code on the next line.
export function findConfirmation(text) {
  const re = /(?:\bPNR\b|booking\s*(?:reference|ref\.?|code|id|number)|confirmation\s*(?:code|number|no\.?|#)?|record\s*locator|reservation\s*(?:code|number)|airline\s*ref(?:erence)?)(?:\s*(?:no\.?|number|is|pnr|ref\.?|reference|code|[:#\-–()\/|]))*\s*([A-Za-z0-9]{5,8})\b/gi;
  let m;
  while ((m = re.exec(text))) {
    const c = m[1];
    const label = m[0].slice(0, m[0].length - c.length).toLowerCase();
    const weak = /^\s*confirmation\s*[:#\-\s]*$/.test(label) && !/\d/.test(c); // "Confirmation email…"
    if (c === c.toUpperCase() && /[A-Z]/.test(c) && !NOT_CODES.has(c) && !weak) return c;
    re.lastIndex = m.index + 1; // the rejected word may itself start a label ("PNR/Booking Ref.: …")
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
    const fwdText = text.slice(fm.index, Math.min(nextStart, fm.end + 450));
    let windowText = fwdText;
    const backText = text.slice(Math.max(prevEnd, fm.index - 160), fm.index);

    const distinct = (list) => new Set(list.map((a) => a.code)).size;
    let airports = findAirports(windowText);
    const back = findAirports(backText);
    if (distinct(airports) >= 2 && distinct(back) >= 2) {
      // A route on both sides: take the one nearer the flight number. (Some emails put the route line
      // above the flight number, and then the next leg's route follows this leg's times.)
      const backGap = backText.length - (back[back.length - 1].index + 3);
      const fwdGap = airports[0].index - (fm.end - fm.index);
      if (backGap < fwdGap) {
        const last = back[back.length - 1];
        const first = [...back].reverse().find((a) => a.code !== last.code);
        airports = [first, last];
      }
    } else if (distinct(airports) < 2) {
      airports = [...back.slice(-2), ...airports];
      windowText = backText + windowText;
    }
    // Dates and times come from after the flight number when there are any there.
    let dates = findDates(fwdText, refDate);
    if (dates.length === 0) dates = findDates(backText, refDate).slice(-1);
    if (airports.length < 2 || dates.length === 0) return;

    const from = airports[0].code;
    const to = airports.find((a) => a.code !== from)?.code;
    if (!to) return;

    const fwdTimes = findTimes(fwdText);
    const times = fwdTimes.length ? fwdTimes : findTimes(windowText);
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

// ---------- What kind of email is this? ----------

// Marketing: sales, "seats filling fast", abandoned-search reminders...
const PROMO_SUBJECT = /\b(hurry|seats? left|few seats|filling fast|last chance|flash sale|sale\b|deals?\b|offers?\b|fares? (?:from|starting)|lowest fares?|price (?:drop|alert)|don'?t miss|limited[- ]time|\d+\s?% off|discount|cashback|save (?:up to|big)|book now|complete your (?:booking|trip)|still (?:thinking|planning)|you searched|your (?:recent )?search|continue (?:your )?booking|left something|newsletter|exclusive|getaway|wanderlust|explore)\b/i;
const PROMO_BODY = /\b(complete your booking|continue (?:your )?booking|you (?:recently )?searched|you were looking|seats? (?:are )?(?:filling|selling) fast|only \d+ seats? left|fares? starting (?:from|at)|book (?:your tickets? )?now before)\b/i;
const BOOKING_SUBJECT = /\b(confirm(?:ed|ation)|e-?ticket|itinerary|booking (?:id|ref|reference|details|is successful|successful)|(?:flight |trip )?booking\b[^.]{0,40}\bsuccessful(?:ly)?|successfully booked|order (?:reference|id|no)|pnr|boarding pass|check-?in|reservation|trip (?:id|details)|schedule change|flight (?:change|update))\b/i;
// A subject that clearly says the booking went through overrides cancellation wording in the body.
const CONFIRMED_SUBJECT = /\b(confirm(?:ed|ation)|successful(?:ly)?|e-?ticket|itinerary|booked)\b/i;

// Cancellations and refunds. Body phrases are specific, because every ticket mentions its "cancellation policy".
const CANCEL_SUBJECT = /\b(cancell?(?:ed|ation)|refund(?:ed)?)\b/i;
// Only statements about *this* booking ("your booking has been cancelled", "refund has been processed"),
// never terms-and-conditions text like "In case your flight is cancelled…" or "check your refund status".
const CANCEL_BODY = /\b(?:your\s+(?:booking|ticket|e-?ticket|flight|pnr|reservation|itinerary|trip)s?\b[^.\n]{0,50}?\b(?:has|have|was|were)\s+(?:been\s+)?(?:successfully\s+|fully\s+)?cancell?ed|we have cancell?ed your|cancellation (?:of your [^.\n]{0,40})?(?:is |has been )?(?:confirmed|successful|processed|completed)|(?:your )?refund (?:of [^.\n]{0,30})?(?:has been|was) (?:processed|initiated|credited|completed|approved))\b/gi;
const CONDITIONAL = /\b(?:if|in case|incase|should|when|whether|unless|in the event)\b/i;

function bodySaysCancelled(body) {
  CANCEL_BODY.lastIndex = 0;
  let m;
  while ((m = CANCEL_BODY.exec(body))) {
    const start = Math.max(body.lastIndexOf('.', m.index), body.lastIndexOf('\n', m.index)) + 1;
    if (!CONDITIONAL.test(body.slice(start, m.index + m[0].length))) return true;
  }
  return false;
}

/** @returns {{promo: boolean, cancelled: boolean}} */
export function classifyEmail({ subject = '', body = '' }) {
  const cancelled = CANCEL_SUBJECT.test(subject) || (!CONFIRMED_SUBJECT.test(subject) && bodySaysCancelled(body));
  const promo = !cancelled && !BOOKING_SUBJECT.test(subject) && (
    PROMO_SUBJECT.test(subject) || (PROMO_BODY.test(body) && !hasBookingEvidence(body))
  );
  return { promo, cancelled };
}

// Proof that an email is about a real booking: a PNR/booking reference or an e-ticket number.
function hasBookingEvidence(body) {
  return !!findConfirmation(body) || /\bticket\s*(?:number|no\.?|#)?\s*[:#-]?\s*\d{3}[- ]?\d{10}\b/i.test(body);
}

// ---------- Message-level extraction, merging, filtering ----------

export function extractFlights(message) {
  const { html = '', text = '', subject = '', date } = message;
  const bodies = [text && text.trim(), html && htmlToText(html)].filter(Boolean);
  const kind = classifyEmail({ subject, body: bodies.join('\n') });
  if (kind.promo) return [];

  let flights = parseJsonLd(html);
  if (flights.length === 0) {
    // Some emails have a near-empty plain-text part and the real ticket in HTML (or the reverse): try both.
    for (const body of bodies) {
      const found = parseHeuristic(`${subject}\n${body}`, { refDate: date, subject })
        .filter((f) => f.flightNumber && f.date && f.from && f.to);
      if (found.length > flights.length) flights = found;
    }
    // Flights read from free text only count when the email shows it's a real booking
    // (cancellation/refund emails are kept: they mark an existing booking as cancelled).
    if (!kind.cancelled && !BOOKING_SUBJECT.test(subject) && !bodies.some(hasBookingEvidence)) flights = [];
    // Airlines sell at most about a year ahead: a later date means a misread year.
    const sent = Date.parse(date);
    if (sent) flights = flights.filter((f) => Date.parse(f.date) - sent < 365 * 864e5);
  }
  return flights
    .filter((f) => f.flightNumber && f.date && f.from && f.to)
    .map((f) => ({
      ...f,
      cancelled: f.cancelled || kind.cancelled,
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
