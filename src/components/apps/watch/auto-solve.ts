/**
 * Scratch: where do the two automatic-winding wheels go?
 *
 * The module hangs off three fixed distances — rotor pinion to reduction wheel, reduction
 * pinion to reversing wheel, reversing pinion to ratchet wheel — and the ratchet and the
 * rotor are both already placed. That is three constraints on four unknowns, so there is
 * exactly one free angle, and this walks it and scores what comes out.
 *
 *   ./run.sh auto-solve.ts
 */
import { CASE_RADIUS, R, SPOT, D } from './layout';

const ROTOR_PINION = 0.5;
const REDUCTION = 2.5;
const REDUCTION_PINION = 0.52;
const REVERSING = 2.6;
const REVERSING_PINION = 0.6;

const TO_REDUCTION = ROTOR_PINION + REDUCTION;
const TO_REVERSING = REDUCTION_PINION + REVERSING;
const FROM_RATCHET = REVERSING_PINION + R.ratchet;

interface Spot {
  x: number;
  y: number;
}

const gap = (a: Spot, b: Spot) => Math.hypot(a.x - b.x, a.y - b.y);

/** The two places a point can be, given its distance from each of two known points. */
function meet(a: Spot, ra: number, b: Spot, rb: number): Spot[] {
  const d = gap(a, b);
  if (d > ra + rb || d < Math.abs(ra - rb)) return [];
  const along = (ra * ra - rb * rb + d * d) / (2 * d);
  const off = Math.sqrt(Math.max(0, ra * ra - along * along));
  const ux = (b.x - a.x) / d;
  const uy = (b.y - a.y) / d;
  const mx = a.x + along * ux;
  const my = a.y + along * uy;
  return [
    { x: mx - off * uy, y: my + off * ux },
    { x: mx + off * uy, y: my - off * ux },
  ];
}

/**
 * What the two new wheels actually have to avoid.
 *
 * Far less than it looks, because the automatic work sits on top of everything else and a
 * movement is packed in three dimensions: the reduction wheel passes straight over the
 * ratchet, the click, the crown wheel and half the going train without touching any of
 * them, simply by being a millimetre higher up. Only two kinds of thing conflict — bodies
 * that share a level, and arbors, which have to run down through every level to a pivot in
 * the plate and so collide with everything on the way.
 */
const ARBORS: Array<{ what: string; at: Spot }> = [
  { what: 'centre', at: SPOT.centre },
  { what: 'barrel', at: SPOT.barrel },
  { what: 'click', at: SPOT.click },
  { what: 'crown wheel', at: SPOT.crownWheel },
  { what: 'balance', at: SPOT.balance },
  { what: 'cock foot', at: SPOT.cockFoot },
  { what: 'third', at: SPOT.third },
];

/** Bodies at the same height as the new wheels: the balance and the hairspring over it. */
const LEVEL: Array<{ what: string; at: Spot; r: number }> = [
  { what: 'balance', at: SPOT.balance, r: R.balance + 0.3 },
];

/** A pivot needs its own hole, its jewel and a shoulder round it. */
const PIVOT_ROOM = 1.15;

function score(reduction: Spot, reversing: Spot) {
  let worst = Infinity;
  let blame = '';
  const note = (room: number, why: string) => {
    if (room < worst) {
      worst = room;
      blame = why;
    }
  };

  const check = (name: string, here: Spot, r: number) => {
    for (const other of ARBORS) {
      note(gap(here, other.at) - PIVOT_ROOM, `${name} arbor vs ${other.what} arbor`);
    }
    for (const other of LEVEL) {
      note(gap(here, other.at) - r - other.r, `${name} vs ${other.what}`);
    }
    note(CASE_RADIUS - gap(here, { x: 0, y: 0 }) - r, `${name} outside the case`);
  };

  check('reduction', reduction, REDUCTION);
  check('reversing', reversing, REVERSING);
  note(gap(reduction, reversing) - PIVOT_ROOM, 'the two new arbors');
  return { worst, blame };
}

console.log('bearing from the barrel, and how much room the result leaves');
console.log('  deg    reduction        reversing        worst gap   blamed on');

let best: { bearing: number; reduction: Spot; reversing: Spot; worst: number } | null = null;

for (let bearing = 132; bearing <= 150; bearing += 0.5) {
  const reversing = {
    x: SPOT.barrel.x + FROM_RATCHET * Math.cos(bearing * D),
    y: SPOT.barrel.y + FROM_RATCHET * Math.sin(bearing * D),
  };
  for (const reduction of meet(SPOT.centre, TO_REDUCTION, reversing, TO_REVERSING)) {
    const got = score(reduction, reversing);
    if (got.worst < -0.05) continue;
    console.log(
      `  ${String(bearing).padStart(3)}   ` +
        `(${reduction.x.toFixed(2).padStart(6)},${reduction.y.toFixed(2).padStart(6)})   ` +
        `(${reversing.x.toFixed(2).padStart(6)},${reversing.y.toFixed(2).padStart(6)})   ` +
        `${got.worst.toFixed(3).padStart(9)}   ${got.blame}`,
    );
    if (!best || got.worst > best.worst) best = { bearing, reduction, reversing, worst: got.worst };
  }
}

console.log('\nbest:', JSON.stringify(best, null, 2));
