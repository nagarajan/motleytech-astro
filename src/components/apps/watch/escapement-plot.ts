/**
 * Scratch harness. Draws the escapement in plan, at the poses the physics actually puts it
 * in, so the question "do the pallet stones meet the escape wheel teeth where they should"
 * can be looked at instead of argued about.
 *
 * Writes an SVG. Everything is in millimetres in the pallet's own frame: pivot at the
 * origin, escape wheel out along +X, balance out along −X.
 *
 *   ./run.sh escapement-plot.ts > /tmp/escapement.svg
 */
import { PALLET_STONES, R, SPOT, STONE, type Spot } from './layout';
import { palletForkGeometry } from './parts';
import { Movement, TRAIN } from './movement';

const TAU = Math.PI * 2;
const ESC: Spot = { x: SPOT.escape.x - SPOT.pallet.x, y: SPOT.escape.y - SPOT.pallet.y };

// The same tooth table escapeWheelGeometry draws from: [radius fraction, fraction of pitch].
const TOOTH: Array<[number, number]> = [
  [0.7, -0.36],
  [0.88, -0.33],
  [0.97, -0.3],
  [1.0, -0.275], // locking corner
  [1.0, -0.075], // heel of the impulse face
  [0.93, -0.05],
  [0.8, 0.02],
  [0.71, 0.1],
];

const turn = (p: Spot, a: number): Spot => ({
  x: Math.cos(a) * p.x - Math.sin(a) * p.y,
  y: Math.sin(a) * p.x + Math.cos(a) * p.y,
});
const shift = (p: Spot, by: Spot): Spot => ({ x: p.x + by.x, y: p.y + by.y });

function escapeTeeth(spin: number): Spot[][] {
  const pitch = TAU / TRAIN.escape;
  const out: Spot[][] = [];
  for (let i = 0; i < TRAIN.escape; i++) {
    out.push(
      TOOTH.map(([r, a]) => {
        const angle = spin + i * pitch + a * pitch;
        return shift({ x: Math.cos(angle) * r * R.escape, y: Math.sin(angle) * r * R.escape }, ESC);
      }),
    );
  }
  return out;
}

/** The lever's outline, straight from the geometry the scene extrudes. */
function forkOutline(): Spot[] {
  return palletForkGeometry().getPoints(1);
}

/** A pallet stone, as scene.ts places it. */
function stone(which: 0 | 1, spin: number): Spot[] {
  const { at, tilt } = PALLET_STONES[which];
  const [hx, hy] = [STONE.length / 2, STONE.thick / 2];
  return [
    { x: hx, y: hy },
    { x: hx, y: -hy },
    { x: -hx, y: -hy },
    { x: -hx, y: hy },
  ].map((p) => turn(shift(turn(p, tilt), at), spin));
}

// ------------------------------------------------------------------ the poses

/**
 * Run the watch and grab it at the moments that matter: the lever hard over on each
 * banking with a tooth locked, and the middle of each impulse.
 */
const watch = new Movement();
watch.setWind(3);
const frames: { label: string; escape: number; fork: number }[] = [];
let lastPhase = '';
for (let i = 0; i < 400000 && frames.length < 4; i++) {
  watch.advance(1 / 60000);
  const p = watch.pose();
  const phase = watch.read().phase;
  if (phase !== lastPhase && (phase === 'locked' || phase === 'impulse')) {
    frames.push({ label: phase, escape: p.escape, fork: p.fork });
  }
  lastPhase = phase;
}

// ------------------------------------------------------------------ the numbers

/** Closest approach between two convex-ish outlines, negative when they overlap. */
function gap(a: Spot[], b: Spot[]): number {
  const edge = (pts: Spot[]) => pts.map((p, i) => [p, pts[(i + 1) % pts.length]] as const);
  let best = Infinity;
  for (const [p0, p1] of edge(a)) {
    for (let s = 0; s <= 20; s++) {
      const p = { x: p0.x + ((p1.x - p0.x) * s) / 20, y: p0.y + ((p1.y - p0.y) * s) / 20 };
      for (const [q0, q1] of edge(b)) {
        for (let t = 0; t <= 20; t++) {
          const q = { x: q0.x + ((q1.x - q0.x) * t) / 20, y: q0.y + ((q1.y - q0.y) * t) / 20 };
          best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y));
        }
      }
    }
  }
  return best;
}

const radius = (p: Spot) => Math.hypot(p.x - ESC.x, p.y - ESC.y);

console.error('pose            stone   radius span     past tip   nearest tooth');
for (const f of frames) {
  const forkAt = Math.PI + f.fork;
  const teeth = escapeTeeth(f.escape);
  for (const side of [0, 1] as const) {
    const s = stone(side, forkAt);
    const rs = s.map(radius);
    const [lo, hi] = [Math.min(...rs), Math.max(...rs)];
    const near = Math.min(...teeth.map((t) => gap(s, t)));
    console.error(
      `${`${f.label} ${((f.fork * 180) / Math.PI).toFixed(0)}°`.padEnd(15)} ` +
        `${side === 0 ? 'upper ' : 'lower '}  ${lo.toFixed(2)}..${hi.toFixed(2)}   ` +
        `${(R.escape - lo).toFixed(3).padStart(7)}     ${near.toFixed(3)}`,
    );
  }
}
console.error(`\ntip circle ${R.escape}, tooth pitch ${(360 / TRAIN.escape).toFixed(1)}°, tooth depth ${(R.escape * 0.3).toFixed(2)}`);

/**
 * The four poses above are the interesting ones, but they prove nothing about the moments
 * in between. So run a couple of beats and watch every frame: a stone may touch a tooth,
 * and had better, but it must never be found inside one.
 */
const run = new Movement();
run.setWind(3);
let bite = Infinity;
let touching = 0;
let frames2 = 0;
for (let i = 0; i < 2400; i++) {
  run.advance(1 / 1200);
  const p = run.pose();
  const forkAt = Math.PI + p.fork;
  const teeth = escapeTeeth(p.escape);
  let closest = Infinity;
  for (const which of [0, 1] as const) {
    const s = stone(which, forkAt);
    // Only teeth anywhere near are worth the full outline test.
    for (const t of teeth) {
      if (Math.hypot(t[3].x - s[0].x, t[3].y - s[0].y) > 1.2) continue;
      closest = Math.min(closest, gap(s, t));
    }
  }
  if (closest < Infinity) {
    frames2++;
    bite = Math.min(bite, closest);
    if (closest < 0.02) touching++;
  }
}
console.error(
  `\nover two beats: closest a stone came to being inside a tooth ${bite.toFixed(3)} mm` +
    `  (touching in ${((100 * touching) / frames2).toFixed(0)}% of ${frames2} frames)`,
);
console.error(bite < -0.01 ? 'STONES ARE CUTTING THROUGH THE TEETH' : 'no interpenetration');

// ------------------------------------------------------------------ the drawing

const W = 620;
const H = 500;

/** One drawing of the escapement, centred where it is worth looking. */
function panel(f: (typeof frames)[number], note: string, mid: Spot, scale: number): string {
  const forkAt = Math.PI + f.fork;
  const px = (p: Spot) => `${(W / 2 + (p.x - mid.x) * scale).toFixed(1)},${(H / 2 - (p.y - mid.y) * scale).toFixed(1)}`;
  const poly = (pts: Spot[], fill: string, stroke: string) =>
    `<polygon points="${pts.map(px).join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="1"/>`;
  return `<g>
    <rect width="${W}" height="${H}" fill="#fbfbfd" stroke="#ccd"/>
    <text x="14" y="26" font-family="monospace" font-size="15" fill="#334">${f.label} ${((f.fork * 180) / Math.PI).toFixed(0)}°  ${note}</text>
    <circle cx="${(W / 2 + (ESC.x - mid.x) * scale).toFixed(1)}" cy="${(H / 2 + mid.y * scale).toFixed(1)}" r="${R.escape * scale}" fill="none" stroke="#c66" stroke-dasharray="4 4"/>
    ${escapeTeeth(f.escape)
      .map((t) => poly(t, '#e8e8ea', '#888'))
      .join('\n    ')}
    ${poly(
      forkOutline().map((p) => turn(p, forkAt)),
      '#b9c2cc',
      '#556',
    )}
    ${poly(stone(0, forkAt), '#d2405a', '#801')}
    ${poly(stone(1, forkAt), '#d2405a', '#801')}
  </g>`;
}

/** Whichever stone is in among the teeth is the one worth zooming on. */
const engaged = (f: (typeof frames)[number]): Spot => {
  const forkAt = Math.PI + f.fork;
  const both = [stone(0, forkAt), stone(1, forkAt)];
  const deepest = both.reduce((a, b) =>
    Math.min(...a.map(radius)) < Math.min(...b.map(radius)) ? a : b,
  );
  return {
    x: deepest.reduce((t, p) => t + p.x, 0) / 4,
    y: deepest.reduce((t, p) => t + p.y, 0) / 4,
  };
};

const rows = frames.map(
  (f, i) =>
    `<g transform="translate(0,${i * H})">${panel(f, 'whole', { x: ESC.x - 0.4, y: 0 }, 105)}</g>` +
    `<g transform="translate(${W},${i * H})">${panel(f, 'at the stone', engaged(f), 520)}</g>`,
);

console.log(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W * 2}" height="${H * frames.length}">${rows.join('\n')}</svg>`,
);
