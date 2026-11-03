// Local web UI for the check-in agent: http://localhost:8787
// Binds to 127.0.0.1 only. The Flight Update app opens this page with the flight in the URL.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebPrompter } from './prompter.js';
import { runCheckin } from './run.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const prompter = new WebPrompter();
let running = null; // { controller }
let lastBrowser = null;
const clients = new Set();

prompter.on('event', (ev) => {
  for (const res of clients) res.write(`data: ${JSON.stringify(ev)}\n\n`);
});

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients (curl) on this machine
  return origin === `http://localhost:${PORT}` || origin === `http://127.0.0.1:${PORT}`;
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1e6) throw new Error('Body too large');
  }
  return body ? JSON.parse(body) : {};
}

const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

function validFlight(f) {
  return f && typeof f === 'object' && /^[A-Z0-9]{2}\d{1,4}[A-Z]?$/i.test(f.flightNumber || '') && /^\d{4}-\d{2}-\d{2}$/.test(f.date || '');
}

async function start(flight) {
  if (lastBrowser) { await lastBrowser.close(); lastBrowser = null; }
  prompter.reset();
  const controller = new AbortController();
  running = { controller };
  prompter.emitEvent({ type: 'state', running: true, flight });
  try {
    const result = await runCheckin(flight, prompter, { signal: controller.signal, onBrowser: (b) => { lastBrowser = b; } });
    prompter.emitEvent({ type: 'done', result });
  } catch (e) {
    console.error(e);
    prompter.emitEvent({ type: 'done', result: { status: 'failed', summary: e.message } });
  } finally {
    running = null;
    prompter.emitEvent({ type: 'state', running: false });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return fs.createReadStream(path.join(here, '..', 'public', 'index.html')).pipe(res);
    }
    if (req.method === 'GET' && url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      for (const ev of [{ type: 'state', running: !!running }, ...prompter.events]) res.write(`data: ${JSON.stringify(ev)}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => { clients.delete(res); clearInterval(ping); });
      return;
    }
    if (req.method === 'POST') {
      if (!sameOrigin(req)) return send(res, 403, { error: 'Forbidden origin' });
      const body = await readJson(req);
      if (url.pathname === '/api/start') {
        if (running) return send(res, 409, { error: 'A check-in is already running.' });
        if (!validFlight(body.flight)) return send(res, 400, { error: 'Missing or invalid flight (need flightNumber and date).' });
        start(body.flight);
        return send(res, 200, { ok: true });
      }
      if (url.pathname === '/api/answer') {
        return send(res, prompter.answer(body.id, body.answer) ? 200 : 404, { ok: true });
      }
      if (url.pathname === '/api/cancel') {
        running?.controller.abort();
        for (const id of [...prompter.pending.keys()]) prompter.answer(id, null);
        return send(res, 200, { ok: true });
      }
    }
    send(res, 404, { error: 'Not found' });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`🛂 Check-in agent ready at http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.log('   Note: ANTHROPIC_API_KEY is not set. Set it (or run `ant auth login`) before starting a check-in.');
  }
});

process.on('SIGINT', async () => { await lastBrowser?.close(); process.exit(0); });
