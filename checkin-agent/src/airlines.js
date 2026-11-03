// Where each airline's web check-in lives and when it opens.
// Windows are typical values and can differ by route (domestic vs international) - edit as needed.
// If an airline is missing, the agent asks you for its check-in page.
export const AIRLINES = {
  '6E': { name: 'IndiGo', url: 'https://www.goindigo.in/web-check-in.html', opensHours: 48, closesMinutes: 60 },
  AI: { name: 'Air India', url: 'https://www.airindia.com/in/en/manage/web-checkin.html', opensHours: 48, closesMinutes: 60 },
  IX: { name: 'Air India Express', url: 'https://www.airindiaexpress.com/checkin', opensHours: 48, closesMinutes: 60 },
  QP: { name: 'Akasa Air', url: 'https://www.akasaair.com/check-in', opensHours: 48, closesMinutes: 60 },
  SG: { name: 'SpiceJet', url: 'https://www.spicejet.com/check-in', opensHours: 48, closesMinutes: 60 },
  EK: { name: 'Emirates', url: 'https://www.emirates.com/english/manage-booking/online-check-in/', opensHours: 48, closesMinutes: 90 },
  EY: { name: 'Etihad', url: 'https://www.etihad.com/en/manage/check-in', opensHours: 30, closesMinutes: 90 },
  QR: { name: 'Qatar Airways', url: 'https://www.qatarairways.com/en/manage-booking/online-check-in.html', opensHours: 48, closesMinutes: 90 },
  FZ: { name: 'flydubai', url: 'https://www.flydubai.com/en/plan/manage-booking/online-check-in', opensHours: 48, closesMinutes: 75 },
  G9: { name: 'Air Arabia', url: 'https://www.airarabia.com/en/online-check-in', opensHours: 48, closesMinutes: 75 },
  SQ: { name: 'Singapore Airlines', url: 'https://www.singaporeair.com/en_UK/plan-travel/online-checkin/', opensHours: 48, closesMinutes: 90 },
  BA: { name: 'British Airways', url: 'https://www.britishairways.com/travel/olcilandingpageauthreq/public/en_gb', opensHours: 24, closesMinutes: 60 },
  LH: { name: 'Lufthansa', url: 'https://www.lufthansa.com/us/en/online-check-in', opensHours: 23, closesMinutes: 60 },
  TK: { name: 'Turkish Airlines', url: 'https://www.turkishairlines.com/en-int/flights/manage-booking/online-check-in/', opensHours: 24, closesMinutes: 90 },
  UA: { name: 'United', url: 'https://www.united.com/en/us/checkin', opensHours: 24, closesMinutes: 45 },
  AA: { name: 'American', url: 'https://www.aa.com/reservation/flightCheckInViewReservationsAccess.do', opensHours: 24, closesMinutes: 45 },
  DL: { name: 'Delta', url: 'https://www.delta.com/mytrips/', opensHours: 24, closesMinutes: 45 },
};

export function airlineFor(flightNumber) {
  return AIRLINES[String(flightNumber || '').slice(0, 2).toUpperCase()] || null;
}
