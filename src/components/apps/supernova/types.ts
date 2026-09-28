/** Shared between the solver, the worker and the renderer. */

export type Phase =
  | 'infall'
  | 'collapse'
  | 'bounce'
  | 'stalled'
  | 'reviving'
  | 'exploding'
  | 'coasting'
  | 'breakout'
  | 'failed';

export const PHASE_LABEL: Record<Phase, string> = {
  infall: 'Silicon burning, core growing',
  collapse: 'Core collapse',
  bounce: 'Core bounce',
  stalled: 'Shock stalled',
  reviving: 'Neutrino heating revives the shock',
  exploding: 'Explosion',
  coasting: 'Shock climbing through the envelope',
  breakout: 'Shock breakout',
  failed: 'Collapse to a black hole',
};

/**
 * One recorded moment. Zone quantities are stored at whatever resolution the solver was
 * using; the renderer resamples onto a fixed radial grid.
 */
export interface Frame {
  /** Seconds since the start of the run. */
  time: number;
  /** Seconds relative to core bounce; negative before it. */
  sinceBounce: number;
  phase: Phase;

  /** Index of the innermost live zone; everything below it is inside the compact object. */
  inner: number;
  /** Interface radii in cm, length count + 1. */
  r: Float32Array;
  /** Interface velocities in cm/s. */
  v: Float32Array;
  /** Zone densities in g/cm^3. */
  rho: Float32Array;
  /** Zone temperatures in K. */
  temp: Float32Array;
  /** Zone entropy per baryon in k_B, which is what makes the shock visible. */
  entropy: Float32Array;
  /** Mass fractions scaled to a byte, zone-major, count * 7. */
  comp: Uint8Array;
  /** Nuclear energy generation rate per gram, log-scaled to a byte for the glow. */
  burning: Uint8Array;

  /** Radius of the shock front in cm, or 0 if there is not one yet. */
  shockRadius: number;
  /** Radius of the proto-neutron star in cm. */
  coreRadius: number;
  /** Mass of the proto-neutron star in g. */
  coreMass: number;
  /** Central density in g/cm^3. */
  centralDensity: number;
  /** Total neutrino luminosity in erg/s, all flavours. */
  neutrinoLuminosity: number;
  /** Radius of the neutrinosphere in cm. */
  neutrinoSphere: number;
  /** Cumulative energy neutrinos have carried off, in erg. */
  neutrinoEnergy: number;
  /** Nickel-56 made by explosive burning, in g. */
  nickel: number;
  /** Diagnostic explosion energy: total energy of everything that is unbound, in erg. */
  explosionEnergy: number;
  /** Cumulative energy released by nuclear burning, in erg. */
  burnEnergy: number;
  /** Mass that has become unbound, in g. */
  ejectaMass: number;
  /** Fastest outward velocity anywhere, in cm/s. */
  peakVelocity: number;
  /** Which zone set the timestep, and why. Diagnostic, but a revealing one. */
  limitZone: number;
  limitCause: string;
  /** Timestep in seconds at the moment this frame was taken. */
  dt: number;
}

export interface RunSettings {
  /**
   * The neutrino heating factor: how efficiently the neutrino flux couples to matter behind
   * the stalled shock. One is roughly what detailed transport calculations give in
   * spherical symmetry, which famously does not explode. Turning it up stands in for the
   * convection and shock sloshing that a one-dimensional model cannot represent.
   */
  heatingFactor: number;
  /** Zone count scale, for trading accuracy against how long the run takes. */
  resolution: 'coarse' | 'normal' | 'fine';
}

export interface RunResult {
  frames: Frame[];
  /** Zone masses in g, constant through the run. */
  dm: Float64Array;
  /** Enclosed mass at each interface in g, constant through the run. */
  mass: Float64Array;
  count: number;
  totalMass: number;
  bounceTime: number;
  /** Entropy each shell began with, which the shock is measured against. */
  initialEntropy: Float64Array;
  /** Radii of the composition boundaries at the start, for the legend. */
  layers: { name: string; outer: number; outerMass: number }[];
  failed: boolean;
  settings: RunSettings;
  /** Wall-clock milliseconds the run took, which is worth showing. */
  elapsed: number;
  steps: number;
}

export type WorkerMessage =
  | { kind: 'progress'; fraction: number; note: string }
  | { kind: 'done'; result: RunResult }
  | { kind: 'error'; message: string };
