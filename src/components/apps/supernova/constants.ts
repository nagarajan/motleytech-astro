/**
 * Everything in the solver is CGS, which is what the supernova literature uses. Converting
 * to SI would mean re-deriving every constant quoted in every paper this model is built
 * from, so the conversions happen once, at the display layer.
 */

export const G = 6.6743e-8; // cm^3 g^-1 s^-2
export const C_LIGHT = 2.99792458e10; // cm/s
export const K_B = 1.380649e-16; // erg/K
export const M_U = 1.66053907e-24; // g, atomic mass unit
export const A_RAD = 7.5657e-15; // erg cm^-3 K^-4, radiation constant
export const SIGMA_SB = 5.6704e-5; // erg cm^-2 s^-1 K^-4

export const M_SUN = 1.98892e33; // g
export const R_SUN = 6.957e10; // cm
export const MEV = 1.602176634e-6; // erg
export const KM = 1e5; // cm

/**
 * Nuclear saturation density. Below this, nuclei are separate objects in a sea of
 * electrons; above it they have merged into one continuous fluid and the strong force
 * turns sharply repulsive. That switch is what stops the collapse, so this number is the
 * single most important one in the whole simulation.
 */
export const RHO_NUC = 2.7e14; // g/cm^3

/**
 * Above this density the mean free path of a neutrino drops below the size of the core and
 * the diffusion time exceeds the collapse time, so neutrinos stop escaping and start being
 * carried along with the matter. This is why the core does not simply radiate away its
 * lepton number and collapse to nothing: the electrons it still has keep pushing back.
 */
export const RHO_TRAP = 2e12; // g/cm^3

/** Electron degeneracy pressure coefficients, non-relativistic and ultra-relativistic. */
export const K_DEG_NR = 1.0036e13; // P = K (rho * Ye)^(5/3)
export const K_DEG_ER = 1.2435e15; // P = K (rho * Ye)^(4/3)

/**
 * Binding energy per nucleon of the iron group. Undoing it is what the bounce shock spends
 * itself on: every gram of iron the shock breaks apart costs it this much times the number
 * of nucleons in a gram, which is why the prompt shock fails.
 */
export const B_FE_PER_NUCLEON = 8.79 * MEV; // erg per nucleon
export const B_ALPHA_PER_NUCLEON = 7.07 * MEV; // erg per nucleon

/** Nucleons per gram, near enough for every species that matters here. */
export const NUCLEONS_PER_GRAM = 1 / M_U;

// ---------------------------------------------------------------- composition

/**
 * The seven things a zone can be made of. Real stellar material is a soup of hundreds of
 * isotopes, but for the purpose of watching an onion get blown apart, what matters is which
 * shell a piece of gas started in and what the shock turned it into.
 */
export const SPECIES = ['h', 'he', 'c', 'o', 'si', 'fe', 'free'] as const;
export type Species = (typeof SPECIES)[number];
export const SPECIES_COUNT = SPECIES.length;

export const SP_H = 0;
export const SP_HE = 1;
export const SP_C = 2;
export const SP_O = 3;
export const SP_SI = 4;
export const SP_FE = 5;
/** Free nucleons: what photodisintegration leaves behind when it takes a nucleus apart. */
export const SP_FREE = 6;

/** Mean molecular weight per ion, used for the ideal-gas part of the pressure. */
export const SPECIES_A = [1, 4, 12, 16, 28, 56, 1];
/** Protons per nucleus, which with A sets the electron fraction of unburnt material. */
export const SPECIES_Z = [1, 2, 6, 8, 14, 26, 0.5];

/**
 * Binding energy per nucleon of each species, in erg. The differences between these are
 * where explosive nucleosynthesis gets its energy, and where photodisintegration loses it.
 */
export const SPECIES_BE = [
  0, // hydrogen, by definition
  7.07 * MEV,
  7.68 * MEV,
  7.98 * MEV,
  8.45 * MEV,
  8.79 * MEV,
  0, // free nucleons, by definition
];

/** Display colours, warm for the heavy core and cool for the light envelope. */
export const SPECIES_COLOUR: Record<Species, [number, number, number]> = {
  h: [0.42, 0.55, 0.92],
  he: [0.35, 0.78, 0.86],
  c: [0.45, 0.52, 0.58],
  o: [0.36, 0.76, 0.56],
  si: [0.92, 0.72, 0.31],
  fe: [0.85, 0.36, 0.25],
  free: [0.94, 0.93, 0.88],
};

export const SPECIES_LABEL: Record<Species, string> = {
  h: 'Hydrogen',
  he: 'Helium',
  c: 'Carbon',
  o: 'Oxygen / neon',
  si: 'Silicon',
  fe: 'Iron group',
  free: 'Free nucleons',
};
