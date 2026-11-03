// Fake emails for "Try demo" mode. Dates are generated relative to today so the demo always shows upcoming trips.

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const human = (d) => `${pad(d.getDate())} ${MON[d.getMonth()]} ${d.getFullYear()}`;
const daysFromNow = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
};

// ISO timestamp for a UTC moment, written in a given UTC offset (e.g. +4 for Dubai).
const isoAt = (ms, offsetHours) => {
  const local = new Date(ms + offsetHours * 3600000).toISOString().slice(0, 19);
  const sign = offsetHours >= 0 ? '+' : '-';
  const abs = Math.abs(offsetHours);
  return `${local}${sign}${pad(Math.floor(abs))}:${pad(Math.round((abs % 1) * 60))}`;
};

export function sampleMessages() {
  const a = daysFromNow(9);
  const b = daysFromNow(16);
  const c = daysFromNow(41);
  const past = daysFromNow(-20);
  const sent = daysFromNow(-12).toUTCString();

  const jsonLd = {
    '@context': 'http://schema.org',
    '@type': 'FlightReservation',
    reservationNumber: 'K7XQ2M',
    reservationStatus: 'http://schema.org/ReservationConfirmed',
    underName: { '@type': 'Person', name: 'Alex Traveler' },
    airplaneSeat: '14A',
    reservationFor: {
      '@type': 'Flight',
      flightNumber: '501',
      airline: { '@type': 'Airline', name: 'Emirates', iataCode: 'EK' },
      departureAirport: { '@type': 'Airport', name: 'Mumbai Chhatrapati Shivaji', iataCode: 'BOM' },
      departureTime: `${iso(c)}T04:25:00+05:30`,
      arrivalAirport: { '@type': 'Airport', name: 'Dubai International', iataCode: 'DXB' },
      arrivalTime: `${iso(c)}T06:05:00+04:00`,
    },
  };

  // A flight leaving in a few hours, to show the hours/minutes countdown.
  const soonDep = Date.now() + (3 * 60 + 8) * 60000;
  const soon = {
    '@context': 'http://schema.org',
    '@type': 'FlightReservation',
    reservationNumber: 'P9LM3K',
    underName: { '@type': 'Person', name: 'Alex Traveler' },
    airplaneSeat: '31K',
    reservationFor: {
      '@type': 'Flight',
      flightNumber: '512',
      airline: { '@type': 'Airline', name: 'Emirates', iataCode: 'EK' },
      departureAirport: { '@type': 'Airport', name: 'Dubai International', iataCode: 'DXB' },
      departureTime: isoAt(soonDep, 4),
      arrivalAirport: { '@type': 'Airport', name: 'Indira Gandhi International', iataCode: 'DEL' },
      arrivalTime: isoAt(soonDep + 187 * 60000, 5.5),
    },
  };

  return [
    {
      id: 'demo-0',
      from: 'Emirates <do-not-reply@emirates.email>',
      subject: 'Your boarding pass is ready: EK 512',
      date: sent,
      html: `<script type="application/ld+json">${JSON.stringify(soon)}</script><p>Check-in is open.</p>`,
    },
    {
      id: 'demo-1',
      from: 'IndiGo <reservations@goindigo.in>',
      subject: 'Your IndiGo Itinerary - PNR ZX4R9T',
      date: sent,
      text: `Dear Customer,\nThank you for booking with IndiGo.\nPNR: ZX4R9T\n\nFlight 6E 2134\nNew Delhi (DEL) → Bengaluru (BLR)\n${human(a)}\nDeparture 06:15  Arrival 09:05\n\nReturn\nFlight 6E 5317\nBengaluru (BLR) → New Delhi (DEL)\n${human(b)}\nDeparture 19:40  Arrival 22:35\n`,
    },
    {
      id: 'demo-2',
      from: 'Emirates <do-not-reply@emirates.email>',
      subject: 'Your booking confirmation K7XQ2M',
      date: sent,
      html: `<html><head><script type="application/ld+json">${JSON.stringify(jsonLd)}</script></head><body><p>Your trip to Dubai is confirmed.</p></body></html>`,
    },
    {
      id: 'demo-3',
      from: 'Air India <noreply@airindia.com>',
      subject: 'E-ticket confirmation - Booking reference QW8E2P',
      date: daysFromNow(-60).toUTCString(),
      text: `Booking reference: QW8E2P\nAI 864  DEL - BOM  ${human(past)}  07:00  09:10\n`,
    },
  ];
}
