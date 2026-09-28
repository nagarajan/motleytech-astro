/**
 * The explosion itself: where the burning fronts are, when each parcel of gas catches
 * fire, what it turns into, and how fast the whole thing flies apart.
 *
 * This is an animation rather than a simulation, and the distinction is worth being
 * honest about. Nothing here solves the equations of hydrodynamics. What it does instead
 * is take the quantities that a real calculation would produce — the structure of the
 * star, the speed a flame travels at a given density, the ash that burning makes at a
 * given density, the binding energy that has to be paid before anything can escape — and
 * march them forward on a scripted timeline. Every number that matters is a real one. The
 * choreography between them is arranged rather than derived.
 *
 * The payoff is that the entire two seconds can be worked out in a few milliseconds and
 * then scrubbed back and forth instantly, which is the point of the thing.
 *
 * ## Geometry
 *
 * The state lives on a grid of radius by polar angle. The angle is not decoration. In the
 * delayed detonation the flame ignites off centre and floats upward, so it is lopsided
 * from the first instant. In the double detonation the asymmetry *is* the mechanism: a
 * detonation starts at one point on the surface, runs around the star, and drives a shock
 * inward that converges somewhere other than the middle. Neither can be told on a radial
 * grid alone.
 */

import { FOE, M_SUN, SPECIES_COUNT, SP_CO, SP_HE } from './constants';
import { ashFor, energyBetween, QUENCH_DENSITY, type Front } from './burn';
import { buildWhiteDwarf, NEAR_CHANDRA, SUB_CHANDRA, soundSpeedOf, type WhiteDwarf } from './star';

export type Scenario = 'delayed' | 'double';

export type Phase =
  | 'simmering'
  | 'deflagration'
  | 'transition'
  | 'detonation'
  | 'helium'
  | 'converging'
  | 'core'
  | 'expanding';

export const NR = 160;
export const NTHETA = 64;
const CELLS = NR * NTHETA;

/**
 * How long the story runs, and how finely the expansion history is sampled.
 *
 * Three seconds covers everything: the burning is finished a little after two, and the
 * last second is there to show the ejecta settling into the straight-line coasting that it
 * will keep up for the next few hundred years. Running longer only makes the star bigger,
 * and the star being bigger costs picture.
 */
const DURATION = 3.0; // s
const STEPS = 1200;
const DT = DURATION / STEPS;

// ------------------------------------------------------------------ flame physics

/**
 * Laminar flame speed in carbon–oxygen matter, cm/s.
 *
 * A deflagration is a *subsonic* front: it moves because heat leaks forward by ordinary
 * conduction and lights the next layer, which is a slow way to travel. At the centre of a
 * white dwarf that is around a hundred kilometres a second, which sounds fast until you
 * notice sound itself is going at nine thousand. The fit is the standard power law in
 * density from Timmes and Woosley: a hundred kilometres a second at 2 x 10^9, falling to
 * barely one by the time the density is down to 10^7.
 */
const laminarFlameSpeed = (density: number): number =>
  1.0e7 * Math.pow(density / 2e9, 0.805);

/**
 * Chapman–Jouguet detonation speed, cm/s.
 *
 * A detonation is the other kind of front entirely. It is a shock wave, it moves
 * supersonically, and it ignites the fuel by *compressing* it rather than by warming it
 * from the front. That is exactly the cascade this animation is about: the burning behind
 * the wave is what drives the wave, the wave is what compresses the next layer, and the
 * compression is what lights it. Each layer pays for the ignition of the next.
 *
 * The Chapman–Jouguet condition fixes the speed of such a self-sustaining wave from
 * nothing but the energy its own burning releases:
 *
 *     D^2 = c_s^2 + 2 (gamma^2 - 1) q
 *
 * with gamma = 4/3 for a relativistic gas. Carbon and oxygen going to nickel release about
 * 0.7 MeV per nucleon, which is 6.8 x 10^17 erg in every gram, and that alone puts the
 * wave at roughly ten thousand kilometres a second before the sound speed is even counted.
 */
const CJ_GAMMA_TERM = 2 * ((4 / 3) ** 2 - 1); // 1.5556

const Q_CARBON = 6.8e17; // erg/g, carbon and oxygen to iron group
const Q_HELIUM = 1.44e18; // erg/g, helium to calcium and titanium

const detonationSpeed = (density: number): number => {
  const cs = soundSpeedOf(density);
  return Math.sqrt(cs * cs + CJ_GAMMA_TERM * Q_CARBON);
};

/**
 * Helium detonations run half again as fast as carbon ones, because helium sits much lower
 * on the binding energy curve and so has much further to fall. That is also why the shell
 * can detonate when the core underneath it cannot.
 */
const heliumDetonationSpeed = (density: number): number => {
  const cs = soundSpeedOf(density);
  return Math.sqrt(cs * cs + CJ_GAMMA_TERM * Q_HELIUM);
};

/**
 * The density at which a subsonic flame gives way to a supersonic detonation.
 *
 * Nobody has a first-principles derivation of this number, which is the largest single
 * piece of guesswork in the whole delayed detonation picture. What is known is that a pure
 * deflagration releases far too little energy and leaves far too much unburnt carbon at
 * the centre to match any observed Type Ia, and that a transition somewhere near 10^7
 * g/cm^3 fixes both problems at once and lands the yields on the observed ones. A 2026
 * direct numerical simulation narrowed the specifically oxygen-driven route to between 3.1
 * and 3.6 x 10^7, but the classical value is what reproduces the spectra, so that is what
 * is used here.
 */
const DDT_DENSITY = 1.0e7;

// ------------------------------------------------------------------ the burn map

/**
 * The part of the explosion that never changes: for every cell of the grid, the instant it
 * catches fire and what it turns into. Worked out once, then read back at whatever time
 * the viewer has scrubbed to.
 */
export interface BurnMap {
  scenario: Scenario;
  star: WhiteDwarf;

  /** Shell boundaries and cell centres of the cold star, cm. */
  r0: Float64Array;
  rMid: Float64Array;
  /** Cold density of each shell, g/cm^3. */
  rho0: Float64Array;
  /** Mass of each shell, g. */
  dm: Float64Array;

  /** When each cell burns, s. Infinity for cells that never do. */
  tBurn: Float64Array;
  /** Which kind of front got there first. */
  front: Uint8Array;
  /** What each cell ends up as, as mass fractions. */
  ash: Float32Array;
  /** What each cell started as. */
  fuel: Float32Array;

  /** Expansion history: radius of each shell boundary against time, [STEPS+1][NR+1]. */
  history: Float64Array;
  /** Front position against time, for drawing the wave itself. [STEPS+1][NTHETA]. */
  frontHistory: Float64Array;
  /** Which phase the star is in at each time sample. */
  phases: Phase[];

  /** Running totals, for the readouts. Doubles, because 10^51 does not fit in a float. */
  energyHistory: Float64Array;
  burnedHistory: Float64Array;

  /** Final tallies. */
  nuclearEnergy: number;
  kineticEnergy: number;
  yields: Record<string, number>;
  ddtTime: number;
  peakRadius: number;
}

const FRONT_NONE = 0;
const FRONT_DEFLAGRATION = 1;
const FRONT_DETONATION = 2;
const FRONT_HELIUM = 3;
const FRONT_KIND: Front[] = ['detonation', 'deflagration', 'detonation', 'helium'];

/**
 * Work the whole explosion out.
 *
 * One forward march through time. At each step the fronts advance through the star as it
 * currently is — which matters enormously, because the star is expanding underneath them
 * and the density ahead of a front is dropping while the front is trying to reach it. Any
 * cell the front crosses is marked burned at that instant, with ash chosen from the
 * density *at that instant*, and its nuclear energy is added to the budget. The budget in
 * turn drives the next step of the expansion. That loop, between burning and expansion, is
 * the whole of what makes a Type Ia the shape it is.
 */
export function buildBurnMap(scenario: Scenario, turbulence = 0.5): BurnMap {
  const spec = scenario === 'delayed' ? NEAR_CHANDRA : SUB_CHANDRA;
  const star = buildWhiteDwarf(spec.mass, spec.helium, NR);

  const r0 = Float64Array.from(star.r);
  const rho0 = Float64Array.from(star.rho);
  const dm = Float64Array.from(star.dm);
  const rMid = new Float64Array(NR);
  for (let i = 0; i < NR; i += 1) rMid[i] = 0.5 * (r0[i] + r0[i + 1]);

  const tBurn = new Float64Array(CELLS).fill(Infinity);
  const front = new Uint8Array(CELLS);
  const ash = new Float32Array(CELLS * SPECIES_COUNT);
  const fuel = new Float32Array(CELLS * SPECIES_COUNT);
  for (let i = 0; i < NR; i += 1) {
    const species = star.helium[i] ? SP_HE : SP_CO;
    for (let j = 0; j < NTHETA; j += 1) {
      const cell = (i * NTHETA + j) * SPECIES_COUNT;
      fuel[cell + species] = 1;
      // Until a cell burns, its ash is its fuel; cells that never burn keep this.
      ash[cell + species] = 1;
    }
  }

  const history = new Float64Array((STEPS + 1) * (NR + 1));
  const frontHistory = new Float64Array((STEPS + 1) * NTHETA);
  const energyHistory = new Float64Array(STEPS + 1);
  const burnedHistory = new Float64Array(STEPS + 1);
  const phases: Phase[] = [];

  // Current state of the expansion. `scale` is per shell boundary, so the star can expand
  // non-uniformly: the burnt inside pushes harder than the cold outside.
  const scale = new Float64Array(NR + 1).fill(1);
  const shellVel = new Float64Array(NR + 1);
  const vFinal = terminalVelocities(star);

  // Front positions, one radius per angle.
  const deflagration = new Float64Array(NTHETA);
  const detonationOut = new Float64Array(NTHETA).fill(-1);
  const detonationIn = new Float64Array(NTHETA).fill(-1);
  const heliumFront = new Float64Array(NTHETA).fill(-1);

  let coreIgnition = -1; // radius of the converging-shock focus, once it forms
  let coreTime = Infinity;
  let ddtTime = Infinity;
  let nuclear = 0;
  let burnedMass = 0;
  let peakRadius = star.radius;

  if (scenario === 'delayed') {
    // The flame does not start at the exact centre. Convection during the thousand-year
    // simmering phase carries the first ignition point some tens of kilometres off, and
    // which way it happens to go is the main thing that makes one of these explosions
    // differ from the next. In shell indices, a few zones out.
    for (let j = 0; j < NTHETA; j += 1) {
      const mu = Math.cos((j + 0.5) * (Math.PI / NTHETA));
      deflagration[j] = 4 * (1 + 0.55 * mu + 0.12 * Math.cos(5 * mu));
    }
  } else {
    // The helium shell lights at a single point on the surface, at the pole.
    heliumFront[0] = star.radius;
  }

  const heliumShell = firstHeliumShell(star);
  const ashBuf = new Float32Array(SPECIES_COUNT);

  for (let step = 0; step <= STEPS; step += 1) {
    const time = step * DT;

    // ---- record the current geometry before advancing anything
    for (let i = 0; i <= NR; i += 1) history[step * (NR + 1) + i] = r0[i] * scale[i];
    peakRadius = Math.max(peakRadius, r0[NR] * scale[NR]);

    const density = (i: number): number => {
      // Mass is conserved in each shell, so density falls as the cube of its expansion.
      const inner = scale[i];
      const outer = scale[i + 1];
      const v0 = r0[i + 1] ** 3 - r0[i] ** 3;
      const v1 = (r0[i + 1] * outer) ** 3 - (r0[i] * inner) ** 3;
      return (rho0[i] * v0) / Math.max(v1, 1e-30);
    };

    const radiusOf = (i: number): number => rMid[i] * 0.5 * (scale[i] + scale[i + 1]);

    /**
     * Current thickness of a shell. Fronts are tracked as positions in the *gas*, not in
     * space, and this is the conversion between the two. It matters more than it sounds:
     * once the star starts expanding, a front sitting at a fixed radius is actually
     * falling behind, because the fuel it was about to burn has already moved past it.
     */
    const thicknessOf = (i: number): number =>
      Math.max(r0[i + 1] * scale[i + 1] - r0[i] * scale[i], 1);

    // ---- ignite whatever the fronts have reached
    const burnCell = (i: number, j: number, kind: number): void => {
      const idx = i * NTHETA + j;
      if (tBurn[idx] !== Infinity) return;
      const rho = density(i);
      const flavour = FRONT_KIND[kind];
      if (rho < QUENCH_DENSITY[flavour]) return;

      tBurn[idx] = time;
      front[idx] = kind;
      ashFor(star.helium[i] ? 'helium' : flavour, rho, ashBuf, 0);

      const base = idx * SPECIES_COUNT;
      for (let s = 0; s < SPECIES_COUNT; s += 1) ash[base + s] = ashBuf[s];
      const released = energyBetween(fuel, ash, base);
      const cellMass = dm[i] / NTHETA;
      nuclear += released * cellMass;
      burnedMass += cellMass;
    };

    let phase: Phase = 'expanding';

    if (scenario === 'delayed') {
      phase = advanceDelayed(
        time,
        deflagration,
        detonationOut,
        detonationIn,
        density,
        thicknessOf,
        turbulence,
        burnCell,
        () => {
          if (ddtTime === Infinity) ddtTime = time;
        },
        ddtTime !== Infinity,
      );
    } else {
      const result = advanceDouble(
        time,
        heliumFront,
        detonationOut,
        density,
        radiusOf,
        heliumShell,
        coreTime,
        burnCell,
        star,
      );
      phase = result.phase;
      coreTime = result.coreTime;
      if (ddtTime === Infinity && result.coreTime !== Infinity) ddtTime = result.coreTime;
    }

    phases.push(phase);
    energyHistory[step] = nuclear;
    burnedHistory[step] = burnedMass;

    // Record the leading front as a radius, which is what the renderer draws.
    for (let j = 0; j < NTHETA; j += 1) {
      let radius = -1;
      if (scenario === 'delayed') {
        const index = Math.max(detonationOut[j], deflagration[j]);
        radius = index >= 0 && index < NR ? radiusOf(Math.floor(index)) : -1;
      } else {
        radius = Math.max(detonationOut[j], heliumFront[j]);
      }
      frontHistory[step * NTHETA + j] = radius;
    }

    if (step === STEPS) break;

    // ---- let the energy released so far push the star outward
    advanceExpansion(
      scale,
      shellVel,
      r0,
      star.totalMass,
      vFinal,
      nuclear,
      star.bindingEnergy,
      DT,
    );
  }

  const kinetic = Math.max(0, nuclear - star.bindingEnergy);
  return {
    scenario,
    star,
    r0,
    rMid,
    rho0,
    dm,
    tBurn,
    front,
    ash,
    fuel,
    history,
    frontHistory,
    phases,
    energyHistory,
    burnedHistory,
    nuclearEnergy: nuclear,
    kineticEnergy: kinetic,
    yields: tallyYields(ash, dm),
    ddtTime,
    peakRadius,
  };
}

// ------------------------------------------------------------------ the two scenarios

/**
 * Near-Chandrasekhar delayed detonation.
 *
 * A subsonic flame for about a second, during which the star swells and its density drops,
 * and then — when the gas ahead of the flame has thinned to a few times 10^7 — a switch to
 * a detonation that finishes the job in a fraction of the time.
 */
function advanceDelayed(
  time: number,
  deflagration: Float64Array,
  detonationOut: Float64Array,
  detonationIn: Float64Array,
  density: (i: number) => number,
  thicknessOf: (i: number) => number,
  turbulence: number,
  burn: (i: number, j: number, kind: number) => void,
  markDdt: () => void,
  transitioned: boolean,
): Phase {
  // Front positions are fractional shell indices, so advancing a front by a physical speed
  // means dividing by how thick that shell currently is.
  const step = (index: number, speed: number): number =>
    index + (speed * DT) / thicknessOf(Math.min(NR - 1, Math.max(0, Math.floor(index))));

  if (!transitioned) {
    // The flame is buoyant. Burnt matter is hot and light and floats, so the front runs
    // away fastest in the direction the first spark happened to be offset towards, and
    // drags out into the mushroom-capped plumes that every three-dimensional calculation
    // of this phase produces.
    let leadDensity = Infinity;
    for (let j = 0; j < NTHETA; j += 1) {
      const mu = Math.cos((j + 0.5) * (Math.PI / NTHETA));
      const i = Math.min(NR - 1, Math.floor(deflagration[j]));
      const rho = density(i);
      leadDensity = Math.min(leadDensity, rho);

      // Turbulence wrinkles the flame, and a wrinkled flame has far more surface area than
      // its average position suggests, so it eats fuel faster than the laminar speed alone
      // would allow.
      //
      // The floor matters as much as the multiplier. Left to the laminar speed the flame
      // would strangle itself: burning inflates the star, the density falls, and the
      // laminar speed falls with it as the four-fifths power, so the front simply stops.
      // Real flames do not, because once the star is churning the front is carried along
      // by the Rayleigh–Taylor motions themselves, at a speed set by the buoyancy rather
      // than by the conduction. Below about a hundred kilometres a second it is the
      // turbulence doing the travelling, not the flame.
      const wrinkle = 6 + 8 * turbulence;
      const churn = (0.6 + 1.2 * turbulence) * 1e7;
      const buoyancy = 1 + 1.7 * Math.max(0, mu) + 0.25 * Math.cos(5 * mu + 2 * time);
      const speed = Math.max(laminarFlameSpeed(rho) * wrinkle, churn) * buoyancy;
      deflagration[j] = step(deflagration[j], speed);

      for (let k = 0; k < NR && k <= deflagration[j]; k += 1) burn(k, j, FRONT_DEFLAGRATION);
    }

    // The transition fires when the gas the fastest plume is eating into has thinned to a
    // few times 10^7. It is the flame's own success that brings this about: burning
    // inflates the star, inflating the star drops the density, and the dropped density is
    // what ends the flame's reign.
    if (leadDensity < DDT_DENSITY) {
      markDdt();
      for (let j = 0; j < NTHETA; j += 1) {
        detonationOut[j] = deflagration[j];
        detonationIn[j] = deflagration[j];
      }
      return 'transition';
    }
    return time < 0.06 ? 'simmering' : 'deflagration';
  }

  // Supersonic from here. The outward branch eats the rest of the star; the inward branch
  // mops up the pockets of carbon the plumes left behind between them.
  let alive = false;
  for (let j = 0; j < NTHETA; j += 1) {
    if (detonationOut[j] >= 0 && detonationOut[j] < NR) {
      const i = Math.min(NR - 1, Math.floor(detonationOut[j]));
      detonationOut[j] = step(detonationOut[j], detonationSpeed(density(i)));
      for (let k = 0; k < NR && k <= detonationOut[j]; k += 1) burn(k, j, FRONT_DETONATION);
      alive = true;
    }
    if (detonationIn[j] >= 0) {
      const i = Math.min(NR - 1, Math.floor(detonationIn[j]));
      const from = Math.floor(detonationIn[j]);
      detonationIn[j] = step(detonationIn[j], -detonationSpeed(density(i)));
      for (let k = from; k >= 0 && k >= detonationIn[j]; k -= 1) burn(k, j, FRONT_DETONATION);
      if (detonationIn[j] > 0) alive = true;
    }
  }
  return alive ? 'detonation' : 'expanding';
}

/**
 * Sub-Chandrasekhar double detonation.
 *
 * The star is too light to ignite on its own and never would, left alone. What lights it
 * is the thin helium skin it has stolen from a companion: helium detonates at much lower
 * density than carbon does, so the shell goes first, at one point, and the detonation runs
 * around the surface. Every bit of shell that burns drives a shock down into the core, and
 * because the shell is a sphere those shocks all head for the same place. Where they meet
 * — not the centre, but a point pushed towards the far side — the carbon finally lights.
 *
 * This was a theorist's idea for thirty years. In 2025 the Very Large Telescope imaged the
 * remnant SNR 0509-67.5 and found two separate calcium shells nested one inside the other,
 * which is the fingerprint this mechanism leaves and nothing else does.
 */
function advanceDouble(
  time: number,
  heliumFront: Float64Array,
  detonationOut: Float64Array,
  density: (i: number) => number,
  radiusOf: (i: number) => number,
  heliumShell: number,
  coreTime: number,
  burn: (i: number, j: number, kind: number) => void,
  star: WhiteDwarf,
): { phase: Phase; coreTime: number } {
  const surface = radiusOf(NR - 1);
  const sweep = heliumDetonationSpeed(density(Math.min(heliumShell + 2, NR - 1)));

  // How far around the star the surface burning has got, as an angle from the pole.
  const wrapped = (sweep * time) / Math.max(surface, 1);
  let lastLit = -1;
  for (let j = 0; j < NTHETA; j += 1) {
    const theta = (j + 0.5) * (Math.PI / NTHETA);
    if (theta > wrapped) break;
    lastLit = j;
    heliumFront[j] = surface;
    for (let k = NR - 1; k >= heliumShell; k -= 1) burn(k, j, FRONT_HELIUM);
  }

  // The inward shock. Each patch of shell that detonates drives a shock down into the
  // core, so the shocks are launched in sequence as the surface burning wraps round rather
  // than all at once. They converge on the axis opposite the ignition point and short of
  // the centre, because the early ones — from the ignition side — have a head start and
  // push the focus away from themselves. This is why the mechanism leaves a lopsided
  // remnant, and why the calcium shells in SNR 0509-67.5 are not quite concentric.
  const coldRadius = star.radius;
  const convergeRadius = 0.22 * radiusOf(NR - 1);
  const wrapTime = (Math.PI * coldRadius) / sweep;
  const convergeTime = 0.75 * wrapTime + (0.78 * coldRadius) / (0.8 * sweep);

  if (coreTime === Infinity && time >= convergeTime) coreTime = time;
  if (coreTime === Infinity) {
    // Labelled as converging once most of the shell has gone, rather than waiting for
    // the very last patch: the shocks from the first patches to burn are already well on
    // their way inward by then, which is what the label is describing.
    return { phase: lastLit >= NTHETA * 0.72 ? 'converging' : 'helium', coreTime };
  }

  // The core detonation starts off centre, so its front is a sphere expanding about a
  // point that is not the middle of the star. The distance from that point to a cell at
  // radius r and angle theta is the cosine rule, with the ignition sitting at theta = pi.
  // The front also has to outrun the gas, which by now is moving outward itself, so the
  // sweep is the detonation speed measured against material that is already flying apart.
  const elapsed = time - coreTime;
  const reach = elapsed * (detonationSpeed(density(NR >> 2)) + surface / Math.max(time, 0.3));
  let caught = false;
  for (let j = 0; j < NTHETA; j += 1) {
    const cos = Math.cos((j + 0.5) * (Math.PI / NTHETA));
    for (let k = 0; k < NR; k += 1) {
      if (star.helium[k]) continue;
      const r = radiusOf(k);
      const d = Math.sqrt(r * r + convergeRadius * convergeRadius + 2 * r * convergeRadius * cos);
      if (d <= reach) burn(k, j, FRONT_DETONATION);
      else caught = true;
    }
    detonationOut[j] = Math.max(0, reach - convergeRadius * cos);
  }

  return { phase: caught ? 'core' : 'expanding', coreTime };
}

// ------------------------------------------------------------------ expansion

/**
 * Terminal velocity of each shell.
 *
 * Long after the burning stops, a supernova coasts: every parcel of gas travels in a
 * straight line at whatever speed it was left with, so radius becomes simply velocity
 * times time and the whole object is a scale model of its own velocity field. The velocity
 * a given parcel ends up with follows from the density profile the ejecta settles into,
 * which for a Type Ia is close to an exponential in velocity — the classic W7 fit. That
 * profile has the tidy property that the total kinetic energy is six times the mass times
 * the square of the scale velocity, which is all that is needed to pin it down.
 */
function terminalVelocities(star: WhiteDwarf): Float64Array {
  const out = new Float64Array(NR + 1);
  // Placeholder scale; rescaled once the nuclear energy is known.
  for (let i = 0; i <= NR; i += 1) out[i] = velocityForMassFraction(star.q[Math.min(i, NR - 1)]);
  return out;
}

/**
 * Invert the exponential profile: given the fraction of the mass lying inside a shell,
 * what multiple of the scale velocity is that shell moving at?
 *
 * For rho proportional to exp(-v/ve) the enclosed mass fraction is
 * 1 - exp(-x)(1 + x + x^2/2) with x = v/ve, which has no closed-form inverse, so this
 * walks it by bisection. The outermost shells come out around eight times the scale
 * velocity, which for a typical Type Ia is the twenty thousand kilometres a second the
 * spectra show on day one.
 */
function velocityForMassFraction(q: number): number {
  const target = Math.min(Math.max(q, 0), 0.999999);
  let lo = 0;
  let hi = 20;
  for (let k = 0; k < 60; k += 1) {
    const x = 0.5 * (lo + hi);
    const enclosed = 1 - Math.exp(-x) * (1 + x + 0.5 * x * x);
    if (enclosed < target) lo = x;
    else hi = x;
  }
  // The profile is a fit, not a law, and it has an infinite tail: taken literally it puts
  // the last few grams of the star at arbitrarily high speed. Beyond about eight times the
  // scale velocity there is no measurable mass left and no observation to match, so the
  // tail is clipped there rather than allowed to run away.
  return Math.min(0.5 * (lo + hi), 8.4);
}

/**
 * Move the star outward by one timestep.
 *
 * Two things are going on and they matter at different moments. Before enough energy has
 * been released to unbind the star, the burning simply inflates it: the pressure of the
 * hot ash pushes the overlying layers up, the star swells, and its density drops. That
 * swelling is what makes the delayed detonation work at all, since it is the only reason
 * the density ever falls to where silicon and calcium can be made instead of nothing but
 * iron. After the books balance and there is more nuclear energy than binding energy, the
 * star is unbound and every shell relaxes towards the terminal velocity it will coast at
 * forever.
 */
function advanceExpansion(
  scale: Float64Array,
  vel: Float64Array,
  r0: Float64Array,
  mass: number,
  vShape: Float64Array,
  nuclear: number,
  binding: number,
  dt: number,
): void {
  const kinetic = Math.max(0, nuclear - binding);
  const scaleVelocity = Math.sqrt(kinetic / (6 * mass));

  // While the star is still bound, the swelling is driven by how much of the binding
  // energy the burning has paid off so far. This is a stand-in for solving the momentum
  // equation, and it is the one place the model is frankly a fit — but it is a fit to a
  // real and important effect. A deflagration releases just about exactly the binding
  // energy and no more, so the star inflates to roughly twice its size and hangs there,
  // marginally unbound, which is precisely the state the density has to reach before a
  // detonation can make anything lighter than iron. Once the books are paid the swelling
  // hands over to the terminal velocities and fades out.
  const paid = nuclear / Math.max(binding, 1);
  const swellRate = paid <= 1 ? paid : Math.max(0, 2 - paid);

  // Both terms below rise monotonically from the centre outwards, and their sum therefore
  // does too. That is not a cosmetic detail. A velocity field that is not monotonic lets
  // an inner shell overtake the one above it, and a shell that has been overtaken has
  // negative thickness and infinite density, at which point the flame speed — which
  // depends on density — goes to infinity as well and the whole model detonates in a
  // single timestep. Handing the terminal velocities to the burnt shells individually,
  // rather than to the star as a whole, is exactly how that happens.
  for (let i = 0; i <= NR; i += 1) {
    const target = vShape[i] * scaleVelocity;
    const swell = swellRate * 3.5e8 * (r0[i] / Math.max(r0[NR], 1));

    // Relax towards the terminal speed rather than jumping to it; a shell takes a little
    // while to be accelerated by what is underneath it.
    vel[i] += ((target + swell - vel[i]) / 0.18) * dt;
    if (r0[i] > 0) scale[i] += (vel[i] * dt) / r0[i];
  }

  // A backstop in case the above is ever violated anyway: no shell is allowed to be
  // squeezed below a fiftieth of the thickness it started with.
  for (let i = 1; i <= NR; i += 1) {
    const floor = r0[i - 1] * scale[i - 1] + 0.02 * (r0[i] - r0[i - 1]);
    if (r0[i] * scale[i] < floor) scale[i] = floor / r0[i];
  }
}

// ------------------------------------------------------------------ reading it back

export interface Snapshot {
  time: number;
  phase: Phase;
  /** Shell boundaries at this instant, cm. */
  radius: Float64Array;
  /** Density of each shell at this instant, g/cm^3. */
  density: Float64Array;
  /** Burnt fraction of each cell, 0 to 1. */
  burnt: Float32Array;
  /** How brightly each cell is glowing from having just burned, 0 to 1. */
  glow: Float32Array;
  /** Composition of each cell right now. */
  comp: Float32Array;
  /** Front radius at each angle, cm; negative where there is no front. */
  frontRadius: Float64Array;
  nuclearEnergy: number;
  burnedMass: number;
  outerRadius: number;
}

/** How long a freshly burnt cell keeps glowing, in seconds. */
const GLOW_DECAY = 0.12;
/** How long the front takes to cross one cell, used to soften the edge. */
const BURN_RAMP = 0.012;

/**
 * Read the state of the star at an arbitrary instant.
 *
 * Everything here is either a table lookup or a lerp, which is what makes scrubbing feel
 * immediate: there is no sense in which the animation has to be *played* to reach a given
 * moment, and going backwards costs exactly what going forwards does.
 */
export function sampleAt(map: BurnMap, time: number, into?: Snapshot): Snapshot {
  const clamped = Math.min(Math.max(time, 0), DURATION);
  const f = clamped / DT;
  const step = Math.min(STEPS - 1, Math.floor(f));
  const frac = f - step;

  const out: Snapshot = into ?? {
    time: clamped,
    phase: 'simmering',
    radius: new Float64Array(NR + 1),
    density: new Float64Array(NR),
    burnt: new Float32Array(CELLS),
    glow: new Float32Array(CELLS),
    comp: new Float32Array(CELLS * SPECIES_COUNT),
    frontRadius: new Float64Array(NTHETA),
    nuclearEnergy: 0,
    burnedMass: 0,
    outerRadius: 0,
  };

  out.time = clamped;
  out.phase = map.phases[step];

  const a = step * (NR + 1);
  const b = (step + 1) * (NR + 1);
  for (let i = 0; i <= NR; i += 1) {
    out.radius[i] = map.history[a + i] + (map.history[b + i] - map.history[a + i]) * frac;
  }
  out.outerRadius = out.radius[NR];

  for (let i = 0; i < NR; i += 1) {
    const volume = out.radius[i + 1] ** 3 - out.radius[i] ** 3;
    out.density[i] = map.dm[i] / ((4 / 3) * Math.PI * Math.max(volume, 1e-30));
  }

  const fa = step * NTHETA;
  const fb = (step + 1) * NTHETA;
  for (let j = 0; j < NTHETA; j += 1) {
    out.frontRadius[j] =
      map.frontHistory[fa + j] + (map.frontHistory[fb + j] - map.frontHistory[fa + j]) * frac;
  }

  for (let idx = 0; idx < CELLS; idx += 1) {
    const lit = map.tBurn[idx];
    let progress = 0;
    let glow = 0;
    if (lit !== Infinity && clamped >= lit) {
      progress = Math.min(1, (clamped - lit) / BURN_RAMP);
      glow = progress * Math.exp(-(clamped - lit) / GLOW_DECAY);
    }
    out.burnt[idx] = progress;
    out.glow[idx] = glow;

    const base = idx * SPECIES_COUNT;
    for (let s = 0; s < SPECIES_COUNT; s += 1) {
      out.comp[base + s] =
        map.fuel[base + s] + (map.ash[base + s] - map.fuel[base + s]) * progress;
    }
  }

  out.nuclearEnergy =
    map.energyHistory[step] + (map.energyHistory[step + 1] - map.energyHistory[step]) * frac;
  out.burnedMass =
    map.burnedHistory[step] + (map.burnedHistory[step + 1] - map.burnedHistory[step]) * frac;

  return out;
}

export const TIMELINE_DURATION = DURATION;

// ------------------------------------------------------------------ helpers

function firstHeliumShell(star: WhiteDwarf): number {
  for (let i = 0; i < NR; i += 1) if (star.helium[i]) return i;
  return NR;
}

function tallyYields(ash: Float32Array, dm: Float64Array): Record<string, number> {
  const names = ['co', 'he', 'o', 'si', 'ca', 'ni', 'fe'];
  const out: Record<string, number> = {};
  for (const n of names) out[n] = 0;
  for (let i = 0; i < NR; i += 1) {
    const cellMass = dm[i] / NTHETA;
    for (let j = 0; j < NTHETA; j += 1) {
      const base = (i * NTHETA + j) * SPECIES_COUNT;
      for (let s = 0; s < SPECIES_COUNT; s += 1) out[names[s]] += ash[base + s] * cellMass;
    }
  }
  for (const n of names) out[n] /= M_SUN;
  return out;
}

export const inFoe = (erg: number): number => erg / FOE;
