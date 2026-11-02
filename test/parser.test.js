import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseJsonLd, parseHeuristic, extractFlights, mergeFlights, upcomingFlights,
  findDates, findTimes, findConfirmation, htmlToText,
} from '../src/parser.js';

test('parses schema.org FlightReservation JSON-LD', () => {
  const html = `<script type="application/ld+json">${JSON.stringify([{
    '@context': 'http://schema.org', '@type': 'FlightReservation', reservationNumber: 'ABC123',
    underName: { name: 'Jane Doe' },
    reservationFor: {
      '@type': 'Flight', flightNumber: '110', airline: { iataCode: 'UA', name: 'United' },
      departureAirport: { iataCode: 'SFO', name: 'San Francisco' }, departureTime: '2027-01-05T08:30:00-08:00',
      arrivalAirport: { iataCode: 'JFK' }, arrivalTime: '2027-01-05T17:05:00-05:00',
    },
  }])}</script>`;
  const [f] = parseJsonLd(html);
  assert.equal(f.flightNumber, 'UA110');
  assert.equal(f.from, 'SFO');
  assert.equal(f.to, 'JFK');
  assert.equal(f.date, '2027-01-05');
  assert.equal(f.departureTime, '08:30');
  assert.equal(f.arrivalTime, '17:05');
  assert.equal(f.confirmation, 'ABC123');
  assert.equal(f.passenger, 'Jane Doe');
});

test('heuristic parser handles a typical itinerary email with two legs', () => {
  const text = `PNR: ZX4R9T\nFlight 6E 2134\nNew Delhi (DEL) → Bengaluru (BLR)\n20 Nov 2026\nDeparture 06:15 Arrival 09:05\n\nFlight 6E 5317\nBengaluru (BLR) → New Delhi (DEL)\n27 Nov 2026\nDeparture 7:40 PM Arrival 10:35 PM`;
  const flights = parseHeuristic(text, { refDate: '2026-11-01' });
  assert.equal(flights.length, 2);
  assert.deepEqual(
    flights.map((f) => [f.flightNumber, f.from, f.to, f.date, f.departureTime, f.arrivalTime, f.confirmation]),
    [
      ['6E2134', 'DEL', 'BLR', '2026-11-20', '06:15', '09:05', 'ZX4R9T'],
      ['6E5317', 'BLR', 'DEL', '2026-11-27', '19:40', '22:35', 'ZX4R9T'],
    ],
  );
});

test('heuristic parser handles single-line "AI 864 DEL - BOM" layout', () => {
  const [f] = parseHeuristic('Booking reference: QW8E2P\nAI 864  DEL - BOM  Dec 3, 2026  07:00  09:10', {});
  assert.equal(f.flightNumber, 'AI864');
  assert.equal(f.from, 'DEL');
  assert.equal(f.to, 'BOM');
  assert.equal(f.date, '2026-12-03');
  assert.equal(f.confirmation, 'QW8E2P');
});

test('ignores emails without route information', () => {
  assert.deepEqual(parseHeuristic('Use code AB 123 to save 20% on 12 Dec 2026!', {}), []);
});

test('date / time / confirmation helpers', () => {
  assert.equal(findDates('Fri, 5 Jan', '2026-11-10')[0].date, '2027-01-05');
  assert.equal(findDates('on 2026-12-24')[0].date, '2026-12-24');
  assert.equal(findDates('14th March, 2027')[0].date, '2027-03-14');
  assert.equal(findTimes('12:30 am')[0].time, '00:30');
  assert.equal(findConfirmation('Your confirmation code is HJK9LP.'), 'HJK9LP');
  assert.equal(htmlToText('<td>DEL</td><td>&rarr;</td><td>BOM</td>').includes('→'), true);
});

test('merge prefers newer email and tracks cancellation; upcoming filters past', () => {
  const base = { from: 'DEL', to: 'BOM', date: '2026-12-01', flightNumber: 'AI864' };
  const a = extractFlights({ id: '1', subject: 'Booking', date: '2026-10-01', text: `AI 864 DEL - BOM 1 Dec 2026 07:00` });
  const b = extractFlights({ id: '2', subject: 'Your flight has been cancelled', date: '2026-10-05', text: `AI 864 DEL - BOM 1 Dec 2026 07:00` });
  const past = extractFlights({ id: '3', subject: 'Booking', date: '2026-01-01', text: `UK 955 BOM - DEL 1 Feb 2026 10:00` });
  const merged = mergeFlights([...b, ...a, ...past]);
  assert.equal(merged.length, 2);
  const m = merged.find((f) => f.flightNumber === base.flightNumber);
  assert.equal(m.cancelled, true);
  assert.equal(m.emails.length, 2);
  const now = new Date('2026-11-02T12:00:00');
  assert.equal(upcomingFlights(merged, now).length, 0);
  assert.equal(upcomingFlights(merged, now, { includeCancelled: true }).length, 1);
});

test('route line before the flight number', () => {
  const [f] = parseHeuristic('Your trip\nLHR → JFK\nBA 117 · Tue 8 Dec 2026 · 08:25 – 11:20', {});
  assert.deepEqual([f.flightNumber, f.from, f.to, f.date, f.departureTime], ['BA117', 'LHR', 'JFK', '2026-12-08', '08:25']);
});
