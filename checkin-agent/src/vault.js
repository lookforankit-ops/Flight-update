// Holds the traveller's private details (passport, visa, ...) on this computer.
// The model only ever sees placeholders like {{passport_number}}; real values are swapped in
// right before typing into the airline's page, and removed again from page text sent back.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PROFILE_PATH = process.env.CHECKIN_PROFILE || path.join(here, '..', '.traveller-profile.json');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const isDateField = (name) => /date|expiry|dob|birth|valid/i.test(name);

function formatDate(value, fmt) {
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return value;
  const [, Y, M, D] = m;
  const tokens = { YYYY: Y, YY: Y.slice(2), MMMM: FULL_MONTHS[+M - 1], MMM: MONTHS[+M - 1], MM: M, M: String(+M), DD: D, D: String(+D) };
  return fmt.replace(/YYYY|YY|MMMM|MMM|MM|M|DD|D/g, (t) => tokens[t]);
}

export class Vault {
  constructor() { this.values = {}; }

  set(name, value) { if (value != null && String(value).trim()) this.values[name] = String(value).trim(); }
  has(name) { return name in this.values; }
  placeholder(name) { return `{{${name}}}`; }

  /** Replace {{name}} or {{name|DD/MM/YYYY}} with the real value. Throws on unknown names. */
  substitute(text) {
    return String(text).replace(/\{\{\s*([a-z0-9_]+)\s*(?:\|\s*([^}]+?))?\s*\}\}/gi, (_, name, fmt) => {
      if (!(name in this.values)) throw new Error(`Unknown placeholder {{${name}}}. Ask the user for it with request_traveler_details first.`);
      return fmt ? formatDate(this.values[name], fmt) : this.values[name];
    });
  }

  /** Remove any private value (in common formats) from text that is about to be sent to the model. */
  redact(text) {
    let out = String(text ?? '');
    const entries = Object.entries(this.values).filter(([, v]) => v.length >= 3).sort((a, b) => b[1].length - a[1].length);
    for (const [name, value] of entries) {
      const variants = new Set([value]);
      if (isDateField(name) && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        for (const f of ['DD/MM/YYYY', 'MM/DD/YYYY', 'DD-MM-YYYY', 'DD.MM.YYYY', 'DD MMM YYYY', 'D MMM YYYY', 'MMM D, YYYY', 'DDMMYYYY', 'YYYY/MM/DD']) variants.add(formatDate(value, f));
      }
      for (const v of variants) {
        const re = new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        out = out.replace(re, `{{${name}}}`);
      }
    }
    return out;
  }
}

export function loadProfile() {
  try { return JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8')); } catch { return {}; }
}

export function saveProfile(values) {
  const merged = { ...loadProfile(), ...values };
  fs.writeFileSync(PROFILE_PATH, JSON.stringify(merged, null, 2), { mode: 0o600 });
  fs.chmodSync(PROFILE_PATH, 0o600);
}
