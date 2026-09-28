import { A_RAD, C_LIGHT, K_B, M_U, RHO_NUC, SPECIES_A, SPECIES_COUNT } from './constants';

/**
 * The equation of state: what pressure a lump of stellar material pushes back with.
 *
 * This is the piece that decides whether the star collapses and whether it stops, so it has
 * to be right across a preposterous range — from a hydrogen envelope thinner than air, out
 * where pressure is just a warm ideal gas, down to matter denser than an atomic nucleus,
 * where the strong force is the only thing that matters. Nothing analytic covers all of
 * that, so the pressure is a sum of pieces, each of which is exact in its own regime and
 * negligible outside it.
 *
 * The important structural choice is the split between *cold* and *thermal*. The cold part
 * is what the material would push back with at absolute zero: degenerate electrons, plus
 * the nuclear repulsion that switches on above saturation density. It depends only on
 * density and composition. The thermal part is everything temperature adds: radiation,
 * the ions bouncing around, and the small correction from electrons being warm.
 *
 * Splitting it that way is not just tidiness. In the iron core the cold part is a thousand
 * times the thermal part, so solving for temperature from the *total* energy would mean
 * taking the difference of two nearly equal numbers and then dividing by a small one — the
 * temperature would be pure rounding error. Tracking the thermal energy separately keeps
 * that well conditioned, and the temperature is what the nuclear physics runs on.
 */

/** Chandrasekhar's pressure scale for a degenerate electron gas, dyn/cm^2. */
const A_DEG = 6.0023e22;
/** x = p_Fermi / (m_e c), which is 1 at about 10^6 g/cm^3 of electrons. */
const X_COEFF = 1.0088e-2;

/**
 * Stiffness of nuclear matter above saturation density, in dyn/cm^2. Below saturation,
 * nuclei are separate objects with space between them and the material is compressible.
 * Above it they have merged into one fluid and the strong force turns hard repulsive. This
 * number, and the exponent below, are the wall the collapsing core bounces off.
 */
const K_NUC = 4.0e33;
const GAMMA_NUC = 2.5;

/** Floor so that empty zones do not produce infinities. */
const TEMP_FLOOR = 1e3;

// ---------------------------------------------------------------- degenerate electrons

/**
 * The Chandrasekhar functions for a cold Fermi gas. f gives pressure, g gives energy
 * density, both in units of A_DEG.
 *
 * Both expressions subtract nearly equal quantities when x is small, which at x = 0.01
 * throws away every significant digit. The series expansions below the cutoff are not an
 * approximation for convenience; they are what makes the low-density envelope computable
 * at all.
 */
function fermiF(x: number): number {
  if (x < 0.1) {
    const x2 = x * x;
    return 1.6 * x ** 5 * (1 - (5 / 14) * x2 + (5 / 24) * x2 * x2);
  }
  const s = Math.sqrt(x * x + 1);
  return x * (2 * x * x - 3) * s + 3 * Math.asinh(x);
}

function fermiG(x: number): number {
  if (x < 0.1) {
    const x2 = x * x;
    return 2.4 * x ** 5 * (1 - (5 / 28) * x2 + (5 / 72) * x2 * x2);
  }
  const s = Math.sqrt(x * x + 1);
  return 8 * x ** 3 * (s - 1) - fermiF(x);
}

export function fermiX(density: number, ye: number): number {
  return X_COEFF * Math.cbrt(Math.max(density * ye, 1e-30));
}

/** Fermi energy in erg, which sets how degenerate the electrons are. */
export function fermiEnergy(density: number, ye: number): number {
  const x = fermiX(density, ye);
  return 8.1871e-7 * (Math.sqrt(1 + x * x) - 1); // m_e c^2 = 8.1871e-7 erg
}

// ---------------------------------------------------------------- the cold part

/** Pressure at absolute zero: degenerate electrons plus nuclear repulsion. */
export function coldPressure(density: number, ye: number): number {
  const p = A_DEG * fermiF(fermiX(density, ye));
  if (density <= RHO_NUC) return p;
  return p + K_NUC * (Math.pow(density / RHO_NUC, GAMMA_NUC) - 1);
}

/**
 * Specific internal energy at absolute zero. The electron part comes straight from the
 * Fermi gas; the nuclear part is the integral of P/rho^2 from saturation density up, which
 * a power law does in closed form.
 */
export function coldEnergy(density: number, ye: number): number {
  const e = (A_DEG * fermiG(fermiX(density, ye))) / Math.max(density, 1e-30);
  if (density <= RHO_NUC) return e;
  const ratio = density / RHO_NUC;
  const nuclear =
    K_NUC *
    ((Math.pow(ratio, GAMMA_NUC - 1) - 1) / (RHO_NUC * (GAMMA_NUC - 1)) + 1 / density - 1 / RHO_NUC);
  return e + nuclear;
}

// ---------------------------------------------------------------- composition helpers

/** Mean mass per ion, which sets how many independent particles a gram contains. */
export function meanIonMass(comp: Float64Array, offset: number): number {
  let sum = 0;
  for (let s = 0; s < SPECIES_COUNT; s += 1) sum += comp[offset + s] / SPECIES_A[s];
  return 1 / Math.max(sum, 1e-8);
}

// ---------------------------------------------------------------- the thermal part

/**
 * Temperature from thermal energy, by Newton's method.
 *
 * The three thermal reservoirs are radiation (which goes as T^4), the ions (linear in T),
 * and the electrons. That last one needs care: a degenerate electron gas cannot absorb the
 * heat an ideal gas would, because almost every state below the Fermi level is already
 * full and only the thin shell within kT of the surface has anywhere to go. So the electron
 * heat capacity is suppressed by roughly T / T_Fermi, which the T^2 / (T + T_F) form below
 * reproduces in both limits. Without that suppression the iron core would look ten times
 * harder to heat than it is, and photodisintegration would start far too late.
 *
 * Every term rises monotonically with T, so the function being inverted is monotonic and
 * Newton converges from anywhere. The bisection bracket is belt and braces.
 */
export function temperatureFrom(
  thermalEnergy: number,
  density: number,
  ye: number,
  ionMass: number,
  guess: number,
): number {
  const eth = Math.max(thermalEnergy, 0);
  if (eth <= 0) return TEMP_FLOOR;

  const radCoeff = A_RAD / Math.max(density, 1e-30);
  const ionCoeff = (1.5 * K_B) / (ionMass * M_U);
  const eleCoeff = (1.5 * ye * K_B) / M_U;
  const fermiT = fermiEnergy(density, ye) / K_B;
  const b = (2 / 3) * fermiT;

  const value = (t: number): number =>
    radCoeff * t ** 4 + ionCoeff * t + (eleCoeff * t * t) / (t + b) - eth;

  let lo = TEMP_FLOOR;
  let hi = Math.max(guess * 4, 1e7);
  // Widen until the root is bracketed. Shocked material can jump by orders of magnitude in
  // one step, so this occasionally has to travel a long way.
  let guard = 0;
  while (value(hi) < 0 && guard < 200) {
    hi *= 4;
    guard += 1;
  }

  let t = Math.min(Math.max(guess, lo), hi);
  for (let i = 0; i < 40; i += 1) {
    const f = value(t);
    if (Math.abs(f) < 1e-8 * eth) break;
    if (f > 0) hi = t;
    else lo = t;

    const slope =
      4 * radCoeff * t ** 3 + ionCoeff + (eleCoeff * (t * t + 2 * t * b)) / ((t + b) * (t + b));
    const next = t - f / slope;
    t = next > lo && next < hi ? next : (lo + hi) / 2;
  }
  return Math.max(t, TEMP_FLOOR);
}

/**
 * Thermal energy from temperature: the inverse of the function above, and the one used to
 * set up the star before anything starts moving.
 */
export function thermalEnergyOf(
  temperature: number,
  density: number,
  ye: number,
  ionMass: number,
): number {
  const fermiT = fermiEnergy(density, ye) / K_B;
  return (
    (A_RAD * temperature ** 4) / Math.max(density, 1e-30) +
    (1.5 * K_B * temperature) / (ionMass * M_U) +
    (1.5 * ye * K_B * temperature * temperature) / ((temperature + (2 / 3) * fermiT) * M_U)
  );
}

/** Pressure the temperature adds on top of the cold part. */
export function thermalPressure(
  temperature: number,
  density: number,
  ye: number,
  ionMass: number,
): number {
  const rad = (A_RAD * temperature ** 4) / 3;
  const ions = (density * K_B * temperature) / (ionMass * M_U);
  // The same degeneracy suppression as in the energy, so that pressure and energy agree.
  const fermiT = fermiEnergy(density, ye) / K_B;
  const suppress = temperature / (temperature + (2 / 3) * fermiT);
  const electrons = (density * ye * K_B * temperature * suppress) / M_U;
  return rad + ions + electrons;
}

/**
 * The temperature that would produce a wanted thermal pressure. Used only when setting the
 * star up, to find the temperature profile that holds each layer against its own weight.
 * Monotonic again, so plain bisection is enough and cannot fail.
 */
export function temperatureForPressure(
  wanted: number,
  density: number,
  ye: number,
  ionMass: number,
): number {
  if (wanted <= 0) return TEMP_FLOOR;
  let lo = TEMP_FLOOR;
  let hi = 1e12;
  for (let i = 0; i < 90; i += 1) {
    const mid = Math.sqrt(lo * hi);
    if (thermalPressure(mid, density, ye, ionMass) < wanted) lo = mid;
    else hi = mid;
  }
  return Math.sqrt(lo * hi);
}

/**
 * The electron fraction that would produce a wanted cold pressure.
 *
 * The companion to the function above, for the other half of the star. Out in the burning
 * shells and the envelope, temperature is what sets the pressure and solving for it is
 * well conditioned. Inside the iron core it is not: degenerate electrons supply almost all
 * of the pressure there, and asking what temperature makes up the remainder is asking for
 * the last decimal place of a difference between two large numbers. Electron fraction is
 * the knob that actually moves degeneracy pressure — roughly as its four-thirds power once
 * the electrons are relativistic — so in the core that is the one to turn.
 */
export function electronFractionForPressure(wanted: number, density: number): number {
  let lo = 0.05;
  let hi = 0.6;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (coldPressure(density, mid) < wanted) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface State {
  pressure: number;
  soundSpeed: number;
}

/**
 * Pressure and sound speed together, since callers always want both and the pieces are
 * shared. The sound speed is the adiabatic one, assembled from each contribution weighted
 * by its own effective gamma: 4/3 for radiation, 5/3 for the ions, and for the cold part
 * whatever the Fermi gas or the nuclear term is doing locally.
 *
 * Capping at the speed of light is not a physical statement so much as a numerical one.
 * This solver is Newtonian, and at a few times nuclear density a Newtonian sound speed
 * sails past c, which would drive the timestep to nothing for no good reason.
 */
export function pressureAndSound(
  density: number,
  temperature: number,
  ye: number,
  ionMass: number,
): State {
  const cold = coldPressure(density, ye);
  const rad = (A_RAD * temperature ** 4) / 3;
  const ions = (density * K_B * temperature) / (ionMass * M_U);
  const fermiT = fermiEnergy(density, ye) / K_B;
  const suppress = temperature / (temperature + (2 / 3) * fermiT);
  const electrons = (density * ye * K_B * temperature * suppress) / M_U;
  const pressure = cold + rad + ions + electrons;

  // Effective gamma of the cold part: 5/3 when the electrons are non-relativistic, sliding
  // to 4/3 when they are, and rising steeply once nuclear repulsion takes over.
  const x = fermiX(density, ye);
  const gammaDeg = (5 / 3 + (4 / 3) * x * x) / (1 + x * x);
  let coldGamma = gammaDeg;
  if (density > RHO_NUC) {
    const nuc = K_NUC * (Math.pow(density / RHO_NUC, GAMMA_NUC) - 1);
    coldGamma = (gammaDeg * (cold - nuc) + GAMMA_NUC * nuc) / Math.max(cold, 1e-30);
  }

  const c2 =
    (coldGamma * cold + (4 / 3) * rad + (5 / 3) * (ions + electrons)) / Math.max(density, 1e-30);
  const sound = Math.min(Math.sqrt(Math.max(c2, 0)), 0.9 * C_LIGHT);
  return { pressure, soundSpeed: sound };
}
