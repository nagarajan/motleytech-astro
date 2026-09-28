import { G, M_SUN, SPECIES_COUNT, SP_H, SP_HE, SP_C, SP_O, SP_SI, SP_FE } from './constants';
import {
  coldEnergy,
  coldPressure,
  electronFractionForPressure,
  meanIonMass,
  temperatureForPressure,
  thermalEnergyOf,
  thermalPressure,
} from './eos';
import { ZONES, RADIUS, ZONE_MASS, TEMPERATURE, YE, COMPOSITION } from './progenitor-data';

/**
 * The star, the moment before it starts to fall.
 *
 * A star about to go supernova is not a ball of one thing. It is a set of nested shells,
 * each one the ash of the burning happening in the shell above it: hydrogen fusing to
 * helium at the top, helium to carbon below that, then oxygen, then silicon, and at the
 * centre the iron that is where the chain ends. Iron sits at the peak of the binding energy
 * curve, so fusing it releases nothing. The core has run out of fuel, and the only thing
 * holding it up is the pressure of its own degenerate electrons.
 *
 * Building such a star is not something to attempt by hand. The layer masses, the layer
 * radii and hydrostatic equilibrium are not three things you get to choose independently —
 * fix any two and the third is decided, and if you insist on it anyway the star takes its
 * revenge somewhere subtle. An earlier version of this file stacked an analytic polytrope
 * under mass-targeted power-law shells, and the contradiction surfaced as a spike of
 * temperature at the iron-silicon interface, eight billion kelvin where it should have been
 * four, hot enough to burn the silicon shell to iron before the simulation had started.
 *
 * So the star here is not built, it is read. It is the s15.0 model from the Garching
 * core-collapse supernova archive, one of the two hundred progenitors released with
 * Sukhbold, Ertl, Woosley, Brown & Janka (2016), condensed from its original 1064 zones
 * down to 300 by tools/build-progenitor.py. A real fifteen-solar-mass star, evolved from
 * the main sequence through every stage of burning, caught at the last moment it was still
 * a star: 12.6 solar masses left after the winds, 842 solar radii across, a 1.4 solar mass
 * iron core 1400 km wide at nine billion grams per cubic centimetre and seven billion
 * kelvin, and a hydrogen envelope so thin and so vast that light takes half an hour to
 * cross it.
 */

export interface Layer {
  name: string;
  /** Outer radius in cm. */
  outer: number;
  /** Enclosed mass at that radius, in g. */
  outerMass: number;
}

export interface Grid {
  count: number;
  /** Zone masses in g. */
  dm: Float64Array;
  /** Enclosed mass at each interface in g, length count + 1. */
  mass: Float64Array;
  /** Interface radii in cm, length count + 1, with r[0] = 0. */
  r: Float64Array;
  /** Interface velocities in cm/s, length count + 1. */
  v: Float64Array;
  rho: Float64Array;
  temp: Float64Array;
  /** Specific internal energy in erg/g. */
  energy: Float64Array;
  ye: Float64Array;
  /** Mass fractions, count * SPECIES_COUNT, zone-major. */
  comp: Float64Array;
  totalMass: number;
  layers: Layer[];
}

/** What to call each shell, by the species that dominates it. */
const LAYER_NAME: Record<number, string> = {
  [SP_FE]: 'Iron core',
  [SP_SI]: 'Silicon shell',
  [SP_O]: 'Oxygen shell',
  [SP_C]: 'Carbon shell',
  [SP_HE]: 'Helium shell',
  [SP_H]: 'Hydrogen envelope',
};

/**
 * Find the onion shells by looking for where the most abundant species changes.
 *
 * The model carries composition rather than labels, which is the honest way round: the
 * boundaries are not sharp, and a zone near an interface is a genuine mixture. Naming a
 * shell after whatever it mostly is puts the boundary in the same place the eye would.
 */
function findLayers(count: number, comp: Float64Array, r: Float64Array, mass: Float64Array): Layer[] {
  const dominant = (i: number): number => {
    let best = 0;
    for (let s = 1; s < SPECIES_COUNT; s += 1) {
      if (comp[i * SPECIES_COUNT + s] > comp[i * SPECIES_COUNT + best]) best = s;
    }
    return best;
  };

  const layers: Layer[] = [];
  let current = dominant(0);
  for (let i = 1; i < count; i += 1) {
    const here = dominant(i);
    if (here === current) continue;
    // Ignore a species that only briefly takes the lead at a blurred interface.
    let settled = true;
    for (let k = i; k < Math.min(i + 3, count); k += 1) if (dominant(k) !== here) settled = false;
    if (!settled) continue;
    layers.push({ name: LAYER_NAME[current] ?? 'Shell', outer: r[i], outerMass: mass[i] });
    current = here;
  }
  layers.push({ name: LAYER_NAME[current] ?? 'Shell', outer: r[count], outerMass: mass[count] });
  return layers;
}

export function buildStar(): Grid {
  const count = ZONES;
  const dm = Float64Array.from(ZONE_MASS);
  const temp = Float64Array.from(TEMPERATURE);
  const ye = Float64Array.from(YE);
  const comp = Float64Array.from(COMPOSITION);

  const r = new Float64Array(count + 1);
  const v = new Float64Array(count + 1);
  const mass = new Float64Array(count + 1);
  const rho = new Float64Array(count);
  const energy = new Float64Array(count);

  for (let i = 0; i < count; i += 1) {
    r[i + 1] = RADIUS[i];
    mass[i + 1] = mass[i] + dm[i];
    rho[i] = dm[i] / ((4 / 3) * Math.PI * (r[i + 1] ** 3 - r[i] ** 3));
  }

  const grid: Grid = {
    count,
    dm,
    mass,
    r,
    v,
    rho,
    temp,
    energy,
    ye,
    comp,
    totalMass: mass[count],
    layers: findLayers(count, comp, r, mass),
  };
  relax(grid);
  return grid;
}

/**
 * Settle the star into hydrostatic equilibrium before letting go of it.
 *
 * The model arrives in equilibrium already, but in the equation of state of the code that
 * produced it, which is not quite the one this simulation runs on. The difference is small
 * and the consequence is not: a zone whose pressure is a percent low starts falling at
 * once, and a star that is already collapsing before its core does has nothing to teach
 * anyone. So the star is nudged back into balance, in this code's own discretisation, with
 * this code's own equation of state.
 *
 * Density is what to keep — it carries the mass and sets the infall rate — so temperature
 * is what gets adjusted. Walk inward from the surface, accumulating the pressure each zone
 * must supply to carry everything above it, and choose the temperature that supplies it.
 * Through the envelope and the burning shells this works cleanly, because thermal pressure
 * is most of the pressure there is, and the answer lands within a few percent of the
 * temperature the stellar evolution code found — which is a fair test of this code's
 * equation of state, since nothing here was fitted to it.
 *
 * Deep in the iron core the same calculation is meaningless. Degenerate electrons supply
 * better than ninety-nine percent of the pressure there, so the temperature is being
 * solved for out of the last decimal place of a difference between two large numbers, and
 * a one percent disagreement between this equation of state and the original one throws
 * the answer by a factor of three. That matters more than it sounds: the collapse begins
 * with photodisintegration, whose rate depends on temperature exponentially. So the
 * core is balanced by turning its electron fraction instead, by a fraction of a percent,
 * which leaves the temperature exactly as the stellar evolution code found it.
 */

/** How far the relaxed temperature may stray from the model's before it is disbelieved. */
const TEMPERATURE_LEEWAY = 1.5;

function relax(grid: Grid): void {
  const { count, dm, mass, r, rho, temp, ye, comp, energy } = grid;
  const ionMassOf = (i: number): number => meanIonMass(comp, i * SPECIES_COUNT);

  // Nothing rests on the outermost zone, so its own pressure is the boundary condition.
  let pressure =
    coldPressure(rho[count - 1], ye[count - 1]) +
    thermalPressure(temp[count - 1], rho[count - 1], ye[count - 1], ionMassOf(count - 1));

  for (let i = count - 1; i >= 0; i -= 1) {
    const ion = ionMassOf(i);
    const cold = coldPressure(rho[i], ye[i]);
    const thermal = thermalPressure(temp[i], rho[i], ye[i], ion);

    // Try temperature first, and believe it if it lands anywhere near where the stellar
    // evolution code put it. Where it does not — or where no temperature at all would
    // do, because degeneracy alone already overshoots — turn the electron fraction
    // instead. Both produce exactly the pressure the zone needs, so the handover between
    // them leaves no seam.
    const solved = pressure > cold ? temperatureForPressure(pressure - cold, rho[i], ye[i], ion) : 0;
    if (solved > temp[i] / TEMPERATURE_LEEWAY && solved < temp[i] * TEMPERATURE_LEEWAY) {
      temp[i] = solved;
    } else if (cold > thermal && pressure > thermal) {
      ye[i] = electronFractionForPressure(pressure - thermal, rho[i]);
    }
    energy[i] = coldEnergy(rho[i], ye[i]) + thermalEnergyOf(temp[i], rho[i], ye[i], ion);

    if (i > 0) {
      const dmFace = (dm[i] + dm[i - 1]) / 2;
      pressure += (G * mass[i] * dmFace) / (4 * Math.PI * r[i] ** 4);
    }
  }
}

/** Mass coordinate of a layer boundary, in solar masses, for readouts. */
export function layerMasses(grid: Grid): { name: string; mass: number }[] {
  return grid.layers.map((l) => ({ name: l.name, mass: l.outerMass / M_SUN }));
}
