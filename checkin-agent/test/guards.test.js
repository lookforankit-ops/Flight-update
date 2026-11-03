import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feeCheck, isPaymentField, amountsIn } from '../src/guards.js';
import { Vault } from '../src/vault.js';

test('fee detection', () => {
  assert.equal(feeCheck('Seat 12A ₹450').fee, true);
  assert.equal(feeCheck('Seat 12A ₹450').amount, 450);
  assert.equal(feeCheck('Pay now').fee, true);
  assert.equal(feeCheck('Add to booking – AED 75.00').amount, 75);
  assert.equal(feeCheck('Seat 14A Free').fee, false);
  assert.equal(feeCheck('Seat 14A ₹0').fee, false);
  assert.equal(feeCheck('No thanks, continue').fee, false);
  assert.equal(feeCheck('Continue').fee, false);
  assert.equal(feeCheck('Check-in').fee, false);
  assert.deepEqual(amountsIn('INR 1,250 or $15.5'), [1250, 15.5]);
});

test('payment field detection', () => {
  assert.equal(isPaymentField({ autocomplete: 'cc-number' }), true);
  assert.equal(isPaymentField({ label: 'Card number' }), true);
  assert.equal(isPaymentField({ label: 'CVV' }), true);
  assert.equal(isPaymentField({ label: 'Passport expiry date' }), false);
  assert.equal(isPaymentField({ label: 'Last name' }), false);
});

test('vault substitutes placeholders with formats and redacts values', () => {
  const v = new Vault();
  v.set('passport_number', 'Z1234567');
  v.set('passport_expiry', '2031-05-09');
  assert.equal(v.substitute('{{passport_number}}'), 'Z1234567');
  assert.equal(v.substitute('{{passport_expiry|DD/MM/YYYY}}'), '09/05/2031');
  assert.equal(v.substitute('{{ passport_expiry | MMM }}'), 'May');
  assert.throws(() => v.substitute('{{visa_number}}'), /Unknown placeholder/);
  assert.equal(v.redact('Passport Z1234567 valid until 09/05/2031'), 'Passport {{passport_number}} valid until {{passport_expiry}}');
});
