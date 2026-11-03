import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseJsonLd, parseHeuristic, extractFlights, mergeFlights, upcomingFlights,
  findDates, findTimes, findConfirmation, htmlToText, classifyEmail,
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
  const a = extractFlights({ id: '1', subject: 'Booking', date: '2026-10-01', text: `PNR: QW8E2P\nAI 864 DEL - BOM 1 Dec 2026 07:00` });
  const b = extractFlights({ id: '2', subject: 'Your flight has been cancelled', date: '2026-10-05', text: `AI 864 DEL - BOM 1 Dec 2026 07:00` });
  const past = extractFlights({ id: '3', subject: 'Booking', date: '2026-01-01', text: `PNR: HJ7K2L\nUK 955 BOM - DEL 1 Feb 2026 10:00` });
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

// Layouts typical of bank/OTA travel portals (e.g. SmartBuy). Modelled, not copied from a real email.
test('portal ticket: codes next to times, numeric dates, booking id vs airline PNR', () => {
  const text = `SmartBuy Flight Booking Confirmed\nBooking ID: SB1234567890\nAirline PNR: ZX4R9T\n\nOnward: Delhi to Bengaluru\nIndiGo 6E-2134 Economy\nDEL 06:15\n12/11/2026\nIndira Gandhi International Airport, Terminal 1\nBLR 09:05\n12/11/2026\nKempegowda International Airport\n`;
  const [f] = parseHeuristic(text, { refDate: '2026-11-01' });
  assert.deepEqual([f.flightNumber, f.from, f.to, f.date, f.departureTime, f.arrivalTime, f.confirmation], ['6E2134', 'DEL', 'BLR', '2026-11-12', '06:15', '09:05', 'ZX4R9T']);
});

test('portal ticket: HTML table with codes followed by dates, "Nov\'26" and "hrs" times', () => {
  const html = `<table><tr><td>Air India</td><td>AI-916</td></tr>
    <tr><td>DXB Thu, 19 Nov'26</td><td>2040 hrs</td><td>DEL Fri, 20 Nov'26</td><td>0150 hrs</td></tr></table>
    <p>PNR: QW8E2P</p>`;
  const [f] = extractFlights({ id: 'x', subject: 'Your flight booking', date: '2026-11-01', html });
  assert.deepEqual([f.flightNumber, f.from, f.to, f.date, f.departureTime, f.arrivalDate, f.arrivalTime], ['AI916', 'DXB', 'DEL', '2026-11-19', '20:40', '2026-11-20', '01:50']);
});

test('city names only ("Mumbai to Dubai") still give airports', () => {
  const [f] = parseHeuristic('Flight EK 501\nMumbai to Dubai\n13 Dec 2026, 04:25 - 06:05', {});
  assert.deepEqual([f.flightNumber, f.from, f.to, f.date], ['EK501', 'BOM', 'DXB', '2026-12-13']);
});

test('uses the HTML part when the plain-text part is just a stub', () => {
  const [f] = extractFlights({
    id: 'y', subject: 'Booking confirmation', date: '2026-11-01',
    text: 'Your booking is confirmed. View this email in your browser.',
    html: '<p>PNR: HJ7K2L</p><p>Flight UK 955</p><p>BOM → DEL</p><p>5 Dec 2026 10:00</p>',
  });
  assert.equal(f.flightNumber, 'UK955');
});

// Cases reported from real use: an advert and a refund email were added as flights.
test('adverts are ignored', () => {
  assert.deepEqual(extractFlights({ id: 'ad', subject: 'Hurry! Only a few seats left to Delhi 💺', date: '2026-11-01',
    text: 'Fly 6E 1464 Dubai (DXB) to Delhi (DEL) on 22 Nov 2026. Fares starting from AED 399. Book now!' }), []);
  assert.deepEqual(extractFlights({ id: 'ad2', subject: 'Still planning your trip?', date: '2026-11-01',
    text: 'You searched for 6E 1463 DEL - DXB on 22 Nov 2026. Complete your booking before prices go up.' }), []);
});

test('flights in emails without a PNR or ticket number are not added', () => {
  assert.deepEqual(extractFlights({ id: 'n', subject: 'Flight schedule', date: '2026-11-01',
    text: 'EK 512 DEL - DXB 10 Nov 2026' }), []);
});

test('refund / cancellation emails mark the flight cancelled', () => {
  const [r] = extractFlights({ id: 'rf', subject: 'Regarding Refund Status of Your Flight Booking', date: '2026-11-02',
    text: 'Your refund has been processed for EK 512 DEL - DXB on 10 Nov 2026.' });
  assert.equal(r.cancelled, true);
  const booking = extractFlights({ id: 'bk', subject: 'Your Emirates booking', date: '2026-10-01',
    text: 'Booking reference: K7XQ2M\nEK 512 DEL - DXB 10 Nov 2026 16:15 18:35' });
  assert.equal(booking[0].cancelled, false);
  const merged = mergeFlights([...booking, r]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].cancelled, true);
});

test('a real booking that mentions its cancellation policy or an offer is still a booking', () => {
  const [f] = extractFlights({ id: 'ok', subject: 'Booking confirmed: 6E 1464', date: '2026-11-01',
    text: 'PNR: ZX4R9T\n6E 1464 DXB - DEL 4 Nov 2026 21:25 02:35\nCancellation policy: cancellation charges apply. Refund rules as per fare. Special offer: 10% off your next trip.' });
  assert.equal(f.flightNumber, '6E1464');
  assert.equal(f.cancelled, false);
});

test('classifyEmail', () => {
  assert.deepEqual(classifyEmail({ subject: 'Your flight has been cancelled' }), { promo: false, cancelled: true });
  assert.deepEqual(classifyEmail({ subject: 'Mega Sale: flights from ₹1,499' }), { promo: true, cancelled: false });
  assert.deepEqual(classifyEmail({ subject: 'Your e-ticket', body: 'Your booking was successfully cancelled.' }), { promo: false, cancelled: true });
  assert.deepEqual(classifyEmail({ subject: 'Booking confirmation', body: 'Free cancellation within 24 hours. Refund policy applies.' }), { promo: false, cancelled: false });
  assert.deepEqual(classifyEmail({ subject: 'Your itinerary + exclusive offers inside' }), { promo: false, cancelled: false });
});
