// Seat choice rules. Pure functions, no browser or model involved.
//
// Order of preference (for one passenger):
//   1. A free window seat whose row-block has the aisle seat booked and the middle seat(s) empty
//      (best chance of an empty seat next to you).
//   2. Any free window seat.
//   3. Anything else (paid seats, aisle/middle, several passengers) -> ask the user.
// Within a rule, the seat nearest the front wins.

const EMPTY = new Set(['available', 'blocked']);

// "ABC DEF" -> { A: 'window', B: 'middle', C: 'aisle', D: 'aisle', E: 'middle', F: 'window' }
export function seatPositions(layout) {
  const groups = String(layout || '').trim().toUpperCase().split(/[\s|_-]+/).filter(Boolean);
  const pos = {};
  groups.forEach((g, gi) => {
    [...g].forEach((letter, i) => {
      const leftEdge = gi === 0 && i === 0;
      const rightEdge = gi === groups.length - 1 && i === g.length - 1;
      if (leftEdge || rightEdge) pos[letter] = 'window';
      else if (i === 0 || i === g.length - 1) pos[letter] = 'aisle';
      else pos[letter] = 'middle';
    });
  });
  return { pos, groups };
}

const isFree = (s) => !s.price || Number(s.price) === 0;

function seatInfo(row, seat, positions) {
  return {
    seat: `${row.row}${seat.letter}`,
    row: row.row,
    letter: seat.letter,
    position: positions.pos[seat.letter] || 'unknown',
    price: Number(seat.price) || 0,
    currency: seat.currency || null,
    ref: seat.ref || null,
    status: seat.status,
    notes: seat.notes || null,
  };
}

// True when this window seat's block has every aisle seat occupied and every middle seat empty.
function quietWindow(row, seat, positions) {
  const group = positions.groups.find((g) => g.includes(seat.letter));
  if (!group || group.length < 3) return false;
  const byLetter = Object.fromEntries(row.seats.map((s) => [s.letter, s]));
  const others = [...group].filter((l) => l !== seat.letter);
  return others.every((l) => {
    const s = byLetter[l];
    if (!s) return false;
    const p = positions.pos[l];
    if (p === 'middle') return EMPTY.has(s.status);
    if (p === 'aisle') return s.status === 'occupied';
    return true; // the far window seat of a 4+ block doesn't matter
  });
}

/**
 * @param {{layout: string, rows: Array<{row:number, seats:Array<{letter:string,status:string,price?:number,currency?:string,ref?:string,notes?:string}>}>,
 *          currentSeat?: string, passengers?: number}} map
 * @returns {{decision:'auto'|'keep'|'ask', seat?:object, rule?:string, reason:string, options?:object[]}}
 */
export function chooseSeat(map) {
  const positions = seatPositions(map.layout);
  const rows = [...(map.rows || [])].sort((a, b) => a.row - b.row);
  const current = map.currentSeat ? String(map.currentSeat).toUpperCase() : null;

  const all = [];
  for (const row of rows) {
    for (const seat of row.seats || []) {
      const info = seatInfo(row, seat, positions);
      info.isCurrent = info.seat === current;
      info.quiet = info.position === 'window' && quietWindow(row, seat, positions);
      all.push(info);
    }
  }
  // The passenger's own assigned seat shows as taken on many seat maps; treat it as theirs to keep.
  const selectable = all.filter((s) => s.status === 'available' || s.isCurrent);
  const free = selectable.filter((s) => isFree(s) || s.isCurrent);

  if ((map.passengers || 1) > 1) {
    return { decision: 'ask', reason: `There are ${map.passengers} passengers on this booking, so the seat rules (made for one traveller) don't apply.`, options: optionsFor(selectable) };
  }

  const currentSeat = all.find((s) => s.isCurrent);
  const rule1 = free.filter((s) => s.quiet);
  if (currentSeat?.quiet) return { decision: 'keep', seat: currentSeat, rule: 'window-quiet', reason: `Your assigned seat ${currentSeat.seat} is already a window seat with the aisle booked and the middle empty.` };
  if (rule1.length) return { decision: 'auto', seat: rule1[0], rule: 'window-quiet', reason: `${rule1[0].seat} is a free window seat; the aisle seat in that row is booked and the middle is empty.` };

  if (currentSeat?.position === 'window') return { decision: 'keep', seat: currentSeat, rule: 'window', reason: `Your assigned seat ${currentSeat.seat} is already a window seat.` };
  const rule2 = free.filter((s) => s.position === 'window' && !s.isCurrent);
  if (rule2.length) return { decision: 'auto', seat: rule2[0], rule: 'window', reason: `${rule2[0].seat} is a free window seat (no row with the aisle booked and middle empty was available).` };

  return {
    decision: 'ask',
    reason: selectable.some((s) => s.position === 'window')
      ? 'No free window seats are left; only paid window seats are available.'
      : 'No window seats are available.',
    options: optionsFor(selectable),
  };
}

function optionsFor(selectable) {
  const freeSeats = selectable.filter((s) => isFree(s));
  const rank = { aisle: 0, window: 1, middle: 2, unknown: 3 };
  const pickFree = [...freeSeats].sort((a, b) => rank[a.position] - rank[b.position] || a.row - b.row).slice(0, 6);
  const paidWindows = selectable.filter((s) => !isFree(s) && s.position === 'window').sort((a, b) => a.price - b.price || a.row - b.row).slice(0, 4);
  const paidOther = selectable.filter((s) => !isFree(s) && s.position !== 'window').sort((a, b) => a.price - b.price || a.row - b.row).slice(0, 2);
  return [...pickFree, ...paidWindows, ...paidOther];
}

export function describeSeat(s) {
  const price = s.price ? `${s.currency || ''} ${s.price}`.trim() : 'free';
  return `${s.seat} – ${s.position}, ${price}${s.notes ? ` (${s.notes})` : ''}${s.isCurrent ? ' [currently assigned]' : ''}`;
}
