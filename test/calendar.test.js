import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvent, eventId, zonedToUtc, eventHash, parseAlerts } from '../src/calendar.js';

const base = {
  flightNumber: '6E2134', airline: 'IndiGo', from: 'DEL', to: 'BLR', date: '2026-11-20',
  departureTime: '06:15', arrivalTime: '09:05', confirmation: 'ZX4R9T',
};

test('event id is stable and uses Calendar-safe characters', () => {
  const id = eventId(base);
  assert.equal(id, eventId({ ...base, seat: '1A' }));
  assert.match(id, /^[a-v0-9]{5,1024}$/);
  assert.notEqual(id, eventId({ ...base, date: '2026-11-21' }));
});

test('text-parsed flight uses airport time zones', () => {
  const e = buildEvent(base);
  assert.equal(e.summary, '✈ 6E2134 DEL → BLR');
  assert.deepEqual(e.start, { dateTime: '2026-11-20T06:15:00', timeZone: 'Asia/Kolkata' });
  assert.deepEqual(e.end, { dateTime: '2026-11-20T09:05:00', timeZone: 'Asia/Kolkata' });
  assert.match(e.description, /Booking reference: ZX4R9T/);
});

test('overnight flight across time zones rolls arrival to next day', () => {
  // DEL 22:30 IST -> LHR 03:10 GMT next day
  const e = buildEvent({ ...base, flightNumber: 'AI161', to: 'LHR', departureTime: '22:30', arrivalTime: '03:10' });
  assert.deepEqual(e.end, { dateTime: '2026-11-21T03:10:00', timeZone: 'Europe/London' });
});

test('schema.org times with offsets are used as-is', () => {
  const e = buildEvent({
    ...base, flightNumber: 'EK501', from: 'BOM', to: 'DXB', departureTime: '04:25', arrivalTime: '06:05',
    departureIso: '2026-12-13T04:25:00+05:30', arrivalIso: '2026-12-13T06:05:00+04:00',
  });
  assert.deepEqual(e.start, { dateTime: '2026-12-13T04:25:00+05:30', timeZone: 'Asia/Kolkata' });
  assert.deepEqual(e.end, { dateTime: '2026-12-13T06:05:00+04:00', timeZone: 'Asia/Dubai' });
});

test('missing times give an all-day event; missing arrival gives 2h block', () => {
  assert.deepEqual(buildEvent({ ...base, departureTime: null, arrivalTime: null }).start, { date: '2026-11-20' });
  const e = buildEvent({ ...base, arrivalTime: null });
  assert.deepEqual(e.end, { dateTime: '2026-11-20T08:15:00', timeZone: 'Asia/Kolkata' });
});

test('unknown airport falls back to default zone with a note', () => {
  const e = buildEvent({ ...base, from: 'XXQ', to: 'YYQ' }, { defaultTz: 'UTC' });
  assert.equal(e.start.timeZone, 'UTC');
  assert.match(e.description, /time zone for XXQ is unknown/);
});

test('zonedToUtc handles DST and hash changes with content', () => {
  assert.equal(new Date(zonedToUtc('2026-07-01', '12:00', 'Europe/London')).toISOString(), '2026-07-01T11:00:00.000Z');
  assert.equal(new Date(zonedToUtc('2026-12-01', '12:00', 'Europe/London')).toISOString(), '2026-12-01T12:00:00.000Z');
  assert.notEqual(eventHash(buildEvent(base)), eventHash(buildEvent({ ...base, departureTime: '06:20' })));
});

test('events carry explicit popup alerts (default 1 day and 3 hours before)', () => {
  assert.deepEqual(buildEvent(base).reminders, { useDefault: false, overrides: [{ method: 'popup', minutes: 1440 }, { method: 'popup', minutes: 180 }] });
  assert.deepEqual(buildEvent(base, { alertMinutes: [] }).reminders, { useDefault: false, overrides: [] });
  // Changing alerts changes the hash, so already-synced events show as needing an update.
  assert.notEqual(eventHash(buildEvent(base)), eventHash(buildEvent(base, { alertMinutes: [60] })));
});

test('parseAlerts', () => {
  assert.deepEqual(parseAlerts('24h, 3h'), [1440, 180]);
  assert.deepEqual(parseAlerts('2 days, 4 hours, 30m, 3'), [2880, 240, 180, 30]);
  assert.deepEqual(parseAlerts(''), []);
  assert.deepEqual(parseAlerts('soon, 5w'), []);
  assert.deepEqual(parseAlerts('1,2,3,4,5,6'), [360, 300, 240, 180, 120]);
});
