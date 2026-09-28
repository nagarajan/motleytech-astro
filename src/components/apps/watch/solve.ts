/**
 * Scratch: choose where the arbors go.
 *
 * Each mesh fixes a *distance* — the sum of the two pitch radii — and leaves the bearing
 * free, so the train is a chain of rigid links with rotating joints and the question is
 * which set of angles folds it into a watch rather than a tangle. Searched rather than
 * eyeballed, because a mesh that is a tenth of a millimetre out looks wrong immediately.
 */

const D = Math.PI / 180;

const R = {
  barrel: 5.6,
  centre: 3.5,
  third: 2.9,
  fourth: 2.5,
  escape: 2.1,
  balance: 3.3,
  ratchet: 2.4,
  crownWheel: 1.6,
};

// Centre distances, each the sum of a wheel's pitch radius and the pinion it drives.
const LINK = {
  barrelCentre: R.barrel + 0.7,
  centreThird: R.centre + 0.4375,
  thirdFourth: R.third + 0.3867,
  fourthEscape: R.fourth + 0.2857,
  escapePallet: 3.0,
  palletBalance: 2.6,
  ratchetCrown: R.ratchet + R.crownWheel,
};

const CASE = 13.5;

interface Spot {
  x: number;
  y: number;
}

function step(from: Spot, distance: number, bearing: number): Spot {
  return { x: from.x + distance * Math.cos(bearing), y: from.y + distance * Math.sin(bearing) };
}

function build(b: number[]): Record<string, Spot> {
  const centre = { x: 0, y: 0 };
  const barrel = step(centre, LINK.barrelCentre, b[0]);
  const third = step(centre, LINK.centreThird, b[1]);
  const fourth = step(third, LINK.thirdFourth, b[2]);
  const escape = step(fourth, LINK.fourthEscape, b[3]);
  const pallet = step(escape, LINK.escapePallet, b[4]);
  const balance = step(pallet, LINK.palletBalance, b[4]);
  // The crown wheel has to sit on the stem's axis, because a bevel pair only works if the
  // two axes actually meet. That pins it to y = 0 and to a fixed distance from the ratchet
  // wheel, which leaves one choice: which side of the barrel it goes.
  const reach = LINK.ratchetCrown * LINK.ratchetCrown - barrel.y * barrel.y;
  if (reach < 0.04) return {};
  const crownWheel = { x: barrel.x + Math.sqrt(reach), y: 0 };
  return { centre, barrel, third, fourth, escape, pallet, balance, crownWheel };
}

const SIZE: Record<string, number> = {
  centre: R.centre,
  barrel: R.barrel,
  third: R.third,
  fourth: R.fourth,
  escape: R.escape,
  pallet: 1.0,
  balance: R.balance,
  crownWheel: R.crownWheel,
};

/** Lower is better. Infinity means the arrangement is not a watch. */
function score(spots: Record<string, Spot>): number {
  const names = Object.keys(spots);
  if (names.length === 0) return Infinity;
  let cost = 0;

  for (const name of names) {
    const spot = spots[name];
    const reach = Math.hypot(spot.x, spot.y) + SIZE[name];
    if (reach > CASE) cost += (reach - CASE) * 40;
  }

  // Arbors run through every level of the movement, so two of them cannot be close even
  // when the wheels they carry are at different heights.
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      const gap = Math.hypot(spots[names[i]].x - spots[names[j]].x, spots[names[i]].y - spots[names[j]].y);
      if (gap < 1.5) cost += (1.5 - gap) * 60;
    }
  }

  // Keep the channel the stem runs down clear of everything but the keyless works.
  for (const name of names) {
    if (name === 'crownWheel') continue;
    const spot = spots[name];
    if (spot.x > 5.5 && Math.abs(spot.y) < 1.9) cost += 25;
  }

  // The escapement is what people come to look at, so it should not be under the two
  // biggest wheels in the movement.
  for (const near of ['escape', 'pallet', 'balance'] as const) {
    for (const under of ['barrel', 'centre'] as const) {
      const gap = Math.hypot(spots[near].x - spots[under].x, spots[near].y - spots[under].y);
      const want = SIZE[under] + SIZE[near] * 0.5;
      if (gap < want) cost += (want - gap) * 14;
    }
  }

  // And the balance should be well away from the barrel, which is how a movement is
  // usually arranged anyway: the heaviest part opposite the liveliest one.
  cost -= Math.min(16, Math.hypot(spots.balance.x - spots.barrel.x, spots.balance.y - spots.barrel.y)) * 1.5;
  // A seconds hand looks wrong anywhere but low on the dial.
  cost += Math.abs(Math.atan2(spots.fourth.y, spots.fourth.x) + Math.PI / 2) * 6;

  return cost;
}

let best: number[] = [];
let lowest = Infinity;

const coarse = 12 * D;
for (let a = 10 * D; a <= 40 * D; a += coarse / 2) {
  for (let b = -180 * D; b < 180 * D; b += coarse) {
    for (let c = -180 * D; c < 180 * D; c += coarse) {
      for (let d = -180 * D; d < 180 * D; d += coarse) {
        for (let e = -180 * D; e < 180 * D; e += coarse) {
          const bearings = [a, b, c, d, e];
          const cost = score(build(bearings));
          if (cost < lowest) {
            lowest = cost;
            best = bearings;
          }
        }
      }
    }
  }
}

// Polish.
let stepSize = coarse / 2;
while (stepSize > 0.0005) {
  let moved = false;
  for (let i = 0; i < best.length; i += 1) {
    for (const way of [1, -1]) {
      const trial = best.slice();
      trial[i] += way * stepSize;
      if (i === 0) trial[0] = Math.max(8 * D, Math.min(42 * D, trial[0]));
      const cost = score(build(trial));
      if (cost < lowest - 1e-9) {
        lowest = cost;
        best = trial;
        moved = true;
      }
    }
  }
  if (!moved) stepSize /= 2;
}

const spots = build(best);
console.log(`cost ${lowest.toFixed(2)}`);
console.log('bearings (deg): ' + best.map((x) => (x / D).toFixed(2)).join(', '));
console.log();
for (const [name, spot] of Object.entries(spots)) {
  console.log(
    `  ${name.padEnd(11)} (${spot.x.toFixed(3).padStart(7)}, ${spot.y.toFixed(3).padStart(7)})   ` +
      `from centre ${Math.hypot(spot.x, spot.y).toFixed(2).padStart(5)}   ` +
      `reach ${(Math.hypot(spot.x, spot.y) + SIZE[name]).toFixed(2).padStart(5)}`,
  );
}

console.log('\nmesh distances (should equal the link lengths exactly):');
const pairs: Array<[string, string, number]> = [
  ['barrel', 'centre', LINK.barrelCentre],
  ['centre', 'third', LINK.centreThird],
  ['third', 'fourth', LINK.thirdFourth],
  ['fourth', 'escape', LINK.fourthEscape],
  ['barrel', 'crownWheel', LINK.ratchetCrown],
];
for (const [a, b, want] of pairs) {
  const got = Math.hypot(spots[a].x - spots[b].x, spots[a].y - spots[b].y);
  console.log(`  ${a} → ${b}: ${got.toFixed(4)} want ${want.toFixed(4)}  ${Math.abs(got - want) < 1e-6 ? 'ok' : 'OFF'}`);
}

console.log('\nclosest arbors:');
const names = Object.keys(spots);
const gaps: Array<[string, number]> = [];
for (let i = 0; i < names.length; i += 1) {
  for (let j = i + 1; j < names.length; j += 1) {
    gaps.push([
      `${names[i]}–${names[j]}`,
      Math.hypot(spots[names[i]].x - spots[names[j]].x, spots[names[i]].y - spots[names[j]].y),
    ]);
  }
}
gaps.sort((p, q) => p[1] - q[1]);
for (const [pair, gap] of gaps.slice(0, 6)) console.log(`  ${pair.padEnd(22)} ${gap.toFixed(2)}`);
