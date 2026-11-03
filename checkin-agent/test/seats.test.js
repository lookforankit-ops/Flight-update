import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseSeat, seatPositions } from '../src/seats.js';

const row = (n, spec, prices = {}) => ({
  row: n,
  seats: [...'ABCDEF'].map((l, i) => ({ letter: l, status: { o: 'occupied', a: 'available', x: 'blocked' }[spec[i]], price: prices[l] || 0, currency: 'INR' })),
});

test('positions for narrow and wide bodies', () => {
  assert.deepEqual(seatPositions('ABC DEF').pos, { A: 'window', B: 'middle', C: 'aisle', D: 'aisle', E: 'middle', F: 'window' });
  assert.deepEqual(seatPositions('ABC DEFG HJK').pos, { A: 'window', B: 'middle', C: 'aisle', D: 'aisle', E: 'middle', F: 'middle', G: 'aisle', H: 'aisle', J: 'middle', K: 'window' });
  assert.deepEqual(seatPositions('AC DF').pos, { A: 'window', C: 'aisle', D: 'aisle', F: 'window' });
});

test('rule 1: window with aisle booked and middle empty beats a nearer plain window', () => {
  const r = chooseSeat({ layout: 'ABC DEF', rows: [row(5, 'aaaaaa'), row(9, 'oooaao'), row(12, 'aaoooo')] });
  assert.equal(r.decision, 'auto');
  assert.equal(r.rule, 'window-quiet');
  assert.equal(r.seat.seat, '12A');
});

test('rule 1 on the right-hand side; a free aisle disqualifies rule 1', () => {
  // row 7: D (aisle) free -> 7F is only a plain window seat
  const r = chooseSeat({ layout: 'ABC DEF', rows: [row(7, 'oooaoa')] });
  assert.equal(r.rule, 'window');
  assert.equal(r.seat.seat, '7F');
  // row 8: D booked, E empty, F free -> quiet window
  const q = chooseSeat({ layout: 'ABC DEF', rows: [row(8, 'oooxaa'.replace('x', 'o'))] });
  assert.equal(q.seat.seat, '8F');
  assert.equal(q.rule, 'window-quiet');
});

test('rule 2: any free window seat, front-most first', () => {
  const r = chooseSeat({ layout: 'ABC DEF', rows: [row(20, 'aaaaaa'), row(14, 'aooooo')] });
  assert.equal(r.rule, 'window');
  assert.equal(r.seat.seat, '14A');
});

test('paid window seats are never auto-picked; user is asked with options', () => {
  const r = chooseSeat({ layout: 'ABC DEF', rows: [row(3, 'aooooa', { A: 450, F: 450 }), row(15, 'oaaaao')] });
  assert.equal(r.decision, 'ask');
  assert.match(r.reason, /paid window/);
  const seats = r.options.map((o) => o.seat);
  assert.ok(seats.includes('15C') && seats.includes('3A'));
  assert.equal(r.options.find((o) => o.seat === '3A').price, 450);
});

test('keeps an already-good assigned seat; multiple passengers -> ask', () => {
  assert.equal(chooseSeat({ layout: 'ABC DEF', currentSeat: '10F', rows: [row(10, 'oooaao'.replace(/^(...)a/, '$1o')), row(11, 'aaaaaa')] }).decision, 'keep');
  assert.equal(chooseSeat({ layout: 'ABC DEF', passengers: 2, rows: [row(11, 'aaaaaa')] }).decision, 'ask');
});
