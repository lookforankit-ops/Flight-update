// One check-in run: checks the check-in window, opens the browser, runs the agent.
import { airlineFor } from './airlines.js';
import { CheckinAgent, describeFlight, createClaudeCaller } from './agent.js';
import { Browser } from './browser.js';
import { AIRPORT_TZ } from '../../src/airports.js';
import { zonedToUtc } from '../../src/calendar.js';

const fmt = (ms) => new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
const hoursText = (ms) => (ms > 36e5 * 48 ? `${Math.round(ms / 864e5)} days` : ms > 36e5 ? `${Math.round(ms / 36e5)} hours` : `${Math.max(1, Math.round(ms / 6e4))} minutes`);

export function departureUtc(flight) {
  const tz = AIRPORT_TZ[flight.from] || Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (flight.departureIso && /(Z|[+-]\d{2}:?\d{2})$/.test(flight.departureIso)) return Date.parse(flight.departureIso);
  return zonedToUtc(flight.date, flight.departureTime || '00:00', tz);
}

/** When check-in opens/closes, or null if the airline is unknown. */
export function checkinWindow(flight, airline = airlineFor(flight.flightNumber)) {
  if (!airline) return null;
  const dep = departureUtc(flight);
  return { opens: dep - airline.opensHours * 36e5, closes: dep - airline.closesMinutes * 6e4, departure: dep };
}

function sleep(ms, signal) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); });
  });
}

/**
 * @param {object} flight
 * @param {object} prompter
 * @param {{signal?: AbortSignal, callModel?: Function, browser?: Browser, now?: () => number}} opts
 */
export async function runCheckin(flight, prompter, opts = {}) {
  const now = opts.now || Date.now;
  const airline = airlineFor(flight.flightNumber);
  prompter.log(`✈ ${describeFlight(flight).replace(/\n/g, ' · ')}`);

  let url = flight.checkinUrl || airline?.url;
  if (!url) {
    const a = await prompter.text({ title: '🔗 Check-in page needed', message: `I don't know where ${flight.flightNumber.slice(0, 2)} does web check-in. Paste the airline's check-in page URL.` });
    if (!a?.value) return { status: 'failed', summary: 'No check-in page given.' };
    url = /^https?:\/\//.test(a.value) ? a.value : `https://${a.value}`;
  }

  const win = checkinWindow(flight, airline);
  if (win) {
    if (now() >= win.departure) return { status: 'failed', summary: 'This flight has already departed.' };
    if (now() < win.opens) {
      const a = await prompter.choose({
        title: '⏳ Check-in isn\'t open yet',
        message: `${airline.name} usually opens web check-in ${airline.opensHours} hours before departure, i.e. around ${fmt(win.opens)} (in ${hoursText(win.opens - now())}).`,
        options: [
          { id: 'wait', label: 'Wait and start automatically when it opens (keep this running)' },
          { id: 'now', label: 'Try now anyway' },
          { id: 'cancel', label: 'Cancel' },
        ],
      });
      if (!a || a.choice === 'cancel') return { status: 'not_open_yet', summary: `Check-in opens around ${fmt(win.opens)}.` };
      if (a.choice === 'wait') {
        prompter.log(`⏳ Waiting until ${fmt(win.opens + 5 * 6e4)} to start…`);
        await sleep(win.opens + 5 * 6e4 - now(), opts.signal);
        if (opts.signal?.aborted) return { status: 'failed', summary: 'Cancelled.' };
        prompter.log('⏰ Check-in should be open now. Starting.');
      }
    } else if (now() > win.closes) {
      const a = await prompter.confirm({ title: '⚠️ Check-in may be closed', message: `${airline.name} web check-in usually closes ${airline.closesMinutes} minutes before departure. Try anyway?` });
      if (!a.yes) return { status: 'failed', summary: 'Web check-in has probably closed; check in at the airport.' };
    }
  }

  const browser = opts.browser || new Browser();
  const callModel = opts.callModel || (await createClaudeCaller());
  if (!opts.browser) await browser.open();
  const agent = new CheckinAgent({ flight, checkinUrl: url, prompter, browser, callModel, signal: opts.signal });
  try {
    return await agent.run();
  } finally {
    // The browser stays open so the traveller can look at the result; the caller closes it.
    opts.onBrowser?.(browser);
  }
}
