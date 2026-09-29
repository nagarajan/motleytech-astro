/**
 * Scratch harness. Asks whether any two parts of the movement occupy the same place.
 *
 * check.ts proves the movement runs; this proves it could be built. They are different
 * questions and the second one is easier to get wrong, because nothing in the physics
 * notices when two solids pass through each other — the winding stem ran straight through
 * the barrel's toothed rim for a long time and every number still came out right.
 *
 * Each part is reduced to a handful of solids of revolution: a circle or an annulus in
 * plan, swept through a band of height. The stem is the one exception and gets a capsule,
 * being a rod lying on its side. Two solids clash when their plan shapes overlap *and*
 * their heights overlap. Pairs that are meant to touch — a wheel and the pinion it drives,
 * two parts on one arbor — are named in MESHING and skipped.
 *
 *   ./run.sh clearance.ts
 */
import {
  CASE_RADIUS,
  CROWN_PULL,
  FORK,
  IMPULSE_AT,
  JEWEL,
  MOTION,
  PINION,
  R,
  SLIDING_IN,
  SPOT,
  STEM,
  TEETH,
  THICK,
  Z,
  type Spot,
} from './layout';
import { AUTO, FORK_SWING, KEYLESS, TRAIN } from './movement';
import { palletForkGeometry } from './parts';

/** A ring (or disc, when `inner` is 0) standing on the z axis at `at`. */
type Solid = {
  part: string;
  what: string;
  at: Spot;
  /** For the stem, the far end of the rod; the plan shape is then a capsule. */
  to?: Spot;
  outer: number;
  inner: number;
  lo: number;
  hi: number;
  /** Ways through: round holes, and for the bridge a slot, given as a capsule. */
  holes: { at: Spot; to?: Spot; r: number }[];
};

const solids: Solid[] = [];

function add(
  part: string,
  what: string,
  at: Spot,
  outer: number,
  z: number,
  thickness: number,
  opts: { inner?: number; to?: Spot; holes?: Solid['holes'] } = {},
): void {
  solids.push({
    part,
    what,
    at,
    to: opts.to,
    outer,
    inner: opts.inner ?? 0,
    lo: z - thickness / 2,
    hi: z + thickness / 2,
    holes: opts.holes ?? [],
  });
}

/**
 * The tip circle, which is what actually sweeps — not the pitch circle.
 *
 * A tooth's addendum is measured in *modules*, and the module is set by the tooth count,
 * so the tip stands proud by 10% on a 24-tooth wheel and 20% on a 9-leaf pinion. Writing
 * this as a flat percentage of the radius, which is what it was at first, quietly excuses
 * every small pinion in the watch from the check: it made the winding pinion look 0.07 mm
 * shorter than it is, which was exactly enough to hide it inside the ratchet wheel.
 */
const tip = (radius: number, teeth: number, pinion = false) =>
  radius + (pinion ? 1.2 : 1.25) * ((2 * radius) / teeth);

// ------------------------------------------------------------------ the barrel

add('barrel', 'toothed wall', SPOT.barrel, tip(R.barrel, TRAIN.barrel), Z.barrelTeeth, THICK.barrelWall, {
  inner: R.barrel * 0.845,
});
add('barrel', 'floor', SPOT.barrel, R.barrel * 0.85, Z.barrelTeeth - THICK.barrelWall / 2 + 0.1, 0.2, {
  inner: 0.64,
});
add('barrel', 'lid', SPOT.barrel, R.barrel * 0.87, Z.barrelLid, 0.22, { inner: 0.64 });
add('barrel', 'mainspring', SPOT.barrel, R.barrel * 0.79, Z.barrelTeeth, THICK.mainspring, { inner: 0.7 });
add('barrel', 'arbor', SPOT.barrel, 0.5, (Z.plate + Z.ratchet) / 2, Z.ratchet - Z.plate);

// ------------------------------------------------------------ the keyless works

add('stem', 'rod', { x: STEM.start, y: 0 }, STEM.radius, Z.stem, 2 * STEM.radius, {
  to: { x: STEM.end, y: 0 },
});
const windingTip = tip(R.windingPinion, KEYLESS.windingPinion);
const slidingTip = tip(R.slidingPinion, TEETH.slidingPinion, true);
add('windingPinion', 'pinion', SPOT.windingPinion, windingTip, Z.stem, 2 * windingTip);
for (const [name, x] of [
  ['in', SLIDING_IN],
  ['out', SLIDING_IN + CROWN_PULL],
] as const) {
  add('slidingPinion', name, { x, y: 0 }, slidingTip, Z.stem, 2 * slidingTip);
}
add('crownWheel', 'wheel', SPOT.crownWheel, tip(R.crownWheel, KEYLESS.crownWheel), Z.crownWheel, THICK.crownWheel);
add('setting', 'wheel', SPOT.setting, tip(R.settingWheel, TEETH.settingWheel), Z.setting, 0.34);
add('setting', 'pinion', SPOT.setting, tip(MOTION.settingPinion, TEETH.settingPinion), Z.settingPinion, 0.34);
add('setting', 'arbor', SPOT.setting, 0.3, (Z.setting + Z.settingPinion) / 2, Z.setting - Z.settingPinion);

// ------------------------------------------------------------- winding and plates

add('ratchet', 'wheel', SPOT.barrel, tip(R.ratchet, KEYLESS.ratchet), Z.ratchet, 0.3);
add('click', 'body', SPOT.click, 1.45, Z.click, 0.3);

// The barrel bridge is the hull of two circles — approximated here by the two circles
// themselves, which is close enough to catch anything that matters. Both carry the same
// cutouts as scene.ts punches in them: the arbor holes, and the slot down the stem's axis
// that lets the pinions on the stem hang through.
const BRIDGE_HOLES: Solid['holes'] = [
  { at: SPOT.crownWheel, r: 0.44 },
  { at: SPOT.click, r: 0.28 },
  { at: SPOT.setting, r: 0.32 },
  {
    at: SPOT.windingPinion,
    to: { x: SLIDING_IN + CROWN_PULL, y: 0 },
    r: R.windingPinion + 0.35,
  },
];
add('bridge', 'over the barrel', SPOT.barrel, R.barrel + 0.8, Z.bridge, THICK.bridge, {
  holes: BRIDGE_HOLES,
});
add('bridge', 'over the crown wheel', SPOT.crownWheel, 2.2, Z.bridge, THICK.bridge, {
  holes: BRIDGE_HOLES,
});
add('cock', 'over the balance', SPOT.balance, 3.3, Z.cock, THICK.bridge);

// ------------------------------------------------------ the balance and escapement

add('balance', 'wheel', SPOT.balance, R.balance, Z.balanceWheel, THICK.balanceRim);
add('balance', 'hairspring', SPOT.balance, 2.3, Z.hairspring, THICK.hairspring);
add('balance', 'staff', SPOT.balance, 0.19, (Z.cock + Z.roller) / 2, Z.cock - Z.roller);
add('balance', 'roller', SPOT.balance, R.roller, Z.roller, THICK.roller);
// The impulse jewel reaches down out of the roller through the lever's plane. Modelled
// where it sweeps, as a ring, because the balance turns and it goes round with it.
add('balance', 'impulse jewel', SPOT.balance, IMPULSE_AT + R.impulseJewel, (JEWEL.top + JEWEL.foot) / 2, JEWEL.top - JEWEL.foot, { inner: IMPULSE_AT - R.impulseJewel }); // prettier-ignore
add('escape', 'wheel', SPOT.escape, tip(R.escape, TRAIN.escape), Z.escapeWheel, THICK.escape);
add('escape', 'pinion', SPOT.escape, tip(PINION.escape, TRAIN.escapePinion, true), Z.escapePinion, THICK.pinion);
add('pallet', 'arbor', SPOT.pallet, 0.22, Z.pallet + 0.2, 0.95);

// ----------------------------------------------------------- the automatic work

add('reversing', 'pinion', SPOT.reversing, tip(R.reversingPinion, AUTO.reversingPinion, true), Z.reversingPinion, THICK.pinion); // prettier-ignore
add('reversing', 'wheel', SPOT.reversing, tip(R.reversing, AUTO.reversing), Z.reversingWheel, THICK.wheel);
add('reduction', 'pinion', SPOT.reduction, tip(R.reductionPinion, AUTO.reductionPinion, true), Z.reductionPinion, THICK.pinion); // prettier-ignore
add('reduction', 'wheel', SPOT.reduction, tip(R.reduction, AUTO.reduction), Z.reductionWheel, THICK.wheel);
add('rotor', 'pinion', SPOT.centre, tip(R.rotorPinion, AUTO.rotorPinion, true), Z.rotorPinion, THICK.pinion);
add('rotor', 'arm', SPOT.centre, R.rotor, Z.rotor, THICK.rotor);
add('rotor', 'weight', SPOT.centre, R.rotor, Z.rotor - THICK.rotor / 2 + THICK.rotorWeight / 2, THICK.rotorWeight, {
  inner: R.rotor * 0.76,
});

// ------------------------------------------------------------------- the pairs

/**
 * Pairs that are supposed to be in contact, either because one drives the other or
 * because they share an arbor. Written as `a+b` with the part names in either order.
 */
const MESHING = new Set(
  [
    // On one arbor, or bolted to each other.
    'barrel+barrel',
    'stem+stem',
    'setting+setting',
    'rotor+rotor',
    'reversing+reversing',
    'reduction+reduction',
    // Two lobes of one bridge.
    'bridge+bridge',
    'barrel+ratchet',
    'balance+balance',
    // Driving each other.
    'stem+windingPinion',
    'stem+slidingPinion',
    'slidingPinion+windingPinion',
    'windingPinion+crownWheel',
    'slidingPinion+setting',
    'crownWheel+ratchet',
    'ratchet+click',
    'ratchet+reversing',
    'reversing+reduction',
    'reduction+rotor',
    // The bridges hold the arbors that pass through them.
    'bridge+barrel',
    'bridge+crownWheel',
    'bridge+click',
    'cock+balance',
  ].flatMap((pair) => {
    const [a, b] = pair.split('+');
    return [`${a}+${b}`, `${b}+${a}`];
  }),
);

/** How close two solids may come before it counts as a clash. Parts are not perfect. */
const SLACK = 0.02;

/**
 * Closest approach in plan between two solids, negative when they overlap. A disc against
 * a disc is centre distance less the two radii; an annulus can also be missed by passing
 * through its hole, which is the case that matters for anything reaching into the barrel.
 */
function planGap(a: Solid, b: Solid): number {
  const d = axisGap(a, b);
  const outside = d - a.outer - b.outer;
  // Through the hole: b fits inside a's bore if it never reaches the bore's wall.
  const throughA = a.inner > 0 ? a.inner - d - b.outer : -Infinity;
  const throughB = b.inner > 0 ? b.inner - d - a.outer : -Infinity;
  // Or through one of the cutouts, if it stays clear of the cutout's edge all the way round.
  const viaHole = (holder: Solid, other: Solid) =>
    Math.max(-Infinity, ...holder.holes.map((h) => h.r - axisGap(h, other) - other.outer));
  return Math.max(outside, throughA, throughB, viaHole(a, b), viaHole(b, a));
}

/**
 * Distance between two plan centrelines, each a point or — where `to` is given — a
 * segment. Sampling is crude but everything here is straight and under twenty millimetres
 * long, so two hundred steps resolves to a tenth of a tenth of a millimetre.
 */
function axisGap(a: { at: Spot; to?: Spot }, b: { at: Spot; to?: Spot }): number {
  const [p0, p1] = [a.at, a.to ?? a.at];
  const [q0, q1] = [b.at, b.to ?? b.at];
  let best = Infinity;
  for (let i = 0; i <= 200; i++) {
    const px = p0.x + ((p1.x - p0.x) * i) / 200;
    const py = p0.y + ((p1.y - p0.y) * i) / 200;
    for (let j = 0; j <= 200; j++) {
      const qx = q0.x + ((q1.x - q0.x) * j) / 200;
      const qy = q0.y + ((q1.y - q0.y) * j) / 200;
      best = Math.min(best, Math.hypot(px - qx, py - qy));
    }
  }
  return best;
}

const zGap = (a: Solid, b: Solid) => Math.max(a.lo, b.lo) - Math.min(a.hi, b.hi);

console.log(`--- ${solids.length} solids, ${(solids.length * (solids.length - 1)) / 2} pairs ---\n`);

let clashes = 0;
let tight = 0;
for (let i = 0; i < solids.length; i++) {
  for (let j = i + 1; j < solids.length; j++) {
    const a = solids[i];
    const b = solids[j];
    if (MESHING.has(`${a.part}+${b.part}`)) continue;

    const plan = planGap(a, b);
    const z = zGap(a, b);
    // They miss each other if they miss in plan *or* in height. The clearance is whichever
    // of the two is more comfortable.
    const gap = Math.max(plan, z);
    const label = `${a.part} ${a.what} / ${b.part} ${b.what}`;

    if (gap < SLACK) {
      clashes++;
      const how = plan > z ? 'plan' : 'height';
      console.log(
        `CLASH  ${label.padEnd(46)} ${gap.toFixed(3)} mm  (plan ${plan.toFixed(2)}, height ${z.toFixed(2)}, ` +
          `closer in ${how === 'plan' ? 'height' : 'plan'})`,
      );
    } else if (gap < 0.12) {
      tight++;
      console.log(`tight  ${label.padEnd(46)} ${gap.toFixed(3)} mm`);
    }
  }
}

// ------------------------------------------------------------------ the lever

/**
 * The lever gets its own test, because it breaks both of the assumptions above: it is not
 * round, and where it is depends on where it is in its travel. So its outline is swung
 * through the twenty degrees it actually moves and measured, at every step, against the
 * round things it reaches in among.
 *
 * It reaches a long way in. The horns close to within 0.55 mm of the balance staff, which
 * is well inside the roller's rim — so the lever and the roller share plan space by design
 * and are kept apart in height alone. The notch and the impulse jewel are the exception and
 * are supposed to meet; everything else here has to miss.
 */
const forkOutline: Spot[] = palletForkGeometry().getPoints(1);

/** Nearest point of the lever's outline to a spot, with the lever turned by `angle`. */
function forkReach(angle: number, to: Spot): number {
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  let best = Infinity;
  for (let i = 0; i < forkOutline.length; i++) {
    const a = forkOutline[i];
    const b = forkOutline[(i + 1) % forkOutline.length];
    for (let t = 0; t <= 24; t++) {
      const x = a.x + ((b.x - a.x) * t) / 24;
      const y = a.y + ((b.y - a.y) * t) / 24;
      best = Math.min(
        best,
        Math.hypot(SPOT.pallet.x + c * x - s * y - to.x, SPOT.pallet.y + s * x + c * y - to.y),
      );
    }
  }
  return best;
}

/**
 * The lever's rest angle is π — it is drawn pointing along +X and the balance is at −X —
 * and it swings half of FORK_SWING either side of that.
 */
const NEAR: { what: string; at: Spot; r: number; lo: number; hi: number }[] = [
  { what: 'balance staff', at: SPOT.balance, r: 0.19, lo: Z.roller, hi: Z.cock },
  { what: 'balance roller', at: SPOT.balance, r: R.roller, lo: Z.roller - THICK.roller / 2, hi: Z.roller + THICK.roller / 2 }, // prettier-ignore
  { what: 'balance wheel', at: SPOT.balance, r: R.balance, lo: Z.balanceWheel - THICK.balanceRim / 2, hi: Z.balanceWheel + THICK.balanceRim / 2 }, // prettier-ignore
  { what: 'escape pinion', at: SPOT.escape, r: tip(PINION.escape, TRAIN.escapePinion, true), lo: Z.escapePinion - THICK.pinion / 2, hi: Z.escapePinion + THICK.pinion / 2 }, // prettier-ignore
];

const forkLo = Z.pallet - THICK.pallet / 2;
const forkHi = Z.pallet + THICK.pallet / 2;

console.log('\n--- the lever, through its swing ---');
for (const near of NEAR) {
  let worst = Infinity;
  for (let i = 0; i <= 40; i++) {
    const angle = Math.PI + FORK_SWING * (i / 40 - 0.5);
    worst = Math.min(worst, forkReach(angle, near.at) - near.r);
  }
  const height = Math.max(forkLo, near.lo) - Math.min(forkHi, near.hi);
  const gap = Math.max(worst, height);
  const verdict = gap < SLACK ? 'CLASH ' : gap < 0.12 ? 'tight ' : '  ok  ';
  console.log(
    `${verdict} lever / ${near.what.padEnd(20)} ${gap.toFixed(3)} mm  ` +
      `(plan ${worst.toFixed(2)}, height ${height.toFixed(2)})`,
  );
  if (gap < SLACK) clashes++;
}

// The one pair that is supposed to meet: the jewel has to fit the notch and reach it.
const slotSlack = FORK.slotHalf - R.impulseJewel;
const jewelIn = JEWEL.foot <= forkLo && JEWEL.top >= forkHi;
const jewelAt = 2.6 - IMPULSE_AT;
console.log(
  `\nthe notch: ${(FORK.slotHalf * 2).toFixed(2)} mm wide for a ${(R.impulseJewel * 2).toFixed(2)} mm jewel` +
    `  (${slotSlack.toFixed(3)} mm a side)`,
);
console.log(
  `the jewel: ${jewelAt.toFixed(3)} from the pallet pivot, notch runs ` +
    `${(FORK.horn * 0.87).toFixed(3)}..${FORK.horn.toFixed(3)}` +
    `${jewelAt > FORK.horn * 0.87 && jewelAt < FORK.horn ? '  in the notch' : '  OUT OF THE NOTCH'}`,
);
console.log(`           spans ${JEWEL.foot.toFixed(2)}..${JEWEL.top.toFixed(2)}, lever ${forkLo.toFixed(2)}..${forkHi.toFixed(2)}${jewelIn ? '  reaches through' : '  DOES NOT REACH THE LEVER'}`); // prettier-ignore
if (slotSlack <= 0 || !jewelIn) clashes++;

console.log(`\n${clashes} clash${clashes === 1 ? '' : 'es'}, ${tight} tight`);

// --------------------------------------------------------------- the case

console.log('\n--- inside the case ---');
for (const s of solids) {
  const far = Math.max(
    Math.hypot(s.at.x, s.at.y) + s.outer,
    s.to ? Math.hypot(s.to.x, s.to.y) + s.outer : 0,
  );
  if (far > CASE_RADIUS) {
    const note = s.part === 'stem' ? '  (the crown is meant to be outside)' : '  OUT OF THE CASE';
    console.log(`  ${`${s.part} ${s.what}`.padEnd(30)} reaches ${far.toFixed(2)} of ${CASE_RADIUS}${note}`);
  }
}
