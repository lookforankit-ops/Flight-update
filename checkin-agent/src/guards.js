// Safety checks the agent's code enforces no matter what the model decides.

const CURRENCY = '(?:₹|Rs\\.?|INR|\\$|USD|US\\$|€|EUR|£|GBP|AED|SAR|QAR|OMR|KWD|BHD|SGD|MYR|THB|AUD|CAD|NZD|JPY|¥|CHF)';
const AMOUNT_RE = new RegExp(`${CURRENCY}\\s?(\\d[\\d,]*(?:\\.\\d+)?)|(\\d[\\d,]*(?:\\.\\d+)?)\\s?${CURRENCY}`, 'gi');
const PAY_WORDS = /\b(pay|payment|purchase|buy|checkout|check out and pay|add to (?:cart|booking|trip)|proceed to pay|confirm and pay|book now|place order|upgrade now)\b/i;
const FREE_WORDS = /\b(no thanks|skip|not now|continue without|i don't want|decline|free)\b/i;

/** Amounts mentioned in a piece of text, as numbers. */
export function amountsIn(text) {
  const out = [];
  let m;
  AMOUNT_RE.lastIndex = 0;
  while ((m = AMOUNT_RE.exec(String(text || '')))) out.push(Number((m[1] || m[2]).replace(/,/g, '')));
  return out;
}

/**
 * Does clicking an element with this text look like it costs money?
 * Returns { fee: boolean, amount: number|null, reason }.
 */
export function feeCheck(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return { fee: false };
  if (FREE_WORDS.test(t) && !PAY_WORDS.test(t)) return { fee: false };
  const amounts = amountsIn(t).filter((a) => a > 0);
  if (amounts.length) return { fee: true, amount: Math.max(...amounts), reason: `“${t.slice(0, 120)}” shows a price` };
  if (PAY_WORDS.test(t)) return { fee: true, amount: null, reason: `“${t.slice(0, 120)}” looks like a payment step` };
  return { fee: false };
}

/** Is this form field part of a payment card form? Those are only ever filled in by the user. */
export function isPaymentField(field) {
  const auto = String(field.autocomplete || '').toLowerCase();
  if (auto.startsWith('cc-')) return true;
  const label = `${field.label || ''} ${field.name || ''} ${field.id || ''} ${field.placeholder || ''}`.toLowerCase();
  return /\b(card ?number|cardnumber|credit card|debit card|cvv|cvc|csc|security code|name on card|card holder|cardholder|upi pin|net ?banking|ifsc)\b/.test(label)
    || /\bcard\b.*\b(expiry|exp)\b/.test(label);
}
