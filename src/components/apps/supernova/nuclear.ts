import {
  K_B,
  M_U,
  MEV,
  RHO_TRAP,
  SPECIES_BE,
  SPECIES_COUNT,
  SP_C,
  SP_FE,
  SP_FREE,
  SP_HE,
  SP_O,
  SP_SI,
} from './constants';

/**
 * The nuclear physics, which is what actually kills the star.
 *
 * Three separate processes live here, and it is worth being clear about which is which,
 * because the popular account of a supernova tends to run them together.
 *
 * The first is *photodisintegration*: the star's own thermal radiation tearing iron nuclei
 * back apart into alpha particles and then into loose neutrons and protons. This is not
 * fusion running backwards in any useful sense — it is the core being demolished by its own
 * light, and it costs a colossal amount of energy, which is precisely the problem. Taking
 * that energy out of the gas drops the pressure, which lets gravity squeeze harder, which
 * raises the temperature, which dissociates more iron. That is the runaway.
 *
 * The second is *electron capture*: protons swallowing electrons to become neutrons,
 * emitting a neutrino each time. Since it is the electrons that were holding the core up,
 * removing them removes the support directly.
 *
 * The third is *explosive burning*, hours of ordinary stellar nucleosynthesis compressed
 * into a second, as the shock wave slams through the silicon and oxygen shells on its way
 * out. This one releases energy rather than absorbing it, and it is what makes the nickel
 * that will light the supernova up for the next several months. It is not, however, what
 * drives the explosion — watch the energy readout and you will see it contribute a few per
 * cent of the total.
 */

/** Reduced Planck constant squared times 2 pi, which the Saha equation wants. */
const TWO_PI_HBAR2 = 2 * Math.PI * 1.054571817e-27 ** 2;

/** Binding energies of the two nuclei the equilibrium is written in terms of, in erg. */
const B_HEAVY = 492.26 * MEV; // iron-56, as a whole nucleus
const B_ALPHA = 28.296 * MEV; // helium-4

/** A^(5/2) / 2^A for each, the statistical weight in the Saha balance. */
const C_HEAVY = Math.pow(56, 2.5) / Math.pow(2, 56);
const C_ALPHA = Math.pow(4, 2.5) / Math.pow(2, 4);

/** Below this there is no point even asking: nothing dissociates. */
const NSE_FLOOR = 2.5e9; // K

export interface Dissociation {
  /** Mass fraction left in iron-group nuclei. */
  heavy: number;
  /** Mass fraction in alpha particles. */
  alpha: number;
  /** Mass fraction in free neutrons and protons. */
  free: number;
}

/**
 * Nuclear statistical equilibrium between iron, alphas and free nucleons.
 *
 * At these temperatures nuclear reactions run far faster than anything hydrodynamic, so the
 * composition is not something to be integrated — it is whatever thermodynamics says it
 * should be, right now. The Saha equation for A nucleons binding into one nucleus gives
 *
 *     n_A = A^(3/2) 2^-A theta^-(A-1) n_nucleon^A exp(B_A / kT)
 *
 * where theta is the quantum concentration. Two competing effects decide the answer: the
 * exponential wants everything bound, because binding releases energy, and the theta term
 * wants everything loose, because 56 free particles have vastly more entropy than one. Heat
 * the gas and entropy wins; squeeze it and binding wins back.
 *
 * Alphas are worth keeping as a separate species rather than going straight to nucleons,
 * because they sit in between energetically. Breaking iron into alphas costs 2.2 MeV per
 * nucleon; breaking those alphas into nucleons costs another 6.6. So the core dissolves in
 * two distinct stages, and the first one starts appreciably earlier than the second.
 *
 * The arithmetic is done in logs throughout. The raw exponentials here reach e^500, which
 * overflows a double several times over.
 */
export function nseComposition(temperature: number, density: number): Dissociation {
  if (temperature < NSE_FLOOR) return { heavy: 1, alpha: 0, free: 0 };

  const kt = K_B * temperature;
  // Quantum concentration: (m_u kT / 2 pi hbar^2)^(3/2), in cm^-3.
  const theta = Math.pow((M_U * kt) / TWO_PI_HBAR2, 1.5);
  const nucleons = density / M_U;
  const crowding = Math.log(nucleons / theta);

  // ln(X_heavy / X_free^56) and ln(X_alpha / X_free^4).
  const lnHeavy = Math.log(C_HEAVY * 56) + 55 * crowding + B_HEAVY / kt;
  const lnAlpha = Math.log(C_ALPHA * 4) + 3 * crowding + B_ALPHA / kt;

  // Solve X_h + X_a + X_f = 1 for the free fraction. Everything is monotonic in X_f, so
  // bisection in log space is both safe and quick, and it never overflows.
  let lo = -80; // ln X_free
  let hi = 0;
  for (let i = 0; i < 80; i += 1) {
    const mid = (lo + hi) / 2;
    const h = Math.exp(Math.min(lnHeavy + 56 * mid, 40));
    const a = Math.exp(Math.min(lnAlpha + 4 * mid, 40));
    if (h + a + Math.exp(mid) < 1) lo = mid;
    else hi = mid;
  }
  const lnFree = (lo + hi) / 2;
  const free = Math.exp(lnFree);
  const heavy = Math.exp(Math.min(lnHeavy + 56 * lnFree, 40));
  const alpha = Math.exp(Math.min(lnAlpha + 4 * lnFree, 40));

  const total = heavy + alpha + free;
  return { heavy: heavy / total, alpha: alpha / total, free: free / total };
}

// ---------------------------------------------------------------- the lookup table

/**
 * The equilibrium above gets asked for several million times over a run, and a bisection
 * with eighty iterations of exponentials is not something to do several million times. It
 * only depends on two numbers, though, and it is smooth in both, so it goes in a table.
 *
 * The grid covers the region where anything interesting happens: cooler than about two
 * billion kelvin nothing dissociates, and hotter than 10^11.5 everything already has.
 */
const TAB_T0 = 9.3;
const TAB_T1 = 11.6;
const TAB_R0 = 5.0;
const TAB_R1 = 15.5;
const TAB_NT = 160;
const TAB_NR = 120;

let table: Float32Array | null = null;

function buildTable(): Float32Array {
  const data = new Float32Array(TAB_NT * TAB_NR * 2);
  for (let i = 0; i < TAB_NT; i += 1) {
    const t = Math.pow(10, TAB_T0 + ((TAB_T1 - TAB_T0) * i) / (TAB_NT - 1));
    for (let j = 0; j < TAB_NR; j += 1) {
      const rho = Math.pow(10, TAB_R0 + ((TAB_R1 - TAB_R0) * j) / (TAB_NR - 1));
      const c = nseComposition(t, rho);
      data[(i * TAB_NR + j) * 2] = c.heavy;
      data[(i * TAB_NR + j) * 2 + 1] = c.free;
    }
  }
  return data;
}

/** Bilinear lookup of the equilibrium, with the alpha fraction as the remainder. */
export function nseLookup(temperature: number, density: number): Dissociation {
  if (temperature < NSE_FLOOR) return { heavy: 1, alpha: 0, free: 0 };
  if (!table) table = buildTable();

  const lt = Math.log10(temperature);
  const lr = Math.log10(Math.max(density, 1e-30));
  if (lt <= TAB_T0) return { heavy: 1, alpha: 0, free: 0 };
  if (lt >= TAB_T1) return { heavy: 0, alpha: 0, free: 1 };

  const fi = ((lt - TAB_T0) / (TAB_T1 - TAB_T0)) * (TAB_NT - 1);
  const fj = Math.max(0, Math.min(TAB_NR - 1.0001, ((lr - TAB_R0) / (TAB_R1 - TAB_R0)) * (TAB_NR - 1)));
  const i0 = Math.min(TAB_NT - 2, Math.floor(fi));
  const j0 = Math.min(TAB_NR - 2, Math.floor(fj));
  const u = fi - i0;
  const w = fj - j0;

  const at = (i: number, j: number, k: number): number => table![(i * TAB_NR + j) * 2 + k];
  const heavy =
    at(i0, j0, 0) * (1 - u) * (1 - w) +
    at(i0 + 1, j0, 0) * u * (1 - w) +
    at(i0, j0 + 1, 0) * (1 - u) * w +
    at(i0 + 1, j0 + 1, 0) * u * w;
  const free =
    at(i0, j0, 1) * (1 - u) * (1 - w) +
    at(i0 + 1, j0, 1) * u * (1 - w) +
    at(i0, j0 + 1, 1) * (1 - u) * w +
    at(i0 + 1, j0 + 1, 1) * u * w;

  const h = Math.max(0, Math.min(1, heavy));
  const f = Math.max(0, Math.min(1 - h, free));
  return { heavy: h, alpha: 1 - h - f, free: f };
}

/**
 * Move a zone's composition towards nuclear statistical equilibrium, and report the energy
 * that cost.
 *
 * Equilibrium is reached almost instantly in physical terms, but jumping straight to it
 * every step makes the solver unstable: dissociating absorbs energy, which lowers the
 * temperature, which un-dissociates, which raises it again, and the zone sits there
 * oscillating. So the approach is rate-limited — no more than a set fraction of the way
 * per step — which damps that loop without changing where it ends up.
 *
 * The rate limit is not enough on its own, because it limits how far the composition
 * moves and not what the move costs. Pulling an iron nucleus apart costs about 8.8 MeV
 * for every nucleon in it, which is an enormous amount of energy — enough that a zone
 * asked to dissociate a third of its iron in one step can be presented with a bill larger
 * than all the heat it has. Left unchecked it pays anyway and lands on the temperature
 * floor, and a shell of infalling core at five billion grams per cubic centimetre sits
 * there at a thousand kelvin, which is absurd. So there is a second limit, on the
 * spending rather than the distance: a zone may put only a fraction of its heat into
 * breaking nuclei per step, and the rest of the journey waits for the next one. The
 * equilibrium this settles to is the same, because it is the point where the temperature
 * NSE wants and the temperature the energy can pay for agree.
 *
 * Only the iron-group, alpha and free-nucleon fractions take part. Silicon and lighter
 * species in the outer shells are never hot enough for this to touch them, and if they
 * were, they would burn rather than dissociate.
 */

/** Largest share of a zone's heat that one step may spend pulling nuclei apart. */
const MAX_SPEND = 0.25;

export function relaxToNse(
  comp: Float64Array,
  offset: number,
  temperature: number,
  density: number,
  maxStep: number,
  thermalEnergy: number,
): number {
  const heavy = comp[offset + SP_FE];
  const alpha = comp[offset + SP_HE];
  const free = comp[offset + SP_FREE];
  const pool = heavy + alpha + free;
  if (pool < 1e-6) return 0;

  const target = nseLookup(temperature, density);
  const wantHeavy = target.heavy * pool;
  const wantAlpha = target.alpha * pool;
  const wantFree = target.free * pool;

  let blend = Math.min(1, Math.max(0, maxStep));

  // Energy cost is the change in total binding, which is what the gas has to pay for.
  const before = heavy * SPECIES_BE[SP_FE] + alpha * SPECIES_BE[SP_HE];
  const costOf = (step: number) =>
    (((heavy + (wantHeavy - heavy) * step) * SPECIES_BE[SP_FE] +
      (alpha + (wantAlpha - alpha) * step) * SPECIES_BE[SP_HE] -
      before) /
      M_U);

  const full = costOf(blend);
  if (full < 0) {
    const affordable = -MAX_SPEND * Math.max(thermalEnergy, 0);
    // The cost is linear in the step, so scaling the step scales the bill exactly.
    if (full < affordable) blend *= affordable / full;
  }

  comp[offset + SP_FE] = heavy + (wantHeavy - heavy) * blend;
  comp[offset + SP_HE] = alpha + (wantAlpha - alpha) * blend;
  comp[offset + SP_FREE] = free + (wantFree - free) * blend;

  return costOf(blend); // negative while dissociating, which is the whole point
}

// ---------------------------------------------------------------- deleptonisation

/**
 * How many electrons per nucleon the core has left, as a function of how squeezed it is.
 *
 * Working out electron capture rates properly means a table of weak interaction matrix
 * elements for several hundred nuclei, which is a research project rather than a module.
 * The standard way around it for simulations of this kind is Liebendoerfer's 2005
 * parametrisation: run a full transport calculation once, notice that the electron fraction
 * during collapse tracks density remarkably tightly regardless of the details, and fit a
 * curve to it. That curve is what this is.
 *
 * The shape encodes two things. Capture accelerates as the core compresses, because a
 * denser electron gas has a higher Fermi energy and so more electrons above the threshold
 * to be captured. And then it stops: above about 10^12 g/cm^3 the neutrinos being produced
 * can no longer get out, the core reaches equilibrium with its own neutrinos, and the
 * electron fraction freezes at around 0.28 for the rest of the collapse.
 */
const YE_RHO_1 = 3.0e7;
const YE_RHO_2 = 2.0e13;
const YE_1 = 0.5;
const YE_2 = 0.2780;
const YE_C = 0.035;

export function targetYe(density: number): number {
  const l1 = Math.log10(YE_RHO_1);
  const l2 = Math.log10(YE_RHO_2);
  const x = Math.max(-1, Math.min(1, (2 * Math.log10(Math.max(density, 1)) - l2 - l1) / (l2 - l1)));
  const absX = Math.abs(x);
  return (
    0.5 * (YE_1 + YE_2) +
    (x / 2) * (YE_2 - YE_1) +
    YE_C * (1 - absX + 4 * absX * (absX - 0.5) * (absX - 1))
  );
}

/**
 * Mean energy of the neutrino produced by each capture, in erg. Real spectra harden as the
 * core compresses; this tracks the electron Fermi energy loosely, which is the right idea.
 */
export function captureNeutrinoEnergy(density: number): number {
  const mev = Math.min(20, 3 + 12 * Math.log10(Math.max(density, 1e8) / 1e8) / 5);
  return mev * MEV;
}

/** Whether neutrinos made here can still get out, which stops mattering above trapping. */
export function neutrinosEscape(density: number): boolean {
  return density < RHO_TRAP;
}

// ---------------------------------------------------------------- explosive burning

interface BurnStep {
  from: number;
  to: number;
  /** Temperature above which this runs fast enough to matter, in K. */
  threshold: number;
}

/**
 * What burns into what when the shock arrives.
 *
 * Each of these is really a whole network — silicon burning alone involves a few hundred
 * reactions climbing the chart of nuclides by alpha captures — but the energy released only
 * depends on where a nucleon starts and where it ends up, which is what the binding energy
 * table already knows. The thresholds are where each stage runs fast compared to the time
 * the shock takes to pass, which is a fraction of a second.
 *
 * Note where the list stops. There is no hydrogen entry and no helium-to-carbon entry that
 * ever fires in practice, because by the time the shock reaches the helium shell it has
 * cooled far below a billion kelvin. The outer nine tenths of the star's radius is blown
 * off by a shock doing no nuclear physics whatsoever.
 */
const BURN_CHAIN: BurnStep[] = [
  { from: SP_SI, to: SP_FE, threshold: 4.0e9 },
  { from: SP_O, to: SP_SI, threshold: 3.3e9 },
  { from: SP_C, to: SP_O, threshold: 2.2e9 },
];

/** Where nuclear statistical equilibrium takes over from the burning chain. */
export const NSE_TEMP = 5.0e9;
/**
 * Where reactions stop entirely. Material that expands and cools past this keeps whatever
 * composition it had, which is why alpha-rich freeze-out leaves free helium behind in the
 * innermost ejecta rather than turning all of it into nickel.
 */
export const FREEZE_TEMP = 2.8e9;

/**
 * Fold silicon, oxygen and carbon into the iron-group pool, releasing the binding energy
 * difference, and report it. Called only above the equilibrium temperature, where holding
 * these as separate species would be a fiction: at five billion kelvin a silicon nucleus
 * has no more chance of staying silicon than an iron nucleus has of staying iron.
 */
export function poolLightNuclei(comp: Float64Array, offset: number): number {
  let released = 0;
  for (const s of [SP_SI, SP_O, SP_C]) {
    const x = comp[offset + s];
    if (x < 1e-10) continue;
    released += (x * (SPECIES_BE[SP_FE] - SPECIES_BE[s])) / M_U;
    comp[offset + SP_FE] += x;
    comp[offset + s] = 0;
  }
  return released;
}

/**
 * Burn a zone for one timestep, returning the specific energy released in erg/g and how
 * much iron-group was newly made.
 *
 * The rate is a crude but well-behaved thing: once past its threshold, a stage consumes its
 * fuel with a timescale that shortens steeply with temperature, so material just over the
 * line burns partially and material far past it burns out completely. That distinction is
 * real and visible — it is the difference between the complete silicon burning that makes
 * nickel and the incomplete burning further out that leaves a mixture behind.
 */
export function burnZone(
  comp: Float64Array,
  offset: number,
  temperature: number,
  dt: number,
): { released: number; iron: number } {
  if (temperature < 1.4e9) return { released: 0, iron: 0 };

  let released = 0;
  let iron = 0;
  for (const step of BURN_CHAIN) {
    if (temperature < step.threshold) continue;
    const fuel = comp[offset + step.from];
    if (fuel < 1e-8) continue;

    // Steeply temperature sensitive, normalised so that burning is essentially complete a
    // little above threshold and barely starts below it.
    const over = temperature / step.threshold;
    const rate = 1e3 * Math.pow(over, 12);
    const burnt = fuel * (1 - Math.exp(-rate * dt));
    if (burnt < 1e-12) continue;

    comp[offset + step.from] = fuel - burnt;
    comp[offset + step.to] += burnt;
    released += (burnt * (SPECIES_BE[step.to] - SPECIES_BE[step.from])) / M_U;
    if (step.to === SP_FE) iron += burnt;
  }
  return { released, iron };
}

/** Electron fraction implied by a composition, for material that has not been deleptonised. */
export function compositionYe(comp: Float64Array, offset: number, zList: number[], aList: number[]): number {
  let ye = 0;
  for (let s = 0; s < SPECIES_COUNT; s += 1) ye += (comp[offset + s] * zList[s]) / aList[s];
  return ye;
}
