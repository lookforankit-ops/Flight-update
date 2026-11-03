// How the agent asks the traveller things. Two implementations: a web page (server.js) and the terminal.
import readline from 'node:readline/promises';
import { EventEmitter } from 'node:events';

/** Web prompter: questions become events for the page; answers come back via answer(). */
export class WebPrompter extends EventEmitter {
  constructor() {
    super();
    this.events = [];
    this.pending = new Map();
    this.nextId = 1;
  }

  emitEvent(e) {
    const ev = { ...e, at: Date.now() };
    this.events.push(ev);
    this.emit('event', ev);
  }

  reset() {
    for (const [, p] of this.pending) p.resolve(null);
    this.pending.clear();
    this.events = [];
    this.emitEvent({ type: 'reset' });
  }

  log(message) { this.emitEvent({ type: 'log', message }); }

  ask(kind, payload) {
    const id = String(this.nextId++);
    return new Promise((resolve) => {
      this.pending.set(id, { resolve });
      this.emitEvent({ type: 'prompt', id, kind, ...payload });
    });
  }

  answer(id, value) {
    const p = this.pending.get(String(id));
    if (!p) return false;
    this.pending.delete(String(id));
    this.emitEvent({ type: 'answered', id: String(id) }); // the answer itself is never stored or echoed
    p.resolve(value);
    return true;
  }

  confirm(q) { return this.ask('confirm', q).then((a) => a || { yes: false }); }
  form(q) { return this.ask('form', q); }
  choose(q) { return this.ask('choose', q); }
  text(q) { return this.ask('text', q); }
  wait(q) { return this.ask('wait', q); }
}

/** Terminal prompter for running from the command line. */
export class CliPrompter {
  constructor() { this.rl = readline.createInterface({ input: process.stdin, output: process.stdout }); }
  close() { this.rl.close(); }
  log(message) { console.log(message); }
  header(q) { console.log(`\n=== ${q.title} ===\n${q.message || ''}`); }

  async confirm(q) {
    this.header(q);
    const a = await this.rl.question('Allow? [y/N] ');
    return { yes: /^y(es)?$/i.test(a.trim()) };
  }

  async form(q) {
    this.header(q);
    const values = {};
    for (const f of q.fields) {
      const hint = [f.type === 'date' ? 'YYYY-MM-DD' : '', f.options?.length ? `one of: ${f.options.slice(0, 12).join(', ')}` : ''].filter(Boolean).join('; ');
      const def = f.value ? ` [${f.value}]` : '';
      const a = (await this.rl.question(`${f.label}${hint ? ` (${hint})` : ''}${def}: `)).trim();
      values[f.name] = a || f.value || '';
    }
    const remember = q.allowRemember ? /^y/i.test(await this.rl.question('Remember these on this computer for next time? [y/N] ')) : false;
    return { values, remember };
  }

  async choose(q) {
    this.header(q);
    q.options.forEach((o, i) => console.log(`  ${i + 1}. ${o.label}`));
    const a = (await this.rl.question(`Choose 1-${q.options.length}${q.allowOther ? ' or type your own' : ''}: `)).trim();
    const n = Number(a);
    if (n >= 1 && n <= q.options.length) return { choice: q.options[n - 1].id };
    return a ? { other: a } : null;
  }

  async text(q) {
    this.header(q);
    const a = (await this.rl.question('> ')).trim();
    return a ? { value: a } : null;
  }

  async wait(q) {
    this.header(q);
    const a = await this.rl.question('Press Enter when done (or type "cancel"): ');
    return { done: !/cancel/i.test(a) };
  }
}
