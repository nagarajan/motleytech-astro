/**
 * Scratch harness. Sizes the keyless works.
 *
 * The plan of this part of the watch is not free — the crown wheel has to sit a fixed
 * distance from the barrel arbor and on the stem's axis, which pins it and the winding
 * pinion exactly. What is free is a handful of sizes, and they are all coupled:
 *
 *   - The winding pinion is a *crown gear* against the crown wheel, so its radius is the
 *     height from the stem up to the crown wheel's underside, and its tooth count is then
 *     forced, because a crown pair only meshes if the two circular pitches match.
 *   - The sliding pinion rides the same stem and must stay *under* the crown wheel, so it
 *     has to be shorter than the winding pinion by more than a tooth.
 *   - But the sliding pinion also has to reach the setting wheel when the crown is out,
 *     and a small sliding pinion drags the setting wheel in towards the stem, where its
 *     teeth start eating the stem itself.
 *   - And the setting wheel is the one part that reaches down to the dial side, so its
 *     arbor has to come down outside the barrel, which pushes it the other way.
 *
 * Every one of those is a wall, and by hand the feasible set kept coming out empty. So
 * this sweeps the free sizes, scores each by its *tightest* clearance, and reports the
 * roomiest. Same trick as solve.ts and auto-solve.ts, on a smaller problem.
 *
 *   ./run.sh keyless-solve.ts
 */
import { R, SPOT, THICK, Z } from './layout';
import { KEYLESS, TRAIN } from './movement';

const B = SPOT.barrel;

/** The module the crown wheel and ratchet already share. The winding pinion must join. */
const MODULE = (2 * R.crownWheel) / KEYLESS.crownWheel;
const BARREL_TOP = Z.barrelLid + 0.11;
const BARREL_TIP = R.barrel + 1.25 * ((2 * R.barrel) / TRAIN.barrel);
const CASE = 13.5;

/** Half the winding pinion plus half the sliding pinion: where their clutch faces meet. */
const CLUTCH = 0.68;
/** The post from the setting wheel down to its pinion under the dial. */
const ARBOR = 0.3;

/**
 * The setting side gets a module of its own, finer than the winding side's. That one
 * number turns out to matter more than anything else here. The setting wheel's teeth
 * reach in towards the stem to within one addendum of the sliding pinion's pitch circle,
 * so a coarse module puts them straight through the stem, and the stem has to be filed
 * down to a wire to get out of the way. Fine teeth on the same two pitch circles leave the
 * stem alone.
 */
interface Try {
  windingTeeth: number;
  stem: number;
  rod: number;
  pull: number;
  offset: number;
  /** The setting side's module, shared by the sliding pinion and the setting wheel. */
  module2: number;
  slidingTeeth: number;
  settingTeeth: number;
}

interface Scored extends Try {
  worst: number;
  worstName: string;
  windingRadius: number;
  sliding: number;
  setting: number;
  ratchet: number;
  meshDepth: number;
  settingAt: { x: number; y: number };
  checks: Array<[string, number]>;
}

function score(t: Try): Scored | null {
  const windingRadius = (t.windingTeeth * MODULE) / 2;
  const windingTip = windingRadius + 1.25 * MODULE;

  const sliding = (t.slidingTeeth * t.module2) / 2;
  const setting = (t.settingTeeth * t.module2) / 2;
  const slidingTip = sliding + 1.2 * t.module2;
  const settingTip = setting + 1.25 * t.module2;

  // The crown wheel's underside is where the winding pinion's pitch cylinder touches it.
  const under = t.stem + windingRadius;
  const mesh = t.stem + windingTip - under;

  // The ratchet shares the crown wheel's teeth, so it can sit anywhere that still overlaps
  // them; put it as low as it can go while letting the winding pinion's tips past.
  const ratchet = t.stem + windingTip + 0.15 + 0.06;

  const slidingIn = SPOT.windingPinion.x + CLUTCH;
  const slidingOut = slidingIn + t.pull;
  const gap = setting + sliding;
  if (t.offset >= gap) return null;
  const settingAt = { x: slidingOut + t.offset, y: -Math.sqrt(gap * gap - t.offset * t.offset) };
  const reach = Math.abs(settingAt.y);

  const checks: Array<[string, number]> = [
    ['winding pinion over the barrel', t.stem - windingTip - BARREL_TOP],
    ['stem over the barrel', t.stem - t.rod - BARREL_TOP],
    ['sliding pinion under the crown wheel', under - (t.stem + slidingTip)],
    ['sliding pinion has metal round its bore', sliding - 1.5 * t.module2 - t.rod],
    ['winding pinion has metal round its bore', windingRadius - 1.15 * MODULE - t.rod],
    ['setting wheel clears the stem', reach - settingTip - t.rod],
    ['setting arbor clears the barrel', Math.hypot(settingAt.x - B.x, reach + B.y) - BARREL_TIP - ARBOR],
    ['setting wheel inside the case', CASE - (Math.hypot(settingAt.x, settingAt.y) + settingTip)],
    ['setting wheel lets go when the crown is in', Math.hypot(settingAt.x - slidingIn, settingAt.y) - gap],
    ['setting wheel under the crown wheel', under - (t.stem + 0.17)],
  ];

  // Two things here are the same number whatever the sweep does — the mesh is one addendum
  // deep and the ratchet's grip on the crown wheel is whatever the crown wheel's thickness
  // leaves over. Both are requirements, not things to maximise; leaving them in the
  // objective just pins the score to their own constant value and makes every feasible
  // point look identical, which is exactly what happened the first two times.
  if (mesh < 0.1) return null;
  if (under + THICK.crownWheel - (ratchet - 0.15) < 0.3) return null;

  let worst = Infinity;
  let worstName = '';
  for (const [name, value] of checks) {
    if (value < worst) {
      worst = value;
      worstName = name;
    }
  }
  return { ...t, worst, worstName, windingRadius, sliding, setting, ratchet, meshDepth: mesh, settingAt, checks };
}

/**
 * Room first, but only up to a point: a tenth of a millimetre of air is as good as a
 * millimetre in a watch, and buying more of it with a crown that pulls out two and a half
 * millimetres, or a movement half a millimetre taller, is a bad trade. So the clearance
 * saturates and the leftovers go on keeping the crown's travel and the stack down, and on
 * a stem thick enough to look like it could be turned without bending.
 */
const rank = (s: Scored): number =>
  Math.min(s.worst, 0.13) * 100 - s.pull * 2 - s.ratchet * 5 + s.rod * 3;

const range = (from: number, to: number, step: number): number[] => {
  const out: number[] = [];
  for (let v = from; v <= to + 1e-9; v += step) out.push(Number(v.toFixed(4)));
  return out;
};

let best: Scored | null = null;
let tried = 0;
for (const windingTeeth of range(8, 13, 1)) {
  for (const stem of range(2.05, 2.7, 0.05)) {
    for (const module2 of range(0.07, 0.13, 0.01)) {
      for (const slidingTeeth of range(9, 16, 1)) {
        for (const settingTeeth of range(20, 40, 2)) {
          for (const rod of range(0.2, 0.36, 0.02)) {
            for (const pull of range(1.2, 1.8, 0.1)) {
              for (const offset of range(0.1, 1.0, 0.05)) {
                tried += 1;
                const got = score({ windingTeeth, stem, rod, pull, offset, module2, slidingTeeth, settingTeeth });
                if (got && (!best || rank(got) > rank(best))) best = got;
              }
            }
          }
        }
      }
    }
  }
}

console.log(`tried ${tried.toLocaleString()} combinations\n`);

if (!best) {
  console.log('nothing fits.');
} else {
  console.log('--- the roomiest keyless works ---');
  console.log(`  winding pinion        ${best.windingTeeth} teeth on r ${best.windingRadius.toFixed(3)}`);
  console.log(`  winding module        ${MODULE.toFixed(4)}  (shared with the crown wheel and ratchet)`);
  console.log(`  setting module        ${best.module2.toFixed(4)}`);
  console.log(`  sliding pinion        ${best.slidingTeeth} teeth on r ${best.sliding.toFixed(3)}`);
  console.log(`  setting wheel         ${best.settingTeeth} teeth on r ${best.setting.toFixed(3)}`);
  console.log(`  stem radius           ${best.rod.toFixed(3)}`);
  console.log(`  crown pull            ${best.pull.toFixed(2)}`);
  console.log(`  setting offset        ${best.offset.toFixed(2)}`);
  console.log(`  setting wheel at      ${best.settingAt.x.toFixed(3)}, ${best.settingAt.y.toFixed(3)}`);
  console.log('');
  console.log(`  Z.stem                ${best.stem.toFixed(3)}`);
  console.log(`  crown wheel underside ${(best.stem + best.windingRadius).toFixed(3)}`);
  console.log(`  Z.crownWheel          ${(best.stem + best.windingRadius + THICK.crownWheel / 2).toFixed(3)}`);
  console.log(`  Z.ratchet             ${best.ratchet.toFixed(3)}`);
  console.log(`  mesh depth            ${best.meshDepth.toFixed(3)}`);
  console.log('');
  console.log(`  tightest clearance    ${best.worst.toFixed(3)} mm — ${best.worstName}`);

  console.log('\n--- every clearance at that point ---');
  for (const [name, value] of best.checks) {
    console.log(`  ${name.padEnd(44)} ${value.toFixed(3)}`);
  }
}
