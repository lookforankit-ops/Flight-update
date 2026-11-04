// Google Calendar sync: turns a flight into a Calendar event and upserts/deletes it.
import { AIRPORT_TZ } from './airports.js?v=202611041104';

const API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

// Stable event id per flight so re-syncing updates instead of duplicating.
// Calendar ids allow lowercase a-v and 0-9; hex fits.
export function eventId(flight) {
  const key = `${flight.flightNumber}|${flight.date}`;
  return 'fu' + [...new TextEncoder().encode(key)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function tzOffsetMinutes(tz, utcMs) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return Math.round((asUtc - utcMs) / 60000);
}

// Local wall-clock date+time in an IANA zone -> UTC milliseconds.
export function zonedToUtc(date, time, tz) {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let utc = guess - tzOffsetMinutes(tz, guess) * 60000;
  const off2 = tzOffsetMinutes(tz, utc);
  utc = guess - off2 * 60000;
  return utc;
}

const hasOffset = (iso) => !!iso && /(Z|[+-]\d{2}:?\d{2})$/.test(iso);
const addDays = (date, n) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

function localTimeOf(utcMs, tz) {
  const off = tzOffsetMinutes(tz, utcMs);
  return new Date(utcMs + off * 60000).toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
}

export const DEFAULT_ALERT_HOURS = [24, 3];

// "24, 3" or "1 day, 3h, 30m" -> minutes before departure (Calendar allows at most 5, up to 4 weeks).
export function parseAlerts(text) {
  const out = [];
  for (const part of String(text ?? '').split(/[,;]+/)) {
    const m = part.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(d|days?|h|hrs?|hours?|m|mins?|minutes?)?$/);
    if (!m) continue;
    const n = Number(m[1]);
    const unit = m[2] || 'h';
    const minutes = Math.round(unit.startsWith('d') ? n * 1440 : unit.startsWith('m') ? n : n * 60);
    if (minutes >= 0 && minutes <= 40320 && !out.includes(minutes)) out.push(minutes);
  }
  return out.sort((a, b) => b - a).slice(0, 5);
}

export function buildEvent(flight, { defaultTz = Intl.DateTimeFormat().resolvedOptions().timeZone, alertMinutes = DEFAULT_ALERT_HOURS.map((h) => h * 60) } = {}) {
  const depTz = AIRPORT_TZ[flight.from];
  const arrTz = AIRPORT_TZ[flight.to];
  const notes = [];
  const place = (code, name) => (name ? `${name} (${code})` : code);

  const summary = `✈ ${flight.flightNumber} ${flight.from} → ${flight.to}`;
  const description = [
    flight.airline && `Airline: ${flight.airline}`,
    `Flight: ${flight.flightNumber}`,
    `From: ${place(flight.from, flight.fromName)}${flight.departureTime ? ` at ${flight.departureTime} local time` : ''}`,
    `To: ${place(flight.to, flight.toName)}${flight.arrivalTime ? ` at ${flight.arrivalTime} local time` : ''}`,
    flight.confirmation && `Booking reference: ${flight.confirmation}`,
    flight.passenger && `Passenger: ${flight.passenger}`,
    flight.seat && `Seat: ${flight.seat}`,
  ].filter(Boolean);

  let start;
  let end;
  if (!flight.departureTime) {
    // No time known: all-day event.
    start = { date: flight.date };
    end = { date: addDays(flight.date, 1) };
  } else {
    const startTz = depTz || defaultTz;
    if (!depTz && !hasOffset(flight.departureIso)) notes.push(`Departure time zone for ${flight.from} is unknown; assumed ${startTz}.`);
    const startUtc = hasOffset(flight.departureIso)
      ? Date.parse(flight.departureIso)
      : zonedToUtc(flight.date, flight.departureTime, startTz);
    start = hasOffset(flight.departureIso)
      ? { dateTime: flight.departureIso, ...(depTz && { timeZone: depTz }) }
      : { dateTime: `${flight.date}T${flight.departureTime}:00`, timeZone: startTz };

    let endUtc;
    const endTz = arrTz || startTz;
    if (hasOffset(flight.arrivalIso)) {
      endUtc = Date.parse(flight.arrivalIso);
      end = { dateTime: flight.arrivalIso, ...(arrTz && { timeZone: arrTz }) };
    } else if (flight.arrivalTime) {
      if (!arrTz && !hasOffset(flight.arrivalIso)) notes.push(`Arrival time zone for ${flight.to} is unknown; assumed ${endTz}.`);
      let arrDate = flight.arrivalDate || flight.date;
      endUtc = zonedToUtc(arrDate, flight.arrivalTime, endTz);
      // Overnight flight without an explicit arrival date.
      if (!flight.arrivalDate) {
        while (endUtc <= startUtc) {
          arrDate = addDays(arrDate, 1);
          endUtc = zonedToUtc(arrDate, flight.arrivalTime, endTz);
        }
      }
      end = { dateTime: `${arrDate}T${flight.arrivalTime}:00`, timeZone: endTz };
    }
    if (!endUtc || endUtc <= startUtc || endUtc - startUtc > 30 * 3600000) {
      // Unknown or implausible arrival: default to a 2-hour block in the departure zone.
      endUtc = startUtc + 2 * 3600000;
      end = { dateTime: `${localTimeOf(endUtc, startTz)}:00`, timeZone: startTz };
    }
  }

  return {
    id: eventId(flight),
    summary,
    location: place(flight.from, flight.fromName),
    description: [...description, ...notes].join('\n'),
    start,
    end,
    transparency: 'opaque',
    // Explicit alerts: the calendar's own defaults are often empty.
    reminders: { useDefault: false, overrides: alertMinutes.map((minutes) => ({ method: 'popup', minutes })) },
    extendedProperties: { private: { flightUpdate: '1', flightKey: `${flight.flightNumber}|${flight.date}` } },
  };
}

// A short fingerprint of the event contents, to tell whether Calendar is out of date.
export function eventHash(event) {
  const s = JSON.stringify([event.summary, event.description, event.start, event.end, event.location, event.reminders]);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

async function call(token, method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body && { 'Content-Type': 'application/json' }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(`Calendar API ${res.status}: ${data?.error?.message || res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Create the event, or update it if it already exists (also restores a previously deleted one).
export async function upsertEvent(token, event) {
  try {
    return await call(token, 'POST', API, event);
  } catch (e) {
    if (e.status !== 409) throw e;
    return call(token, 'PUT', `${API}/${event.id}`, { ...event, status: 'confirmed' });
  }
}

export async function deleteEvent(token, id) {
  try {
    await call(token, 'DELETE', `${API}/${id}`);
  } catch (e) {
    if (e.status !== 404 && e.status !== 410) throw e;
  }
}
