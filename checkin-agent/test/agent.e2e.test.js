// End-to-end test: real browser + real agent code, against a fake airline site,
// with a scripted stand-in for the Claude model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Browser } from '../src/browser.js';
import { CheckinAgent } from '../src/agent.js';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.CHECKIN_PROFILE = path.join(os.tmpdir(), `profile-${process.pid}.json`);

function serve() {
  const server = http.createServer((req, res) => {
    if (req.url === '/boarding-pass.pdf') { res.writeHead(200, { 'Content-Type': 'application/pdf' }); return res.end('%PDF-1.4 fake'); }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(fs.readFileSync(path.join(here, 'fixtures', 'airline.html')));
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

let page = '';
const ref = (snap, re) => {
  if (snap.includes('Interactive elements:')) page = snap;
  const line = page.split('\n').find((l) => re.test(l));
  if (!line) throw new Error(`No element matching ${re} in snapshot:\n${page.slice(0, 2500)}`);
  return line.match(/\[(e\d+)\]/)[1];
};

class TestPrompter {
  constructor(answers) { this.answers = answers; this.asked = []; this.logs = []; }
  log(m) { this.logs.push(m); }
  next(kind, q) { this.asked.push({ kind, ...q }); const a = this.answers[kind].shift(); return Promise.resolve(typeof a === 'function' ? a(q) : a); }
  confirm(q) { return this.next('confirm', q); }
  form(q) { return this.next('form', q); }
  choose(q) { return this.next('choose', q); }
  text(q) { return this.next('text', q); }
  wait(q) { return this.next('wait', q); }
}

test('agent completes check-in with prompts, seat rules and fee/payment guards', async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = new Browser({ headless: true, profileDir: fs.mkdtempSync(path.join(os.tmpdir(), 'pw-')), downloadsDir: fs.mkdtempSync(path.join(os.tmpdir(), 'bp-')) });
  await browser.open();

  const sentToModel = [];
  let snap = '';
  let seatDecision = '';
  const toolResultsText = (messages) => {
    const last = messages[messages.length - 1];
    const text = typeof last.content === 'string' ? last.content : last.content.map((c) => c.content || '').join('\n');
    sentToModel.push(text);
    return text;
  };
  let n = 0;
  const call = (name, input) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `t${++n}`, name, input }] });

  // Each step looks at what the "model" was last sent and decides the next tool call.
  const script = [
    () => call('click', { ref: ref(snap, /Accept cookies/) }),
    () => call('fill', { ref: ref(snap, /"Booking reference"/), value: 'ZX4R9T' }),
    () => call('fill', { ref: ref(snap, /"Last name"/), value: 'Rao' }),
    () => call('click', { ref: ref(snap, /Find booking/) }),
    () => call('request_traveler_details', { reason: 'International flight needs passport details.', fields: [
      { name: 'passport_number', label: 'Passport number' }, { name: 'passport_expiry', label: 'Passport expiry' },
      { name: 'nationality', label: 'Nationality', options: ['India', 'United Kingdom'] }] }),
    () => { assert.match(snap, /\{\{passport_number\}\}/); return call('fill', { ref: ref(snap, /"Passport number"/), value: '{{passport_number}}' }); },
    () => call('fill', { ref: ref(snap, /"Passport expiry/), value: '{{passport_expiry|DD/MM/YYYY}}' }),
    () => call('select', { ref: ref(snap, /"Nationality"/), option: '{{nationality}}' }),
    () => call('click', { ref: ref(snap, /Save documents/) }),
    () => call('ask_user', { question: 'The airline asks you to confirm you are not carrying dangerous goods. Confirm?', options: ['Yes, confirm', 'No'] }),
    () => { assert.match(snap, /Yes, confirm/); return call('click', { ref: ref(snap, /dangerous goods/) }); },
    () => call('click', { ref: ref(snap, /text="Continue"/) }),
    () => {
      const seats = [];
      for (const line of snap.split('\n')) {
        const m = line.match(/\[(e\d+)\] button "Seat (\d+)([A-F]), (available|occupied)(?:, (₹450|free))?"/);
        if (m) seats.push({ row: +m[2], letter: m[3], status: m[4], price: m[5] === '₹450' ? 450 : 0, currency: 'INR', ref: m[1] });
      }
      const rows = Object.values(seats.reduce((acc, s) => { (acc[s.row] ||= { row: s.row, seats: [] }).seats.push({ letter: s.letter, status: s.status, price: s.price, currency: s.currency, ref: s.ref }); return acc; }, {}));
      return call('choose_seat', { layout: 'ABC DEF', rows, current_seat: '23B', passengers: 1 });
    },
    () => { seatDecision = snap; const r = snap.match(/ref (e\d+)/)[1]; return call('click', { ref: r }); },
    () => call('click', { ref: ref(snap, /Confirm seat/) }),
    () => call('click', { ref: ref(snap, /extra baggage/) }), // must be blocked: user says no
    () => { assert.match(snap, /did NOT allow/); return call('fill', { ref: ref(snap, /"Card number"/), value: '4111111111111111' }); },
    () => { assert.match(snap, /Refused: this looks like a payment field/); return call('click', { ref: ref(snap, /No thanks, continue/) }); },
    () => call('ask_user', { question: 'Complete check-in for Asha Rao on FA123, seat 12F?', options: ['Yes', 'No'] }),
    () => call('click', { ref: ref(snap, /Complete check-in/) }),
    () => call('click', { ref: ref(snap, /Download boarding pass/) }),
    () => call('finish', { status: 'checked_in', summary: 'Checked in; boarding pass downloaded.', seat: '12F' }),
  ];

  const callModel = async ({ messages }) => {
    snap = toolResultsText(messages);
    const step = script.shift();
    assert.ok(step, 'script ran out');
    return step();
  };

  const prompter = new TestPrompter({
    form: [(q) => ({ values: { passport_number: 'Z1234567', passport_expiry: '2031-05-09', nationality: 'India' }, remember: false })],
    confirm: [{ yes: false }], // the baggage click
    choose: [{ choice: 'Yes, confirm' }, { choice: 'Yes' }],
    text: [], wait: [],
  });

  try {
  const agent = new CheckinAgent({ flight: { flightNumber: 'FA123', from: 'DEL', to: 'LHR', date: '2026-11-20', confirmation: 'ZX4R9T', passenger: 'Asha Rao' }, checkinUrl: base, prompter, browser, callModel });
  const result = await agent.run();
  await new Promise((r) => setTimeout(r, 500));

  // Outcome
  assert.equal(result.status, 'checked_in');
  assert.equal(await browser.page.evaluate(() => document.body.dataset.seat), '12F', 'rule 1 seat: 12F has aisle 12D booked and middle 12E empty');
  assert.match(seatDecision, /Select seat 12F/);
  assert.equal(await browser.page.evaluate(() => document.body.dataset.bag), undefined, 'baggage fee was not bought');
  assert.equal(await browser.page.evaluate(() => document.getElementById('cc').value), '', 'card field untouched');
  assert.equal(browser.downloads.length, 1);
  // Real values reached the page...
  assert.equal(await browser.page.evaluate(() => document.getElementById('pp').value), 'Z1234567');
  assert.equal(await browser.page.evaluate(() => document.getElementById('exp').value), '09/05/2031');
  assert.equal(await browser.page.evaluate(() => document.getElementById('nat').value), 'India');
  // ...but never the model.
  const all = sentToModel.join('\n');
  assert.ok(!all.includes('Z1234567') && !all.includes('09/05/2031'), 'private values leaked to the model');
  // The user was asked about the fee click, and the form was the passport form.
  assert.match(prompter.asked.find((a) => a.kind === 'confirm').message, /1,500|1500/);
  assert.equal(prompter.asked.find((a) => a.kind === 'form').fields[1].type, 'date');

  } finally {
    await browser.close();
    server.close();
  }
});
