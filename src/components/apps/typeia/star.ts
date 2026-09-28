/**
 * The star before anything happens to it.
 *
 * A white dwarf is the one kind of star whose structure is genuinely easy, because it has
 * no energy source and no temperature dependence worth speaking of. It is a ball of cold
 * degenerate electrons, and its pressure is a function of density alone. That makes the
 * structure a pair of ordinary differential equations with one free parameter — the
 * central density — and the whole thing is solved here, from scratch, in a millisecond.
 *
 * It is worth doing properly rather than reaching for a polytrope. The two polytropic
 * shortcuts, n = 3/2 for a non-relativistic electron gas and n = 3 for an ultra-
 * relativistic one, are the two ends of the same star: near the Chandrasekhar mass the
 * middle of the white dwarf is thoroughly relativistic and its outer half is not. Using
 * either one alone gets the radius wrong by tens of percent, and the radius is the number
 * that decides how long the burning front takes to cross — which is the whole animation.
 */

import { CHANDRA_A, CHANDRA_B, G, M_SUN, YE } from './constants';

/** Chandrasekhar's f(x): the pressure of a cold electron gas, in units of A. */
function pressureF(x: number): number {
  return x * (2 * x * x - 3) * Math.sqrt(x * x + 1) + 3 * Math.asinh(x);
}

/** And g(x): its energy density, in the same units. */
function energyG(x: number): number {
  return 8 * x * x * x * (Math.sqrt(x * x + 1) - 1) - pressureF(x);
}

const xOf = (density: number): number => Math.cbrt((density * YE) / CHANDRA_B);

/**
 * The electrostatic correction, and it is not optional.
 *
 * The electrons are not really a free gas: they sit in a lattice of positively charged
 * carbon and oxygen nuclei, each nucleus surrounded by a slight excess of electrons that
 * screens it. That screening lowers the pressure by not quite two percent — which sounds
 * ignorable and is not, because near the Chandrasekhar mass the star is balanced on the
 * edge of not being supportable at all and the mass–radius relation is correspondingly
 * touchy. Without this term a 1.0 solar mass white dwarf comes out at 5480 km against a
 * measured 5100, and the error grows steeply towards the limit.
 *
 * P = -(3/10)(4 pi/3)^(1/3) e^2 Z^(2/3) n_e^(4/3), which collapses to a constant times
 * density to the four thirds. Z is taken as seven, between carbon's six and oxygen's eight.
 */
const COULOMB_K = 8.237e12; // dyn cm^-2 / (g/cm^3)^(4/3), for Z = 7 and Ye = 1/2

const coulombPressure = (density: number): number => -COULOMB_K * Math.pow(density, 4 / 3);

export const pressureOf = (density: number): number =>
  CHANDRA_A * pressureF(xOf(density)) + coulombPressure(density);

/** For a pressure going as density to the four thirds the energy density is three times it. */
export const energyDensityOf = (density: number): number =>
  CHANDRA_A * energyG(xOf(density)) + 3 * coulombPressure(density);

/**
 * dP/drho for the same gas, which is also the square of the sound speed. Integrating in
 * density rather than in pressure avoids having to invert f(x) at every step.
 */
function dPdRho(density: number): number {
  const x = xOf(density);
  return (
    (8 * CHANDRA_A * x * x * x * x * x) / (3 * density * Math.sqrt(x * x + 1)) -
    (4 / 3) * COULOMB_K * Math.cbrt(density)
  );
}

export const soundSpeedOf = (density: number): number => Math.sqrt(dPdRho(density));

/** Floor below which the star is declared to have ended. */
const SURFACE_DENSITY = 1e3; // g/cm^3

interface Integration {
  mass: number;
  radius: number;
  /** Gravitational plus internal energy. Negative for a bound star. */
  energy: number;
}

/**
 * Integrate outwards from a given central density until the density runs out.
 *
 * Fourth-order Runge–Kutta on (mass, density) against radius. The step is a fixed
 * fraction of the radius reached so far, which keeps it small where the structure is
 * steep and lets it stretch through the quiet middle.
 */
function integrate(centralDensity: number, onShell?: (r: number, m: number, rho: number) => void): Integration {
  let r = 1;
  let m = (4 / 3) * Math.PI * centralDensity;
  let rho = centralDensity;
  let energy = 0;

  const derivative = (rr: number, mm: number, dd: number): [number, number] => {
    if (dd <= SURFACE_DENSITY) return [0, 0];
    return [4 * Math.PI * rr * rr * dd, (-G * mm * dd) / (rr * rr) / dPdRho(dd)];
  };

  for (let step = 0; step < 400000 && rho > SURFACE_DENSITY; step += 1) {
    onShell?.(r, m, rho);
    const h = Math.max(200, r * 0.002);

    const [k1m, k1d] = derivative(r, m, rho);
    const [k2m, k2d] = derivative(r + h / 2, m + (h / 2) * k1m, rho + (h / 2) * k1d);
    const [k3m, k3d] = derivative(r + h / 2, m + (h / 2) * k2m, rho + (h / 2) * k2d);
    const [k4m, k4d] = derivative(r + h, m + h * k3m, rho + h * k3d);

    const dm = (h / 6) * (k1m + 2 * k2m + 2 * k3m + k4m);
    const dRho = (h / 6) * (k1d + 2 * k2d + 2 * k3d + k4d);

    // Gravitational binding and the energy already sitting in the electron gas, both
    // accumulated over the same shell so that the two cannot drift apart.
    energy += -((G * m) / r) * dm + energyDensityOf(rho) * 4 * Math.PI * r * r * h;

    r += h;
    m += dm;
    rho += dRho;
    if (!(rho > 0)) break;
  }

  return { mass: m, radius: r, energy };
}

/** Find the central density that produces a white dwarf of the mass asked for. */
function centralDensityFor(mass: number): number {
  let lo = 1e5;
  let hi = 5e10;
  for (let i = 0; i < 70; i += 1) {
    const mid = Math.sqrt(lo * hi);
    if (integrate(mid).mass < mass) lo = mid;
    else hi = mid;
  }
  return Math.sqrt(lo * hi);
}

export interface WhiteDwarf {
  /** Zone count. */
  count: number;
  /** Interface radii, length count + 1, in cm. */
  r: Float64Array;
  /** Enclosed mass at each interface, in g. */
  mass: Float64Array;
  /** Mass of each zone, in g. */
  dm: Float64Array;
  /** Initial density of each zone, in g/cm^3. */
  rho: Float64Array;
  /** Mass coordinate of each zone centre, as a fraction of the total. */
  q: Float64Array;
  /** True for zones in the surface helium shell, if there is one. */
  helium: boolean[];
  totalMass: number;
  heliumMass: number;
  radius: number;
  centralDensity: number;
  /** How much energy it would take to disperse the star, in erg. Positive. */
  bindingEnergy: number;
}

/**
 * Lay the star out in shells of gas.
 *
 * The shells are evenly spaced in radius, not in mass. Equal mass is the usual choice for
 * a Lagrangian grid and here it is the wrong one twice over. It would put a single shell
 * across the whole middle of the star, where the mass is but the interesting geometry also
 * is — the ignition point, and the shock that converges there. And it would put one shell
 * across the entire outer skin, which holds almost no mass but becomes the twenty thousand
 * kilometre a second leading edge of the ejecta. Even spacing in radius gives both ends
 * shells of their own, and since the picture is drawn against radius it is also the
 * spacing the renderer wants.
 */
export function buildWhiteDwarf(totalMass: number, heliumMass = 0, count = 420): WhiteDwarf {
  const centralDensity = centralDensityFor(totalMass);

  // Tabulate the structure once, then read shell boundaries off it by interpolation.
  const tabR: number[] = [];
  const tabM: number[] = [];
  const result = integrate(centralDensity, (r, m) => {
    tabR.push(r);
    tabM.push(m);
  });

  const massAt = (wanted: number): number => {
    if (wanted <= tabR[0]) return (tabM[0] * wanted ** 3) / tabR[0] ** 3;
    if (wanted >= result.radius) return result.mass;
    let lo = 0;
    let hi = tabR.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (tabR[mid] <= wanted) lo = mid;
      else hi = mid;
    }
    const t = (wanted - tabR[lo]) / (tabR[hi] - tabR[lo]);
    return tabM[lo] + (tabM[hi] - tabM[lo]) * t;
  };

  const r = new Float64Array(count + 1);
  const mass = new Float64Array(count + 1);
  const dm = new Float64Array(count);
  const rho = new Float64Array(count);
  const q = new Float64Array(count);
  const helium: boolean[] = new Array(count).fill(false);

  const coreMass = result.mass - heliumMass;
  for (let i = 0; i <= count; i += 1) {
    r[i] = (i / count) * result.radius;
    mass[i] = massAt(r[i]);
  }
  mass[count] = result.mass;

  for (let i = 0; i < count; i += 1) {
    dm[i] = mass[i + 1] - mass[i];
    const volume = (4 / 3) * Math.PI * (r[i + 1] ** 3 - r[i] ** 3);
    rho[i] = dm[i] / volume;
    q[i] = (mass[i] + mass[i + 1]) / 2 / result.mass;
    helium[i] = heliumMass > 0 && (mass[i] + mass[i + 1]) / 2 >= coreMass;
  }

  return {
    count,
    r,
    mass,
    dm,
    rho,
    q,
    helium,
    totalMass: result.mass,
    heliumMass,
    radius: result.radius,
    centralDensity,
    bindingEnergy: -result.energy,
  };
}

/**
 * The two stars this demo can blow up.
 *
 * The heavier one is quoted at 1.36 solar masses rather than the 1.38 the published
 * near-Chandrasekhar progenitors carry, and the missing two hundredths is not an error.
 * Those models are warm: their cores have spent a thousand years simmering and have a real
 * thermal pressure holding them open. This star is cold, so it needs slightly less mass to
 * reach the same place. At 1.36 it lands on the published central density of 2.0e9 g/cm^3
 * and the published radius of about 2000 km, and those are the two numbers that actually
 * decide what the explosion does — the density sets what the burning makes, and the radius
 * sets how long the front takes to cross.
 */
export const NEAR_CHANDRA = { mass: 1.36 * M_SUN, helium: 0 };
export const SUB_CHANDRA = { mass: 1.03 * M_SUN, helium: 0.03 * M_SUN };
