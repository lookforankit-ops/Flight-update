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
  assert.deepEqual(classifyEmail({ subject: 'Update on your trip', body: 'Your booking was successfully cancelled.' }), { promo: false, cancelled: true });
  assert.deepEqual(classifyEmail({ subject: 'Update on your trip', body: 'In case your flight is cancelled by the airline, the refund will be processed. Check your refund status online.' }), { promo: false, cancelled: false });
  assert.deepEqual(classifyEmail({ subject: 'Booking confirmation', body: 'Free cancellation within 24 hours. Refund policy applies.' }), { promo: false, cancelled: false });
  assert.deepEqual(classifyEmail({ subject: 'Your itinerary + exclusive offers inside' }), { promo: false, cancelled: false });
});

// Modelled on real emails that were wrongly dropped (wording reconstructed; personal details invented).
const TNC = '\nCancellation & refund: In case your flight is cancelled by the airline, the refund will be processed to your card within 7 days. Check your refund status in My Trips. If the flight has been cancelled by the airline, no fee applies.\nFares starting from ₹4,999 on your next trip - Book now!';

test('SmartBuy (via Goibibo) round trip is a booking, not cancelled or an advert', () => {
  const flights = extractFlights({ id: 'sb', date: '2026-10-18', from: 'SmartBuy <noreply@smartbuy.example>',
    subject: 'Your Flight Booking with SmartBuy is Successful - Order Reference Number 441179230855696467.',
    text: `Dear Ankit,\nYour flight booking via GOIBIBO is Successful!\nBelow are the details of your confirmed flight.\nOnward Flight\nAir India AI-916\nDXB Dubai Thu, 19 Nov 2026 20:40\nDEL New Delhi Fri, 20 Nov 2026 01:50\nAirline PNR 8TQFN3\nReturn Flight\nAir India AI-995\nDEL New Delhi Sun, 22 Nov 2026 19:20\nDXB Dubai Sun, 22 Nov 2026 22:05\nAirline PNR 8TQFN3${TNC}` });
  assert.deepEqual(flights.map((f) => [f.flightNumber, f.from, f.to, f.date, f.departureTime, f.cancelled, f.confirmation]), [
    ['AI916', 'DXB', 'DEL', '2026-11-19', '20:40', false, '8TQFN3'],
    ['AI995', 'DEL', 'DXB', '2026-11-22', '19:20', false, '8TQFN3'],
  ]);
});

test('MakeMyTrip e-ticket round trip', () => {
  const flights = extractFlights({ id: 'mmt', date: '2026-10-19', from: 'MakeMyTrip <noreply@makemytrip.example>',
    subject: 'E-Ticket for Your Flight Booking ID: NN2AO61I96924638634',
    html: `<table><tr><td>Booking ID</td><td>NN2AO61I96924638634</td></tr><tr><td>PNR</td><td>V56NMR</td></tr>
      <tr><td>IndiGo</td><td>6E 1464</td></tr><tr><td>Dubai (DXB)</td><td>Tue, 01 Dec 2026, 21:25</td><td>Delhi (DEL)</td><td>Wed, 02 Dec 2026, 02:35</td></tr>
      <tr><td>IndiGo</td><td>6E 1463</td></tr><tr><td>Delhi (DEL)</td><td>Sun, 06 Dec 2026, 17:35</td><td>Dubai (DXB)</td><td>Sun, 06 Dec 2026, 20:25</td></tr></table><p>${TNC}</p>` });
  assert.deepEqual(flights.map((f) => [f.flightNumber, f.from, f.to, f.date, f.departureTime, f.cancelled, f.confirmation]), [
    ['6E1464', 'DXB', 'DEL', '2026-12-01', '21:25', false, 'V56NMR'],
    ['6E1463', 'DEL', 'DXB', '2026-12-06', '17:35', false, 'V56NMR'],
  ]);
});

test('Etihad booking confirmation', () => {
  const flights = extractFlights({ id: 'ey', date: '2026-10-14', from: 'Etihad Airways <noreply@etihad.example>',
    subject: 'Your booking confirmation',
    text: `Booking reference 9YR9VG\nDelhi (DEL) to Abu Dhabi (AUH)\nEY 0213\nWed 30 Dec 2026 16:20 - 18:50\nAbu Dhabi (AUH) to Delhi (DEL)\nEY 0212\nSat 09 Jan 2027 09:15 - 14:10${TNC}` });
  assert.deepEqual(flights.map((f) => [f.flightNumber, f.from, f.to, f.date, f.departureTime, f.cancelled]), [
    ['EY0213', 'DEL', 'AUH', '2026-12-30', '16:20', false],
    ['EY0212', 'AUH', 'DEL', '2027-01-09', '09:15', false],
  ]);
});

test('booking reference formats', () => {
  assert.equal(findConfirmation('Booking Reference (PNR): QW8E2P'), 'QW8E2P');
  assert.equal(findConfirmation('PNR/Booking Ref.: ZX4R9T'), 'ZX4R9T');
  assert.equal(findConfirmation('Airline PNR \t 8TQFN3'), '8TQFN3');
  assert.equal(findConfirmation('PNR Status: Confirmed\nPNR: K7XQ2M'), 'K7XQ2M');
  assert.equal(findConfirmation('Confirmation email sent'), null);
});

// Real SmartBuy/Goibibo email text shared by the user (booking numbers replaced).
test('SmartBuy via Goibibo e-ticket (real layout)', () => {
  const text = `Your flight booking via GOIBIBO is Successful!\n\nBelow are the details of your confirmed flight.\n\n\nThank you for choosing SmartBuy!\n\n\nE-Ticket booked with\nGOIBIBO\nSuccess Booking Confirmed\nBooking ID: 40000000000000000001\nGOIBIBO Ref ID: GOFLIXX00X000000000000\nBooked on: Sun, 11 Oct 2026 08:56:40\nFor any assistance regarding your booking, please contact GOIBIBO:\nCall: +91 0000 0000000\nDeparture Flight\nDubai to New Delhi\n| Thu, 24 Dec 2026 20:40\n|\nECO VALUE\nAirline-Logo\nAir India\nAI - 916\nPNR Number\nQ7EV2M\nDXB Dubai\nThu, 24 Dec 2026 20:40\nDubai International Airport\nTerminal: T1\n3h 40m\nEconomy\nDEL New Delhi\nFri, 25 Dec 2026 01:50\nIndira Gandhi Airport\nTerminal: T3\nYour Fare Type Includes - ECO VALUE\n\tCabin Baggage: 7 Kgs\n\tCheck-in Baggage: 25 Kgs\n\tCancellation fee starts at ₹5,540\n\tDate Change fee starts at ₹13,185\n\tFree Seat\n`;
  const subject = 'Your Flight Booking with SmartBuy is Successful - Order Reference-Number 40000000000000000001.';
  for (const parts of [{ text }, { html: text.split('\n').map((l) => `<p>${l}</p>`).join('') }]) {
    const flights = extractFlights({ id: 'sb24', subject, date: '2026-10-11T08:56:40Z', ...parts });
    assert.deepEqual(flights.map((f) => [f.flightNumber, f.from, f.to, f.date, f.departureTime, f.arrivalDate, f.arrivalTime, f.confirmation, f.cancelled]),
      [['AI916', 'DXB', 'DEL', '2026-12-24', '20:40', '2026-12-25', '01:50', 'Q7EV2M', false]]);
  }
});
