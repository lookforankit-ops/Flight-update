// iCalendar (.ics) export, for calendars that don't show Google Calendar's notifications
// (e.g. the iPhone Calendar app). Alerts are written as VALARMs inside each event, so they survive import.
import { buildEvent, eventId, zonedToUtc } from './calendar.js?v=202611041104';

const pad = (n) => String(n).padStart(2, '0');

function icsUtc(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

// A Google-style start/end ({dateTime, timeZone} or {date}) -> iCalendar property value.
function icsTime(name, t) {
  if (t.date) return `${name};VALUE=DATE:${t.date.replace(/-/g, '')}`;
  const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/.test(t.dateTime);
  const ms = hasOffset ? Date.parse(t.dateTime) : zonedToUtc(t.dateTime.slice(0, 10), t.dateTime.slice(11, 16), t.timeZone);
  return `${name}:${icsUtc(ms)}`;
}

const escapeText = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// Lines longer than 75 bytes are folded (RFC 5545), without splitting multi-byte characters.
function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '';
  for (const ch of line) {
    if (enc.encode(cur + ch).length > (out.length ? 74 : 75)) { out.push(cur); cur = ''; }
    cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/**
 * @param {object[]} flights
 * @param {{alertMinutes?: number[], now?: Date}} opts
 * @returns {string} .ics file content
 */
export function buildIcs(flights, { alertMinutes = [1440, 180], now = new Date() } = {}) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Flight Update//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const f of flights) {
    const ev = buildEvent(f, { alertMinutes });
    lines.push(
      'BEGIN:VEVENT',
      `UID:${eventId(f)}@flight-update`,
      `DTSTAMP:${icsUtc(now.getTime())}`,
      icsTime('DTSTART', ev.start),
      icsTime('DTEND', ev.end),
      `SUMMARY:${escapeText(ev.summary)}`,
      `LOCATION:${escapeText(ev.location)}`,
      `DESCRIPTION:${escapeText(ev.description)}`,
      'TRANSP:OPAQUE',
    );
    for (const minutes of alertMinutes) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(ev.summary)}`, `TRIGGER:-PT${minutes}M`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
