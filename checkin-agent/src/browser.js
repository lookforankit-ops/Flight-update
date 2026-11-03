// Visible Chromium window driven by Playwright, with a compact text "snapshot" for the model.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const MAX_TEXT = 7000;

// Runs inside the page: tags interactive elements with data-agent-ref and describes them.
function pageSnapshot() {
  window.__agentRef = window.__agentRef || 0;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0.05;
  };
  const clean = (s, n = 100) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const labelOf = (el) => {
    const by = el.getAttribute('aria-labelledby');
    const fromBy = by ? by.split(/\s+/).map((id) => document.getElementById(id)?.innerText || '').join(' ') : '';
    const forLabel = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.innerText : '';
    const wrap = el.closest('label')?.innerText;
    return clean(el.getAttribute('aria-label') || fromBy || forLabel || wrap || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || '');
  };
  const sel = 'a[href],button,input,select,textarea,[role=button],[role=link],[role=checkbox],[role=radio],[role=option],[role=tab],[role=menuitem],[role=combobox],[role=switch],[onclick],[tabindex]:not([tabindex="-1"])';
  const lines = [];
  for (const el of document.querySelectorAll(sel)) {
    if (!visible(el) || el.closest('[aria-hidden="true"]')) continue;
    if (el.type === 'hidden') continue;
    if (!el.dataset.agentRef) el.dataset.agentRef = `e${++window.__agentRef}`;
    const ref = el.dataset.agentRef;
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || (tag === 'a' ? 'link' : tag);
    const text = clean(el.innerText || el.value || '', 80);
    const label = labelOf(el);
    const parts = [`[${ref}] ${role}`];
    if (tag === 'input') parts.push(`type=${el.type || 'text'}`);
    if (label) parts.push(`"${label}"`);
    if (text && text !== label && tag !== 'input' && tag !== 'select' && tag !== 'textarea') parts.push(`text="${text}"`);
    if ((tag === 'input' || tag === 'textarea') && !['checkbox', 'radio', 'button', 'submit'].includes(el.type)) {
      parts.push(el.type === 'password' ? 'value=<hidden>' : `value="${clean(el.value, 60)}"`);
    }
    if (el.type === 'checkbox' || el.type === 'radio' || el.getAttribute('aria-checked')) parts.push(`checked=${el.checked ?? el.getAttribute('aria-checked')}`);
    if (el.getAttribute('aria-selected') === 'true') parts.push('selected');
    if (el.getAttribute('aria-pressed') === 'true') parts.push('pressed');
    if (tag === 'select') {
      const opts = [...el.options].slice(0, 25).map((o) => (o.selected ? `*${clean(o.text, 30)}` : clean(o.text, 30)));
      parts.push(`options=[${opts.join(' | ')}${el.options.length > 25 ? ` | …${el.options.length - 25} more` : ''}]`);
    }
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') parts.push('disabled');
    lines.push(parts.join(' '));
  }
  return {
    url: location.href,
    title: document.title,
    elements: lines,
    text: clean(document.body?.innerText || '', 20000),
  };
}

// Runs inside the page: details about one element, for the safety checks.
function elementInfo(el) {
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const label = el.getAttribute('aria-label') || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.innerText) || el.closest('label')?.innerText || '';
  return {
    text: clean([el.getAttribute('aria-label'), el.innerText, el.value, el.getAttribute('title')].filter(Boolean).join(' ')).slice(0, 300),
    label: clean(label), name: el.getAttribute('name') || '', id: el.id || '',
    placeholder: el.getAttribute('placeholder') || '', autocomplete: el.getAttribute('autocomplete') || '',
    tag: el.tagName.toLowerCase(), type: el.getAttribute('type') || '',
  };
}

export class Browser {
  constructor({ headless = process.env.HEADLESS === '1', downloadsDir = path.join(here, '..', 'boarding-passes'), profileDir = path.join(here, '..', '.browser-profile') } = {}) {
    this.headless = headless;
    this.downloadsDir = downloadsDir;
    this.profileDir = profileDir;
    this.downloads = [];
  }

  async open() {
    const { chromium } = require('playwright');
    const exe = process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {};
    // A persistent profile keeps airline cookies/logins between runs.
    this.context = await chromium.launchPersistentContext(this.profileDir, {
      headless: this.headless, viewport: this.headless ? { width: 1280, height: 900 } : null, acceptDownloads: true, ...exe,
    });
    this.page = this.context.pages()[0] || (await this.context.newPage());
    this.context.on('page', (p) => { this.page = p; this.watchDownloads(p); });
    this.watchDownloads(this.page);
  }

  watchDownloads(page) {
    page.on('download', async (d) => {
      fs.mkdirSync(this.downloadsDir, { recursive: true });
      const file = path.join(this.downloadsDir, `${Date.now()}-${d.suggestedFilename()}`);
      await d.saveAs(file).catch(() => {});
      this.downloads.push(file);
    });
  }

  async close() { await this.context?.close().catch(() => {}); }

  async settle() {
    await this.page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await this.page.waitForTimeout(600);
  }

  async goto(url) {
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await this.settle();
  }

  async snapshot() {
    const s = await this.page.evaluate(pageSnapshot);
    const text = s.text.length > MAX_TEXT ? `${s.text.slice(0, MAX_TEXT)} …[page text truncated; scroll or use find_text]` : s.text;
    return `URL: ${s.url}\nTitle: ${s.title}\n\nInteractive elements:\n${s.elements.join('\n') || '(none)'}\n\nPage text:\n${text}`;
  }

  async findText(query) {
    const s = await this.page.evaluate(pageSnapshot);
    const q = query.toLowerCase();
    const hits = [];
    let i = s.text.toLowerCase().indexOf(q);
    while (i !== -1 && hits.length < 8) {
      hits.push(s.text.slice(Math.max(0, i - 300), i + 500));
      i = s.text.toLowerCase().indexOf(q, i + q.length);
    }
    return hits.length ? hits.join('\n---\n') : `“${query}” not found on the page.`;
  }

  locator(ref) {
    if (!/^e\d+$/.test(ref)) throw new Error(`Invalid element ref "${ref}". Use a ref like e12 from the latest snapshot.`);
    return this.page.locator(`[data-agent-ref="${ref}"]`).first();
  }

  async info(ref) {
    const loc = this.locator(ref);
    if (!(await loc.count())) throw new Error(`Element ${ref} is no longer on the page. Take a new snapshot.`);
    return loc.evaluate(elementInfo);
  }

  async click(ref) { await this.locator(ref).click({ timeout: 10000 }); await this.settle(); }

  async fill(ref, value) {
    const loc = this.locator(ref);
    await loc.click({ timeout: 10000 }).catch(() => {});
    await loc.fill(value, { timeout: 10000 });
    await this.page.waitForTimeout(300);
  }

  async select(ref, option) {
    const loc = this.locator(ref);
    try {
      await loc.selectOption({ label: option }, { timeout: 5000 });
    } catch {
      await loc.selectOption(option, { timeout: 5000 });
    }
    await this.settle();
  }

  async press(key) { await this.page.keyboard.press(key); await this.settle(); }
  async scroll(direction) { await this.page.mouse.wheel(0, direction === 'up' ? -700 : 700); await this.page.waitForTimeout(500); }
}
