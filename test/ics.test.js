import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIcs } from '../src/ics.js';

const flight = { flightNumber: '6E2134', airline: 'IndiGo', from: 'DEL', to: 'BLR', date: '2026-11-20', departureTime: '06:15', arrivalTime: '09:05', confirmation: 'ZX4R9T', passenger: 'Asha Rao, Ravi Rao' };

test('ics has one event per flight with UTC times and alarms', () => {
  const ics = buildIcs([flight, { ...flight, flightNumber: 'AI916', from: 'DXB', to: 'DEL', date: '2026-11-19', departureIso: '2026-11-19T20:40:00+04:00', arrivalIso: '2026-11-20T01:50:00+05:30' }],
    { alertMinutes: [1440, 180], now: new Date('2026-11-04T00:00:00Z') });
  const lines = ics.split('\r\n');
  assert.equal(lines[0], 'BEGIN:VCALENDAR');
  assert.equal(lines.filter((l) => l === 'BEGIN:VEVENT').length, 2);
  // 06:15 in Delhi (UTC+5:30) is 00:45 UTC
  assert.ok(lines.includes('DTSTART:20261120T004500Z'));
  assert.ok(lines.includes('DTEND:20261120T033500Z'));
  // 20:40 in Dubai (UTC+4) is 16:40 UTC; arrives 01:50 Delhi = 20:20 UTC
  assert.ok(lines.includes('DTSTART:20261119T164000Z'));
  assert.ok(lines.includes('DTEND:20261119T202000Z'));
  assert.equal(lines.filter((l) => l === 'TRIGGER:-PT1440M').length, 2);
  assert.equal(lines.filter((l) => l === 'TRIGGER:-PT180M').length, 2);
  assert.ok(lines.some((l) => l.startsWith('UID:fu') && l.endsWith('@flight-update')));
  // commas in text are escaped; every line is at most 75 bytes
  assert.match(ics.replace(/\r\n /g, ''), /Asha Rao\\, Ravi Rao/);
  assert.ok(lines.every((l) => new TextEncoder().encode(l).length <= 75));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
});

test('all-day event when no time is known; no alarms when none set', () => {
  const ics = buildIcs([{ ...flight, departureTime: null, arrivalTime: null }], { alertMinutes: [] });
  assert.match(ics, /DTSTART;VALUE=DATE:20261120\r\n/);
  assert.match(ics, /DTEND;VALUE=DATE:20261121\r\n/);
  assert.doesNotMatch(ics, /VALARM/);
});
