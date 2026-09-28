/**
 * Turning one instant of the explosion into pixels.
 *
 * Two things are different here from the core-collapse demo next door, and both of them
 * are improvements that the physics happens to hand over for free.
 *
 * The first is that the radial axis is **linear**. A collapsing iron core has to be drawn
 * on a logarithmic axis because it spans eight orders of magnitude, and the price of that
 * is that the star stops looking like a star and starts looking like a set of concentric
 * rings. A Type Ia goes from two thousand kilometres to about sixty thousand — a factor of
 * thirty, all of it after the burning is over. That fits on a linear axis, so this one
 * gets to look like a sphere.
 *
 * The second is that the field is **two-dimensional**, radius by angle, rather than a
 * single radial strip. Neither of these explosions is spherical and neither is spherical
 * by accident: the delayed detonation lights off centre and floats, and the double
 * detonation is driven by a wave that runs around the outside of the star and converges
 * somewhere other than the middle. A radial strip would throw away the mechanism.
 */

import {
  SPECIES,
  SPECIES_COLOUR,
  SPECIES_COUNT,
  SPECIES_SHORT,
} from './constants';
import { NR, NTHETA, type BurnMap, type Snapshot } from './model';

/** Field resolution. Radially generous, angularly matched to the model's own grid. */
export const R_SAMPLES = 256;
export const A_SAMPLES = NTHETA;

export type ColourMode = 'composition' | 'burning' | 'density' | 'speed';

export const COLOUR_MODES: { id: ColourMode; label: string; note: string }[] = [
  {
    id: 'composition',
    label: 'Composition',
    note: 'What each parcel of gas is made of. The whole star begins as carbon and oxygen; every other colour you see was manufactured by the explosion in the second you are watching.',
  },
  {
    id: 'burning',
    label: 'Burning',
    note: 'Where nuclear energy is being released right now. This is the front itself — the thing that travels.',
  },
  {
    id: 'density',
    label: 'Density',
    note: 'The quantity that decides everything. What the burning makes at any point is settled by the density there at the instant the front arrives, and the star is thinning out the whole time.',
  },
  {
    id: 'speed',
    label: 'Speed',
    note: 'How fast each layer is moving outward. Late on this becomes a straight line through the origin, which is what it means for ejecta to be coasting.',
  },
];

/**
 * How the layers are presented.
 *
 * Both of these are honest and they answer different questions. `emerge` is what the model
 * actually computes and the better science: nothing exists until it is made. `preview`
 * draws the finished onion faintly from the first frame and fills each band in as it
 * burns, which makes it far easier to see *where* a given layer is going to come from and
 * how much of the star it will account for.
 */
export type LayerMode = 'emerge' | 'preview';

export const LAYER_MODES: { id: LayerMode; label: string; note: string }[] = [
  {
    id: 'emerge',
    label: 'Layers appear as they are made',
    note: 'The star starts as uniform carbon and oxygen, because that is what a white dwarf is. Each band exists only once the front has passed and the density there has decided what to make.',
  },
  {
    id: 'preview',
    label: 'Show where the layers will be',
    note: 'The finished onion is sketched in faintly from the start and each band lights up as it burns. Not what the star looks like, but much the clearest way to see which part of it becomes what.',
  },
];

// ---------------------------------------------------------------- ramps

type Stop = [number, number, number, number];

function ramp(stops: Stop[], value: number, out: [number, number, number]): void {
  if (value <= stops[0][0]) {
    out[0] = stops[0][1];
    out[1] = stops[0][2];
    out[2] = stops[0][3];
    return;
  }
  const last = stops[stops.length - 1];
  if (value >= last[0]) {
    out[0] = last[1];
    out[1] = last[2];
    out[2] = last[3];
    return;
  }
  for (let i = 1; i < stops.length; i += 1) {
    if (value <= stops[i][0]) {
      const a = stops[i - 1];
      const b = stops[i];
      const t = (value - a[0]) / (b[0] - a[0]);
      out[0] = a[1] + (b[1] - a[1]) * t;
      out[1] = a[2] + (b[2] - a[2]) * t;
      out[2] = a[3] + (b[3] - a[3]) * t;
      return;
    }
  }
}

/** Log density, from the ten thousand million of the core down to the wisps at the edge. */
const DENSITY: Stop[] = [
  [3.0, 0.04, 0.05, 0.11],
  [5.0, 0.10, 0.20, 0.42],
  [6.0, 0.13, 0.48, 0.62],
  [7.0, 0.24, 0.72, 0.52],
  [8.0, 0.82, 0.78, 0.30],
  [9.0, 0.97, 0.50, 0.24],
  [9.7, 1.00, 0.93, 0.95],
];

const BURN: Stop[] = [
  [0.0, 0.04, 0.04, 0.07],
  [0.2, 0.42, 0.09, 0.05],
  [0.5, 0.94, 0.38, 0.06],
  [0.78, 1.0, 0.80, 0.28],
  [1.0, 1.0, 1.0, 0.94],
];

/** Speed, in units of ten thousand kilometres a second. */
const SPEED: Stop[] = [
  [0.0, 0.07, 0.08, 0.16],
  [0.3, 0.18, 0.30, 0.62],
  [0.7, 0.30, 0.68, 0.70],
  [1.2, 0.92, 0.72, 0.28],
  [2.0, 1.0, 0.42, 0.34],
  [2.6, 1.0, 0.92, 0.90],
];

// ---------------------------------------------------------------- the field

export interface Field {
  /** RGBA bytes, R_SAMPLES across by A_SAMPLES down. Alpha zero outside the star. */
  pixels: Uint8Array;
  /** Radius the outermost column corresponds to, cm. */
  outerRadius: number;
}

export function makeField(): Field {
  return { pixels: new Uint8Array(R_SAMPLES * A_SAMPLES * 4), outerRadius: 1 };
}

/** Scratch, so that a frame allocates nothing. */
const rgb: [number, number, number] = [0, 0, 0];
const shellOf = new Int32Array(R_SAMPLES);

/**
 * Fill the field from one instant.
 *
 * The radial axis is normalised to the star's current outer radius, so the texture always
 * runs from the centre to the edge and the growth of the star is handled by scaling the
 * mesh rather than by resampling. That keeps the resolution where it is wanted: the same
 * two hundred and fifty six samples cover the star whether it is two thousand kilometres
 * across or sixty thousand.
 */
export function fillField(
  field: Field,
  map: BurnMap,
  snap: Snapshot,
  mode: ColourMode,
  layers: LayerMode,
): void {
  const { pixels } = field;
  const outer = snap.radius[NR];
  field.outerRadius = outer;

  // Radius maps to shell the same way at every angle, so it is worked out once per frame
  // and shared across all sixty-four rows.
  let shell = 0;
  for (let i = 0; i < R_SAMPLES; i += 1) {
    const radius = ((i + 0.5) / R_SAMPLES) * outer;
    while (shell < NR - 1 && snap.radius[shell + 1] < radius) shell += 1;
    shellOf[i] = shell;
  }

  for (let a = 0; a < A_SAMPLES; a += 1) {
    for (let i = 0; i < R_SAMPLES; i += 1) {
      const cell = shellOf[i] * NTHETA + a;
      const at = (a * R_SAMPLES + i) * 4;

      let red = 0;
      let green = 0;
      let blue = 0;

      if (mode === 'composition') {
        const base = cell * SPECIES_COUNT;
        const source = layers === 'preview' ? map.ash : snap.comp;
        let total = 0;
        for (let s = 0; s < SPECIES_COUNT; s += 1) {
          const share = source[base + s];
          if (share === 0) continue;
          const tint = SPECIES_COLOUR[SPECIES[s]];
          red += tint[0] * share;
          green += tint[1] * share;
          blue += tint[2] * share;
          total += share;
        }
        if (total > 0) {
          red /= total;
          green /= total;
          blue /= total;
        }
        if (layers === 'preview') {
          // The band is drawn in its finished colour whether or not it has burnt yet, but
          // until it does it is dimmed and pulled towards grey, so that it reads as an
          // outline of something coming rather than as something already there.
          const lit = snap.burnt[cell];
          const grey = (red + green + blue) / 3;
          const saturation = 0.55 + 0.45 * lit;
          const brightness = 0.45 + 0.55 * lit;
          red = (grey + (red - grey) * saturation) * brightness;
          green = (grey + (green - grey) * saturation) * brightness;
          blue = (grey + (blue - grey) * saturation) * brightness;
        }
        // Freshly burnt gas is lit from within. Without this the composition view is a set
        // of flat bands and the front itself — the only thing actually moving — is
        // invisible, which loses the entire point.
        const glow = snap.glow[cell];
        if (glow > 0) {
          red += (1 - red) * glow * 0.9;
          green += (1 - green) * glow * 0.62;
          blue += (1 - blue) * glow * 0.22;
        }
      } else if (mode === 'burning') {
        ramp(BURN, snap.glow[cell], rgb);
        red = rgb[0];
        green = rgb[1];
        blue = rgb[2];
      } else if (mode === 'density') {
        ramp(DENSITY, Math.log10(Math.max(snap.density[shellOf[i]], 1)), rgb);
        red = rgb[0];
        green = rgb[1];
        blue = rgb[2];
      } else {
        // Homologous coasting means radius divided by time, and once the burning is over
        // that is exactly what this shows.
        const speed = snap.radius[shellOf[i]] / Math.max(snap.time, 0.05) / 1e9;
        ramp(SPEED, speed, rgb);
        red = rgb[0];
        green = rgb[1];
        blue = rgb[2];
      }

      pixels[at] = Math.max(0, Math.min(255, red * 255));
      pixels[at + 1] = Math.max(0, Math.min(255, green * 255));
      pixels[at + 2] = Math.max(0, Math.min(255, blue * 255));
      pixels[at + 3] = 255;
    }
  }
}

/** The legend for whichever mode is showing. */
export function legendFor(mode: ColourMode): { label: string; colour: string }[] {
  const hex = (c: [number, number, number]): string =>
    `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
  const from = (stops: Stop[], format: (v: number) => string) =>
    stops.map((s) => ({ label: format(s[0]), colour: hex([s[1], s[2], s[3]]) }));

  if (mode === 'composition') {
    return SPECIES.map((s) => ({ label: SPECIES_SHORT[s], colour: hex(SPECIES_COLOUR[s]) }));
  }
  if (mode === 'density') return from(DENSITY, (v) => `10^${v.toFixed(0)}`);
  if (mode === 'speed') return from(SPEED, (v) => `${(v * 10).toFixed(0)}k km/s`);
  return [
    { label: 'cold', colour: 'rgb(10,10,18)' },
    { label: 'igniting', colour: 'rgb(240,97,15)' },
    { label: 'fierce', colour: 'rgb(255,255,240)' },
  ];
}
