/**
 * Where everything is.
 *
 * A mesh between two wheels fixes one thing absolutely: the distance between their
 * arbors, which is the sum of the two pitch radii and nothing else. So the plan of a
 * movement is a chain of rigid links with free joints, and laying one out is choosing the
 * angles. These angles came out of a search (`solve.ts`) against the obvious constraints —
 * everything inside the case, no two arbors on top of each other, the escapement not
 * buried under the barrel — which is roughly the problem a movement designer has, minus
 * about forty others.
 *
 * Two happy accidents in the result are worth pointing at: the fourth wheel lands at very
 * nearly exactly six o'clock, which is where a subsidiary seconds dial wants to be, and
 * the crown wheel lands on the stem's axis, which it has to, because a bevel pair only
 * works if the two axes actually meet.
 *
 * Millimetres throughout. The movement is 27 mm across, which is a normal size for a
 * hand-wound wristwatch.
 */
import { KEYLESS, MOTION_WORK, TRAIN } from './movement';

export interface Spot {
  x: number;
  y: number;
}

const D = Math.PI / 180;

export const CASE_RADIUS = 13.5;

/** Pitch radii. Each pair that meshes shares a module; different pairs need not. */
export const R = {
  barrel: 5.6,
  centre: 3.5,
  third: 2.9,
  fourth: 2.5,
  escape: 2.1,
  balance: 3.3,
  ratchet: 2.4,
  crownWheel: 1.6,
  windingPinion: 0.95,
  slidingPinion: 0.72,
  settingWheel: 1.5,
  roller: 0.78,

  // The automatic work. Each pair shares a module, as any pair that means to mesh must:
  // 1/9 for the rotor pinion into the reduction wheel, 0.13 for the reduction pinion into
  // the reversing wheel, and 2/15 for the reversing pinion into the ratchet.
  rotorPinion: 0.5,
  reduction: 2.5,
  reductionPinion: 0.52,
  reversing: 2.6,
  reversingPinion: 0.6,

  /** The rotor itself, which is nearly as big as the movement and deliberately so. */
  rotor: 12.2,
} as const;

/** Pinion pitch radii, each one the wheel it meshes with divided by the step-up. */
export const PINION = {
  centre: R.barrel / (TRAIN.barrel / TRAIN.centrePinion),
  third: R.centre / (TRAIN.centre / TRAIN.thirdPinion),
  fourth: R.third / (TRAIN.third / TRAIN.fourthPinion),
  escape: R.fourth / (TRAIN.fourth / TRAIN.escapePinion),
} as const;

function step(from: Spot, distance: number, bearing: number): Spot {
  return { x: from.x + distance * Math.cos(bearing), y: from.y + distance * Math.sin(bearing) };
}

const CENTRE: Spot = { x: 0, y: 0 };
const BARREL = step(CENTRE, R.barrel + PINION.centre, 22.0 * D);
const THIRD = step(CENTRE, R.centre + PINION.third, -133.36 * D);
const FOURTH = step(THIRD, R.third + PINION.fourth, -34.64 * D);
const ESCAPE = step(FOURTH, R.fourth + PINION.escape, -168.0 * D);
/** Escape wheel, pallet staff and balance staff are collinear, as a lever escapement is. */
const PALLET = step(ESCAPE, 3.0, 180 * D);
const BALANCE = step(PALLET, 2.6, 180 * D);

/**
 * The crown wheel has to sit where the stem's axis crosses its own, and at exactly the
 * right distance from the ratchet wheel. Both conditions at once leave no freedom at all:
 * given the barrel's position, there is one place it can go.
 */
const CROWN_WHEEL: Spot = {
  x: BARREL.x + Math.sqrt((R.ratchet + R.crownWheel) ** 2 - BARREL.y ** 2),
  y: 0,
};

/** The winding pinion meets the crown wheel's underside one pitch radius inboard of it. */
const WINDING_PINION: Spot = { x: CROWN_WHEEL.x - R.crownWheel, y: 0 };

/**
 * The sliding pinion's two homes. Pushed in it couples to the winding pinion and the crown
 * winds the mainspring; pulled out it lets go of that and takes up with the setting wheel
 * instead, and the crown moves the hands. One part, slid less than a millimetre and a half,
 * changes what the crown is for — which is the whole trick of a keyless watch, and the
 * reason they are called keyless.
 */
export const SLIDING_IN = WINDING_PINION.x + 0.68;
export const SLIDING_OUT = SLIDING_IN + 1.5;

/**
 * The setting wheel sits where it is tangent to the sliding pinion when the crown is out
 * and clear of it when the crown is in, which means it has to be *outboard* of the
 * engaged position rather than beside it.
 */
const SETTING: Spot = (() => {
  const x = SLIDING_OUT + 0.55;
  const gap = R.settingWheel + R.slidingPinion;
  return { x, y: Math.sqrt(gap * gap - (x - SLIDING_OUT) ** 2) };
})();

/**
 * The motion work, sized by the one constraint that ties it to everything else: the
 * setting wheel's lower pinion has to reach the minute wheel, and the minute wheel has to
 * be exactly four cannon-pinion radii from the middle of the watch.
 *
 * Working it backwards, with d the centre-to-minute-wheel distance: the cannon pinion is
 * d/4 because the minute wheel has three times its teeth, the minute wheel is 3d/4, and
 * the setting pinion is whatever is left of the run out to the setting wheel.
 */
const SETTING_REACH = Math.hypot(SETTING.x, SETTING.y);
const MOTION_D = (SETTING_REACH - 0.8) / 1.75;

export const MOTION = {
  /** On the centre arbor, a friction fit, one turn an hour: the minute hand's own wheel. */
  cannon: MOTION_D / 4,
  minuteWheel: (MOTION_D * 3) / 4,
  /** Coaxial with the minute wheel and driving the hour wheel twelve times slower. */
  minutePinion: MOTION_D / 5,
  hourWheel: (MOTION_D * 4) / 5,
  settingPinion: SETTING_REACH - MOTION_D - (MOTION_D * 3) / 4,
} as const;

/** The minute wheel lies on the line from the centre of the watch out to the setting wheel. */
const MINUTE_WHEEL: Spot = {
  x: (SETTING.x / SETTING_REACH) * MOTION_D,
  y: (SETTING.y / SETTING_REACH) * MOTION_D,
};

/** The click pivots off to one side of the ratchet wheel and drops between its teeth. */
const CLICK = step(BARREL, R.ratchet + 0.52, 200 * D);

/** The balance cock is footed clear of the balance and reaches back over its middle. */
const COCK_FOOT = step(BALANCE, R.balance + 0.95, 55 * D);

/**
 * The automatic work, which is the same kind of problem as the going train and rather more
 * constrained, because both of its ends are already nailed down. The rotor turns about the
 * middle of the watch and the ratchet wheel is on the barrel arbor, so the chain between
 * them has three fixed link lengths and only one free angle. Sweeping that angle
 * (`auto-solve.ts`) and asking which setting leaves the most room put it at 141.5°, which
 * drops the module into the empty quadrant above the barrel and keeps both new pivots
 * about 1.7 mm clear of the click's.
 *
 * What it is *not* constrained by is most of the movement. The automatic work sits above
 * everything else and sails straight over the ratchet, the click, the crown wheel and half
 * the going train without touching any of it — which is why a module like this can be
 * bolted onto a hand-wound calibre, and why so many of them were.
 */
const REVERSING = step(BARREL, R.reversingPinion + R.ratchet, 141.5 * D);

/**
 * And the reduction wheel follows from it: the one point at the right distance from both
 * the rotor's arbor and the reversing wheel's. Two circles, two crossings, and the one
 * taken is the one further from the click.
 */
const REDUCTION: Spot = (() => {
  const toRotor = R.rotorPinion + R.reduction;
  const toReversing = R.reductionPinion + R.reversing;
  const span = Math.hypot(REVERSING.x, REVERSING.y);
  const along = (toRotor * toRotor - toReversing * toReversing + span * span) / (2 * span);
  const off = Math.sqrt(Math.max(0, toRotor * toRotor - along * along));
  const ux = REVERSING.x / span;
  const uy = REVERSING.y / span;
  return { x: along * ux - off * uy, y: along * uy + off * ux };
})();

export const SPOT = {
  centre: CENTRE,
  barrel: BARREL,
  third: THIRD,
  fourth: FOURTH,
  escape: ESCAPE,
  pallet: PALLET,
  balance: BALANCE,
  crownWheel: CROWN_WHEEL,
  windingPinion: WINDING_PINION,
  setting: SETTING,
  minuteWheel: MINUTE_WHEEL,
  click: CLICK,
  cockFoot: COCK_FOOT,
  reduction: REDUCTION,
  reversing: REVERSING,
} as const;

/**
 * Heights above the main plate's top face.
 *
 * These are the other half of the layout and they do as much work as the plan does. A
 * movement is a flat thing crammed into four millimetres, and wheels whose bodies overlap
 * in plan — which in here is most of them — only avoid each other because they are at
 * different levels. A wheel and the pinion it drives must share a level; a wheel and the
 * pinion on its own arbor must not.
 */
export const Z = {
  handMinute: -2.62,
  handSecond: -2.5,
  handHour: -2.42,
  dial: -2.1,
  hourWheel: -1.55,
  minutePinion: -1.55,
  minuteWheel: -1.2,
  cannon: -1.2,
  settingPinion: -1.2,
  plate: -0.3,

  escapeWheel: 0.28,
  pallet: 0.28,
  roller: 0.28,
  centreWheel: 0.5,
  thirdPinion: 0.5,
  fourthWheel: 0.85,
  escapePinion: 0.85,
  barrelTeeth: 0.9,
  centrePinion: 0.9,
  thirdWheel: 1.35,
  fourthPinion: 1.35,
  barrelLid: 1.5,
  stem: 1.0,
  setting: 1.0,
  bridge: 1.77,
  ratchet: 2.1,
  crownWheel: 2.1,
  click: 2.1,
  balanceWheel: 2.75,
  // Clear of the top of the balance arms at 3.00 and the underside of the cock at 3.27.
  // The hairspring is 0.22 tall, so anything that overlaps it by even a few hundredths
  // shows up as a stripe of z-fighting running the length of the arm.
  hairspring: 3.14,
  cock: 3.42,

  // The automatic work, stacked upwards from the ratchet wheel it drives. Each wheel sits
  // at the level of the pinion that turns it and carries its own pinion at the next level
  // down, so the whole module climbs half a millimetre a stage and ends up above the
  // balance cock — where the rotor has to be anyway, since it sweeps over everything.
  reversingPinion: 2.1,
  reversingWheel: 2.62,
  reductionPinion: 2.62,
  reductionWheel: 3.16,
  rotorPinion: 3.16,
  // Underside at 3.70, against the top of the balance cock at 3.57. That is a third of a
  // millimetre, which sounds like nothing and is what the whole watch has to spare.
  rotor: 3.95,
} as const;

export const THICK = {
  wheel: 0.22,
  pinion: 0.62,
  plate: 0.6,
  bridge: 0.3,
  dial: 0.35,
  hand: 0.12,
  barrelWall: 1.2,
  escape: 0.16,
  pallet: 0.2,
  balanceRim: 0.5,
  hairspring: 0.22,
  mainspring: 1.0,
  /** The rotor is thin in the arm and thick in the weight; this is the arm. */
  rotor: 0.5,
  rotorWeight: 1.5,
} as const;

/** The stem runs out to three o'clock. The crown is the only part outside the case. */
export const STEM = { start: 5.6, end: 15.6, radius: 0.34, crownAt: 14.4, crownRadius: 1.55 } as const;

/** How far the crown and stem shift when you pull the crown out. */
export const CROWN_PULL = SLIDING_OUT - SLIDING_IN;

// ---------------------------------------------------------------- the parts list

export type Group = 'power' | 'auto' | 'train' | 'escapement' | 'keyless' | 'dial' | 'frame';

export interface PartInfo {
  id: string;
  label: string;
  group: Group;
  note: string;
}

/**
 * Everything you can select, with the one sentence that says what it is for. The order is
 * the order power travels: out of the mainspring, through the train, into the escapement,
 * and back out to the hands, with the frame and the winding works either side.
 */
export const PARTS: PartInfo[] = [
  {
    id: 'mainspring',
    label: 'Mainspring',
    group: 'power',
    note: 'A coiled strip of steel about 40 cm long. Winding it adds a turn of tension per turn of the arbor, and everything else in the watch is paid for out of it.',
  },
  {
    id: 'barrel',
    label: 'Barrel',
    group: 'power',
    note: 'The drum the mainspring lives in. Its outer teeth are the first wheel of the train, so the barrel is both the container and the driver.',
  },
  {
    id: 'ratchet',
    label: 'Ratchet wheel',
    group: 'power',
    note: 'Screwed to the barrel arbor. Winding turns it; the click stops it turning back.',
  },
  {
    id: 'click',
    label: 'Click and spring',
    group: 'power',
    note: 'A pawl held against the ratchet by a spring. The only thing between a wound mainspring and the crown spinning out of your fingers.',
  },
  {
    id: 'rotor',
    label: 'Rotor',
    group: 'auto',
    note: 'A half-disc of tungsten on a ball race, free to turn either way. It does not spin because the wrist spins it — it stays still while the watch turns underneath, and that difference is the winding.',
  },
  {
    id: 'reduction',
    label: 'Reduction wheel',
    group: 'auto',
    note: 'First of two reductions between the rotor and the barrel. Together they give 100 rotor turns per turn of the arbor, which is what makes a few grams of metal strong enough to pull against a mainspring.',
  },
  {
    id: 'reversing',
    label: 'Reversing wheel',
    group: 'auto',
    note: 'The part that lets the rotor wind both ways. Whichever way it turns, one pawl bites and the other free-wheels, so the ratchet wheel only ever goes the winding way.',
  },
  {
    id: 'bridle',
    label: 'Slipping bridle',
    group: 'auto',
    note: 'The mainspring’s outer end, pressed against the barrel wall by friction rather than hooked to it. When the spring is full the rotor keeps winding and the end simply slips, which is the only reason a rotor cannot burst a mainspring.',
  },
  {
    id: 'centre',
    label: 'Centre wheel',
    group: 'train',
    note: 'One turn an hour, by construction — every tooth count in the train was chosen to make this exact. The minute hand hangs off its arbor.',
  },
  {
    id: 'third',
    label: 'Third wheel',
    group: 'train',
    note: 'An idler. It exists because the fourth wheel has to turn sixty times faster than the centre wheel and no single pair of wheels can do that.',
  },
  {
    id: 'fourth',
    label: 'Fourth wheel',
    group: 'train',
    note: 'One turn a minute, and so the seconds hand. It ended up almost exactly at six o’clock, which is where a subsidiary seconds dial belongs.',
  },
  {
    id: 'escapeWheel',
    label: 'Escape wheel',
    group: 'escapement',
    note: 'Ten turns a minute, and the only wheel whose teeth never mesh with anything. Each tooth is locked, released and locked again twice per turn.',
  },
  {
    id: 'pallet',
    label: 'Pallet fork',
    group: 'escapement',
    note: 'Two jewels and a slot. It holds the whole train still, lets exactly one tooth past per beat, and passes the energy on to the balance.',
  },
  {
    id: 'balance',
    label: 'Balance wheel',
    group: 'escapement',
    note: 'The timekeeper. It swings 2.5 times a second and nothing but the hairspring decides how fast — the escapement’s job is only to keep it swinging.',
  },
  {
    id: 'hairspring',
    label: 'Hairspring',
    group: 'escapement',
    note: 'A spiral of steel a hundredth of a millimetre thick. Its torque is proportional to angle over three hundred degrees, which is what makes the rate independent of the amplitude.',
  },
  {
    id: 'stem',
    label: 'Stem and crown',
    group: 'keyless',
    note: 'Pushed in it winds; pulled out it sets. Turning it the wrong way does nothing at all, because the winding pinion’s teeth are cut to slip.',
  },
  {
    id: 'windingPinion',
    label: 'Winding pinion',
    group: 'keyless',
    note: 'Runs loose on the stem and drives the crown wheel through a bevel. It is coupled to the sliding pinion by facing ratchet teeth, which is why winding backwards just clicks.',
  },
  {
    id: 'slidingPinion',
    label: 'Sliding pinion',
    group: 'keyless',
    note: 'The part that does the switching. Pulling the crown slides it out of the winding pinion and into the setting wheel.',
  },
  {
    id: 'crownWheel',
    label: 'Crown wheel',
    group: 'keyless',
    note: 'An idler between the winding pinion and the ratchet wheel. Its tooth count cancels out; it is there to reverse the direction so the click can hold.',
  },
  {
    id: 'setting',
    label: 'Setting wheel',
    group: 'keyless',
    note: 'Engaged only when the crown is out. It reaches through the plate to the minute wheel and moves the hands without touching the train.',
  },
  {
    id: 'motion',
    label: 'Motion work',
    group: 'dial',
    note: 'Cannon pinion, minute wheel and hour wheel: a 12:1 reduction under the dial. The cannon pinion is only a friction fit, which is how the hands can be moved while the watch runs.',
  },
  {
    id: 'dial',
    label: 'Dial',
    group: 'dial',
    note: 'The only part of a watch most people ever see.',
  },
  {
    id: 'hands',
    label: 'Hands',
    group: 'dial',
    note: 'Hour and minute off the cannon pinion, seconds straight off the fourth wheel — which is why setting the time slides the other two past the seconds hand.',
  },
  {
    id: 'plate',
    label: 'Main plate',
    group: 'frame',
    note: 'The floor of the watch. Every pivot in the movement has its lower bearing in here.',
  },
  {
    id: 'bridges',
    label: 'Bridges',
    group: 'frame',
    note: 'The ceiling, in pieces, so that any one wheel can be taken out without dismantling the rest.',
  },
  {
    id: 'cock',
    label: 'Balance cock',
    group: 'frame',
    note: 'A bridge with one foot, carrying the balance’s upper pivot and the stud the hairspring’s outer end is pinned to.',
  },
  {
    id: 'jewels',
    label: 'Jewels',
    group: 'frame',
    note: 'Synthetic ruby bearings. Hard, smooth, and they hold oil where a brass hole would let it creep away.',
  },
];

export const GROUP_NAMES: Record<Group, string> = {
  power: 'Power',
  auto: 'Automatic winding',
  train: 'Going train',
  escapement: 'Escapement',
  keyless: 'Winding and setting',
  dial: 'Dial side',
  frame: 'Frame',
};

export const GROUP_ORDER: Group[] = [
  'power',
  'auto',
  'train',
  'escapement',
  'keyless',
  'dial',
  'frame',
];

export { D, KEYLESS, MOTION_WORK };
