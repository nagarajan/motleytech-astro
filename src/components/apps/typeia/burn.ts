/**
 * What the burning makes, and how much energy that costs or pays.
 *
 * This is the single most important idea in the whole demo, so it is worth stating
 * plainly: **a white dwarf has no layers**. It is carbon and oxygen, mixed, all the way
 * through — at most with a thin helium skin. Every layer you see in the finished ejecta,
 * and every layer in a Type Ia spectrum, was manufactured during the two seconds of the
 * explosion, and the only thing that decides which one you get is the *density of the gas
 * at the instant the burning front arrives*.
 *
 * Above about 10^9 g/cm^3 the gas is dense enough that electrons get captured onto the
 * nuclei while they burn, and the ash comes out neutron-rich: stable iron and nickel
 * isotopes that are invisible afterwards because they are not radioactive. Between 10^7
 * and 10^9 the burning goes all the way to nuclear statistical equilibrium without the
 * captures, and makes nickel-56 — the radioactive isotope whose decay is the entire light
 * of the supernova for the following months. Below 10^7 there is no longer enough time at
 * high temperature to reach equilibrium, the burning stops part way, and what is left is
 * silicon, sulphur, argon and calcium. Below about 10^6 only the outer reaches of oxygen
 * burning happen, and below 3x10^5 the front simply cannot ignite the fuel at all and the
 * carbon and oxygen come through untouched.
 *
 * That last fact is why a pure detonation is not the answer: run a detonation into an
 * undisturbed white dwarf and almost all of it is above 10^7, so almost all of it turns
 * into iron group, and the real spectra plainly show silicon. Something has to let the
 * star expand first.
 */

import { M_U, SPECIES, SPECIES_BE, SPECIES_COUNT, type Species } from './constants';

/** A composition, as mass fractions in the order of SPECIES. */
export type Mix = number[];

const mix = (parts: Partial<Record<Species, number>>): Mix => {
  const out = new Array(SPECIES_COUNT).fill(0);
  let total = 0;
  for (const [name, share] of Object.entries(parts)) {
    out[SPECIES.indexOf(name as Species)] = share ?? 0;
    total += share ?? 0;
  }
  for (let i = 0; i < SPECIES_COUNT; i += 1) out[i] /= total;
  return out;
};

/** An anchor on the ash table: a density, and what the burning makes at that density. */
interface Anchor {
  logRho: number;
  ash: Mix;
}

/**
 * Detonation ash, against density. A detonation is fast and hot and reaches whatever
 * equilibrium the density allows, so this table is close to the classical explosive
 * nucleosynthesis result.
 */
const DETONATION: Anchor[] = [
  { logRho: 9.6, ash: mix({ fe: 0.78, ni: 0.22 }) },
  { logRho: 8.8, ash: mix({ fe: 0.30, ni: 0.70 }) },
  { logRho: 8.0, ash: mix({ fe: 0.08, ni: 0.92 }) },
  { logRho: 7.3, ash: mix({ fe: 0.03, ni: 0.97 }) },
  { logRho: 7.0, ash: mix({ ni: 0.72, si: 0.22, ca: 0.06 }) },
  { logRho: 6.6, ash: mix({ ni: 0.26, si: 0.54, ca: 0.16, o: 0.04 }) },
  { logRho: 6.2, ash: mix({ ni: 0.04, si: 0.55, ca: 0.20, o: 0.21 }) },
  { logRho: 5.8, ash: mix({ si: 0.30, ca: 0.12, o: 0.46, co: 0.12 }) },
  { logRho: 5.45, ash: mix({ si: 0.08, ca: 0.03, o: 0.49, co: 0.40 }) },
  { logRho: 5.1, ash: mix({ o: 0.18, co: 0.82 }) },
  { logRho: 4.7, ash: mix({ co: 1 }) },
];

/**
 * Deflagration ash. A subsonic flame in a near-Chandrasekhar white dwarf burns only the
 * dense middle, and it lingers there: the material sits hot and dense for long enough that
 * electron capture shifts the ash neutron-rich, which is why this table makes noticeably
 * more stable iron and less nickel-56 than the detonation table at the same density.
 *
 * This is also the one observational handle on whether a Type Ia went through a
 * deflagration phase at all, since neutron-rich iron group in the very centre of a remnant
 * is hard to make any other way.
 */
const DEFLAGRATION: Anchor[] = [
  { logRho: 9.6, ash: mix({ fe: 0.90, ni: 0.10 }) },
  { logRho: 9.0, ash: mix({ fe: 0.62, ni: 0.38 }) },
  { logRho: 8.4, ash: mix({ fe: 0.28, ni: 0.72 }) },
  { logRho: 7.8, ash: mix({ fe: 0.12, ni: 0.88 }) },
  { logRho: 7.2, ash: mix({ fe: 0.06, ni: 0.80, si: 0.14 }) },
  { logRho: 6.8, ash: mix({ ni: 0.40, si: 0.45, ca: 0.15 }) },
  { logRho: 6.3, ash: mix({ si: 0.50, ca: 0.20, o: 0.30 }) },
  { logRho: 5.8, ash: mix({ o: 0.45, co: 0.55 }) },
  { logRho: 5.2, ash: mix({ co: 1 }) },
];

/**
 * Helium detonation ash, for the surface shell of the sub-Chandrasekhar star.
 *
 * Helium burning by alpha capture climbs the chart four nucleons at a time, and at the low
 * densities of a surface shell it runs out of time in the neighbourhood of calcium and
 * titanium rather than going on to iron. That is what makes this scenario testable: it
 * leaves a calcium shell sitting *outside* the one the core detonation makes, and in 2025
 * the Very Large Telescope resolved exactly that double ring in SNR 0509-67.5.
 */
const HELIUM: Anchor[] = [
  { logRho: 6.3, ash: mix({ ni: 0.40, ca: 0.38, si: 0.14, he: 0.08 }) },
  { logRho: 5.7, ash: mix({ ni: 0.22, ca: 0.50, si: 0.18, he: 0.10 }) },
  { logRho: 5.2, ash: mix({ ni: 0.08, ca: 0.55, si: 0.19, he: 0.18 }) },
  { logRho: 4.6, ash: mix({ ca: 0.42, si: 0.16, he: 0.42 }) },
  { logRho: 4.0, ash: mix({ ca: 0.12, he: 0.88 }) },
  { logRho: 3.4, ash: mix({ he: 1 }) },
];

export type Front = 'detonation' | 'deflagration' | 'helium';

const TABLES: Record<Front, Anchor[]> = {
  detonation: DETONATION,
  deflagration: DEFLAGRATION,
  helium: HELIUM,
};

/**
 * What a front of the given kind makes out of gas at the given density.
 *
 * Interpolated in the logarithm of density and written into the caller's array, because
 * this runs for every shell of every frame and allocating here would be four hundred
 * throwaway arrays per frame.
 */
export function ashFor(kind: Front, density: number, out: Float32Array, offset: number): void {
  const table = TABLES[kind];
  const logRho = Math.log10(Math.max(density, 1));

  let lo = table[0];
  let hi = table[table.length - 1];
  if (logRho >= lo.logRho) {
    for (let s = 0; s < SPECIES_COUNT; s += 1) out[offset + s] = lo.ash[s];
    return;
  }
  if (logRho <= hi.logRho) {
    for (let s = 0; s < SPECIES_COUNT; s += 1) out[offset + s] = hi.ash[s];
    return;
  }
  for (let i = 1; i < table.length; i += 1) {
    if (logRho >= table[i].logRho) {
      lo = table[i - 1];
      hi = table[i];
      break;
    }
  }
  const t = (lo.logRho - logRho) / (lo.logRho - hi.logRho);
  for (let s = 0; s < SPECIES_COUNT; s += 1) {
    out[offset + s] = lo.ash[s] + (hi.ash[s] - lo.ash[s]) * t;
  }
}

/**
 * Energy released per gram in going from one composition to another, in erg.
 *
 * Straight from the binding energy curve, which is the only place a supernova's energy
 * ever comes from. Turning carbon and oxygen into nickel-56 gains about 0.7 MeV for every
 * one of the 6x10^23 nucleons in a gram, and that is 7x10^17 erg — per gram, for the whole
 * star, which is where the 10^51 comes from.
 */
export function energyBetween(before: Float32Array, after: Float32Array, offset: number): number {
  let gained = 0;
  for (let s = 0; s < SPECIES_COUNT; s += 1) {
    gained += (after[offset + s] - before[offset + s]) * SPECIES_BE[SPECIES[s]];
  }
  return gained / M_U;
}

/**
 * The lowest density at which a front of this kind still ignites anything. Below it the
 * front is not extinguished so much as irrelevant: it runs out through gas it cannot
 * light, and that gas survives the supernova as unburnt carbon and oxygen.
 */
export const QUENCH_DENSITY: Record<Front, number> = {
  detonation: 3.2e4,
  deflagration: 1.6e5,
  helium: 2.5e3,
};
