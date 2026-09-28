/**
 * CGS throughout, which is what the thermonuclear supernova literature uses. Conversion to
 * anything a reader would recognise happens at the display layer and nowhere else.
 */

export const G = 6.6743e-8; // cm^3 g^-1 s^-2
export const M_SUN = 1.98892e33; // g
export const R_EARTH = 6.371e8; // cm
export const KM = 1e5; // cm
export const MEV = 1.602176634e-6; // erg
export const M_U = 1.66053907e-24; // g
export const FOE = 1e51; // erg, the unit a supernova is measured in

/** Electrons per nucleon in carbon–oxygen matter. Both C-12 and O-16 have Z/A = 1/2. */
export const YE = 0.5;

/**
 * Chandrasekhar's constants for a cold electron gas. The pressure is
 *
 *     P = A f(x),   with   x = (rho Ye / B)^(1/3)
 *
 * and f(x) the full relativistic expression. A white dwarf near its limit spans the
 * non-relativistic and ultra-relativistic regimes inside a single star, so neither
 * polytropic shortcut is usable and the whole function has to be carried.
 */
export const CHANDRA_A = 6.0023e22; // dyn/cm^2
export const CHANDRA_B = 9.7393e5; // g/cm^3

// ---------------------------------------------------------------- composition

/**
 * What a thermonuclear supernova is made of, before and after.
 *
 * A white dwarf is two of these: carbon–oxygen fuel, and in the sub-Chandrasekhar case a
 * thin helium skin. Everything else on this list is something the explosion manufactures,
 * and which one gets made is decided by nothing but the density of the gas at the instant
 * the burning front arrives.
 */
export const SPECIES = ['co', 'he', 'o', 'si', 'ca', 'ni', 'fe'] as const;
export type Species = (typeof SPECIES)[number];
export const SPECIES_COUNT = SPECIES.length;

export const SP_CO = 0;
export const SP_HE = 1;
export const SP_O = 2;
export const SP_SI = 3;
export const SP_CA = 4;
export const SP_NI = 5;
export const SP_FE = 6;

export const SPECIES_SHORT: Record<Species, string> = {
  co: 'C+O',
  he: 'He',
  o: 'O/Ne/Mg',
  si: 'Si/S',
  ca: 'Ca/Ar',
  ni: '⁵⁶Ni',
  fe: 'Fe (stable)',
};

/**
 * Display colours. The ordering runs cool for the unburnt fuel through to white-hot for
 * the iron group, so that the sweep of a burning front reads as a sweep of temperature
 * even in the composition view, which is what it physically is.
 */
export const SPECIES_COLOUR: Record<Species, [number, number, number]> = {
  co: [0.41, 0.48, 0.64],
  he: [0.48, 0.80, 0.83],
  o: [0.31, 0.71, 0.52],
  si: [0.93, 0.74, 0.30],
  ca: [0.98, 0.51, 0.31],
  ni: [0.94, 0.30, 0.34],
  fe: [0.93, 0.90, 0.95],
};

/**
 * Binding energy per nucleon, in erg. The difference between where a nucleon starts and
 * where it ends up is the entire energy budget of the supernova: carbon and oxygen sit
 * around 7.9 MeV per nucleon and nickel-56 at 8.64, so turning a gram of the first into a
 * gram of the second releases roughly 0.7 MeV per nucleon, or 10^18 erg per gram.
 */
export const SPECIES_BE: Record<Species, number> = {
  co: 7.94 * MEV,
  he: 7.07 * MEV,
  o: 8.18 * MEV,
  si: 8.45 * MEV,
  ca: 8.55 * MEV,
  ni: 8.64 * MEV,
  fe: 8.75 * MEV,
};
